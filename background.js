// background.js - Service worker
// - Bridges the React Dashboard popup and the content script.
// - Caches the most recent scrape per tab so the dashboard can re-read it.

importScripts('scripts/config.js');

// Read server URL + license key dynamically from settings.
// Service worker: chrome.storage.local.get is async; we resolve lazily.
let _solveUrlCache = null;
let _licenseKeyCache = null;

async function getSolveSettings() {
  const stored = await chrome.storage.local.get('kudavas_settings');
  const cfg = stored?.kudavas_settings || {};
  const serverUrl = (cfg.serverUrl || '').trim();
  const licenseKey = (cfg.licenseKey || '').trim().toUpperCase();
  return { serverUrl, licenseKey };
}

async function getSolveUrl() {
  const { serverUrl, licenseKey } = await getSolveSettings();
  // Always refresh license key from storage (don't cache — popup may have just updated it)
  _licenseKeyCache = licenseKey;
  if (serverUrl) {
    _solveUrlCache = serverUrl.replace(/\/+$/, '') + '/solve';
    return { url: _solveUrlCache, licenseKey };
  }
  // Fallback: hardcoded config
  if (typeof CONFIG.SOLVE_ENDPOINT === 'string' && CONFIG.SOLVE_ENDPOINT) {
    _solveUrlCache = CONFIG.SOLVE_ENDPOINT;
  } else {
    _solveUrlCache = CONFIG.API_BASE_URL.replace(/\/+$/, '') + '/solve';
  }
  return { url: _solveUrlCache, licenseKey };
}

/* ──────────────────────────────────────────────────────────────
   Cache of the latest scraped questions per tabId.
   Survives across popup open/close so the dashboard can refresh
   its view after the user closes/reopens the popup.
────────────────────────────────────────────────────────────── */
const cache = new Map(); // tabId -> { url, title, questions, ts }

async function setCache(tabId, payload) {
  cache.set(tabId, { ...payload, ts: Date.now() });
  try {
    await chrome.storage.session.set({
      [`kudavas_${tabId}`]: { ...payload, ts: Date.now() }
    });
  } catch (e) { /* storage may be unavailable in some contexts */ }
}

async function getCache(tabId) {
  if (cache.has(tabId)) return cache.get(tabId);
  try {
    const stored = await chrome.storage.session.get(`kudavas_${tabId}`);
    if (stored && stored[`kudavas_${tabId}`]) {
      const data = stored[`kudavas_${tabId}`];
      cache.set(tabId, data);
      return data;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ──────────────────────────────────────────────────────────────
   Messaging router
────────────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1) Dashboard asks for the currently-cached questions for its active tab.
  if (request.action === 'get-active-questions') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return sendResponse({ questions: [] });
        const data = await getCache(tab.id);
        sendResponse({
          questions: data?.questions || [],
          url: data?.url || tab.url,
          title: data?.title || tab.title
        });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // 1b) Content script asks for its own tabId (for solve-and-fill shortcut)
  if (request.action === 'get-tab-id') {
    const senderTabId = sender?.tab?.id;
    if (senderTabId) return sendResponse({ tabId: senderTabId });
    // Fallback: pick the active tab in the focused window
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      sendResponse({ tabId: tabs?.[0]?.id });
    });
    return true;
  }

  // 2) Dashboard asks the background worker to scrape a tab.
  if (request.action === 'start-solve') {
    handleScrape(request.tabId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // 2b) Atomic: scrape + call backend + fill — 1 click trên popup là đủ.
  if (request.action === 'solve-and-fill') {
    handleSolveAndFill(request.tabId, request.session)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // 2c) Settings changed — invalidate server URL cache so next request uses new URL.
  if (request.action === 'settings-updated') {
    _solveUrlCache = null;
    sendResponse({ ok: true });
    return true;
  }

  // 3) Dashboard asks the background worker to apply AI-returned answers.
  if (request.action === 'start-fill') {
    (async () => {
      try {
        const tabId = request.tabId;
        if (!tabId) return sendResponse({ error: 'Missing tabId' });

        // Ensure content script.
        const isReady = await sendMsg(tabId, { action: 'ping' });
        if (!isReady) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['scripts/content.js']
          });
          await new Promise(r => setTimeout(r, 200));
        }

        const res = await sendMsg(tabId, {
          action: 'fill',
          questions: request.questions || []
        });
        sendResponse(res || { ok: false });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});

/* ──────────────────────────────────────────────────────────────
   Main scrape flow — chỉ cào + cache, KHÔNG tự solve/fill.
   Dashboard sẽ tự gọi /solve với OpenAI key rồi gửi fill action.
────────────────────────────────────────────────────────────── */
async function handleScrape(tabId) {
  try {
    console.log('[KudaVas] Scrape started for tab', tabId);

    // 1. Ensure content script is injected.
    const isReady = await sendMsg(tabId, { action: 'ping' });
    if (!isReady) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/content.js']
      });
      await new Promise(r => setTimeout(r, 250));
    }

    // 2. Extract questions.
    const extractRes = await sendMsg(tabId, { action: 'extract' });
    const questions = extractRes?.questions || [];

    // 3. Tab metadata.
    let url = '', title = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url || '';
      title = tab.title || '';
    } catch (e) { /* tab may have closed */ }

    // 4. Cache (also used by the Dashboard before AI solves).
    await setCache(tabId, { url, title, questions, solvedAnswers: [] });

    // Forward to dashboard if it's listening.
    try {
      chrome.runtime.sendMessage({
        action: 'questions-updated',
        questions,
        detail: `${questions.length} câu hỏi từ ${title || url}`
      });
    } catch (e) { /* popup may be closed */ }

    console.log(`[KudaVas] Scrape complete — ${questions.length} question(s). Đợi Dashboard giải...`);
    return { success: true, count: questions.length };

  } catch (err) {
    console.error('[KudaVas] Background Error:', err);
    return { error: err.message };
  }
}

/* ──────────────────────────────────────────────────────────────
   Atomic solve-and-fill — 1 click trên popup là đủ.
   Flow: scrape → gọi /solve với token → fill lên tab.
────────────────────────────────────────────────────────────── */
async function handleSolveAndFill(tabId, session) {
  try {
    if (!tabId) return { error: 'Missing tabId' };
    if (!session?.token) return { error: 'Chưa đăng nhập — bấm Check trước' };

    console.log('[KudaVas] solve-and-fill started for tab', tabId);

    // 1. Ensure content script is injected.
    const isReady = await sendMsg(tabId, { action: 'ping' });
    if (!isReady) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/content.js']
      });
      await new Promise(r => setTimeout(r, 250));
    }

    // 2. Extract questions.
    const extractRes = await sendMsg(tabId, { action: 'extract' });
    const questions = extractRes?.questions || [];
    if (!questions.length) {
      return { error: 'Không tìm thấy câu hỏi nào trên trang này' };
    }

    // 3. Tab metadata.
    let url = '', title = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url || '';
      title = tab.title || '';
    } catch (e) { /* tab may have closed */ }

    // 4. Cache.
    await setCache(tabId, { url, title, questions, solvedAnswers: [] });

    // 5. POST /solve.
    const payload = questions.map(q => ({
      index: q.index,
      question: q.question,
      type: q.type,
      options: Array.isArray(q.options) ? q.options : [],
      // Matching question: cần list terms riêng để server build prompt đúng.
      terms: Array.isArray(q.terms) ? q.terms : undefined,
      url: q.url || '',
      entry_id: q.entryId || undefined,
      language: 'vi',
    }));

    // 5b. Dry-run: dừng lại ở đây, gọi /dryrun ở server để build prompt thật
    // (không gọi OpenAI). Log prompts vào Console.
    const cfg = (await chrome.storage.local.get('kudavas_settings') || {}).kudavas_settings || {};
    if (cfg.debugDryRun) {
      const dryUrl = (session.serverUrl || '').replace(/\/+$/, '') + '/dryrun';
      console.log('%c[KudaVas] 🔍 DRY-RUN — gọi /dryrun, không gọi OpenAI', 'color:#facc15;font-weight:bold');
      const dryHeaders = { 'Content-Type': 'application/json' };
      if (session.token) dryHeaders['x-token'] = session.token;
      let promptResults = [];
      try {
        const r = await fetch(dryUrl, {
          method: 'POST', headers: dryHeaders,
          body: JSON.stringify({ questions: payload }),
        }).catch(e => ({ ok: false, _err: e.message }));
        if (r.ok) {
          const data = await r.json();
          promptResults = data.prompts || [];
        } else {
          console.warn(`[KudaVas] /dryrun lỗi: HTTP ${r.status || 0} ${r._err || ''}`);
        }
      } catch (e) {
        console.warn('[KudaVas] /dryrun exception:', e);
      }

      // Log từng prompt ra Console
      if (promptResults.length) {
        promptResults.forEach(p => {
          console.group(`%c[Q${p.index}] ${p.type}`, 'color:#facc15;font-weight:bold');
          console.log('%c── SYSTEM ──', 'color:#60a5fa;font-weight:bold');
          console.log(p.system_prompt);
          console.log('%c── USER ──', 'color:#34d399;font-weight:bold');
          console.log(p.user_message);
          console.groupEnd();
        });
        console.log('%c→ Bỏ tick "Dừng trước OpenAI" trong Settings để fill thật.', 'color:#facc15');
      }
      const solvedList = payload.map((q) => ({
        index: q.index, type: q.type, question: q.question, url: q.url || '',
        answer: null, error: 'dry_run',
      }));
      await setCache(tabId, { url, title, questions, solvedAnswers: solvedList });
      try { chrome.runtime.sendMessage({ action: 'solve-done', tabId, count: 0, filled: 0 }); } catch (_) {}
      return { success: true, count: questions.length, filled: 0, dryRun: true };
    }

    // 6. POST /solve — use session token
    const solveUrl = (session.serverUrl || '').replace(/\/+$/, '') + '/solve';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (session.token) headers['x-token'] = session.token;
    const solveResp = await fetch(solveUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ questions: payload }),
    }).catch(err => ({ ok: false, status: 0, _err: err.message }));
    if (!solveResp.ok) {
      const txt = await solveResp.text().catch(() => '');
      // Handle token invalid (401) → suggest re-login
      if (solveResp.status === 401) {
        return { error: 'Token hết hạn — bấm Check để đăng nhập lại' };
      }
      return { error: `Server lỗi HTTP ${solveResp.status}: ${txt.slice(0, 200)}` };
    }
    const solveData = await solveResp.json().catch(() => ({}));
    const answers = Array.isArray(solveData) ? solveData : (solveData.answers || []);

    // 6. Map sang format fill.
    // Nếu answer là null (AI không trả lời được) → giữ null để fill skip cả câu,
    // không ép thành '' (sẽ làm fill logic im lặng skip từng select).
    const solvedList = answers.map(r => ({
      index: r.index,
      type: questions.find(q => q.index === r.index)?.type,
      question: questions.find(q => q.index === r.index)?.question || '',
      url: questions.find(q => q.index === r.index)?.url || '',
      answer: r.answer === undefined ? null : r.answer,
      error: r.error || null,
    }));

    // 7. Fill lên tab.
    const fillRes = await sendMsg(tabId, {
      action: 'fill',
      questions: solvedList,
    });
    const filledCount = fillRes?.filled ?? 0;

    // 8. Update cache with solved answers (để dashboard show).
    await setCache(tabId, { url, title, questions, solvedAnswers: solvedList });

    // 9. Notify dashboard nếu đang mở.
    try {
      chrome.runtime.sendMessage({
        action: 'solved',
        questions: solvedList,
        detail: `Đã fill ${filledCount} câu lên trang`
      });
    } catch (e) { /* popup may be closed */ }

    // 10. Show OS notification (nếu user bật trong settings).
    try {
      const stored = await chrome.storage.local.get('kudavas_settings');
      const cfg = stored?.kudavas_settings || {};
      const lang = cfg.language || 'vi';
      const showNotif = cfg.notifyOnDone !== false;
      if (showNotif && chrome.notifications) {
        const nTitle = NTF[lang]?.title || NTF.vi.title;
        const nBody  = NTF[lang]?.body(filledCount, questions.length) || NTF.vi.body(filledCount, questions.length);
        await chrome.notifications.create('kudavas-done', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: nTitle,
          message: nBody,
        });
      }
    } catch (e) { /* notifications may be blocked */ }

    console.log(`[KudaVas] solve-and-fill complete — ${filledCount} filled`);
    // Log rõ ràng những câu fail (AI không trả lời được) để user debug.
    const failed = solvedList.filter(s => s.answer === null || s.answer === undefined);
    if (failed.length > 0) {
      console.warn(
        `[KudaVas] ⚠ ${failed.length}/${questions.length} câu không có answer từ AI:`
      );
      failed.slice(0, 5).forEach(f => {
        console.warn(`  - Q[${f.index}] type=${f.type} error=${f.error || 'n/a'} question="${(f.question || '').slice(0, 60)}..."`);
      });
      if (failed.length > 5) console.warn(`  ... và ${failed.length - 5} câu nữa`);
    }
    return { success: true, count: questions.length, filled: filledCount };
  } catch (err) {
    console.error('[KudaVas] solve-and-fill error:', err);
    // Notify lỗi nếu user bật
    try {
      const stored = await chrome.storage.local.get('kudavas_settings');
      const cfg = stored?.kudavas_settings || {};
      const lang = cfg.language || 'vi';
      const showNotif = cfg.notifyOnDone !== false;
      if (showNotif && chrome.notifications) {
        const nTitle = NTF[lang]?.errTitle || NTF.vi.errTitle;
        const nBody  = NTF[lang]?.errBody(err.message) || NTF.vi.errBody(err.message);
        await chrome.notifications.create('kudavas-err', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: nTitle,
          message: nBody,
        });
      }
    } catch (_) {}
    return { error: err.message };
  }
}

/* ──────────────────────────────────────────────────────────────
   Notification i18n (UI-only)
────────────────────────────────────────────────────────────── */
const NTF = {
  vi: {
    title: '🪄 Cast Spell xong!',
    body: (filled, total) => `Đã fill ${filled}/${total} câu trả lời lên trang.`,
    errTitle: '🪄 Cast Spell lỗi',
    errBody: (msg) => msg || 'Có lỗi xảy ra.',
  },
  en: {
    title: '🪄 Cast Spell done!',
    body: (filled, total) => `Filled ${filled}/${total} answer(s) onto the page.`,
    errTitle: '🪄 Cast Spell error',
    errBody: (msg) => msg || 'Something went wrong.',
  },
  th: {
    title: '🪄 Cast Spell เสร็จแล้ว!',
    body: (filled, total) => `เติมคำตอบ ${filled}/${total} ข้อลงหน้าแล้ว`,
    errTitle: '🪄 Cast Spell ผิดพลาด',
    errBody: (msg) => msg || 'เกิดข้อผิดพลาด',
  },
};

/* ──────────────────────────────────────────────────────────────
   Clean cache when a tab is closed
────────────────────────────────────────────────────────────── */
chrome.tabs.onRemoved.addListener((tabId) => {
  cache.delete(tabId);
  chrome.storage.session.remove(`kudavas_${tabId}`).catch(() => {});
});

/* ──────────────────────────────────────────────────────────────
   Helper
────────────────────────────────────────────────────────────── */
function sendMsg(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}
