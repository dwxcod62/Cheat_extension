// background.js - Service worker
// - Bridges the React Dashboard popup and the content script.
// - Caches the most recent scrape per tab so the dashboard can re-read it.

importScripts('scripts/config.js');

const SERVER_URL = CONFIG.PROCESS_ENDPOINT;
const SOLVE_URL  = (typeof CONFIG.SOLVE_ENDPOINT === 'string' && CONFIG.SOLVE_ENDPOINT)
  ? CONFIG.SOLVE_ENDPOINT
  : SERVER_URL.replace(/\/+$/, '') + '/solve';

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
    handleSolveAndFill(request.tabId, request.openaiKey)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ error: err.message }));
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
   Flow: scrape → gọi /solve với OpenAI key → fill lên tab.
────────────────────────────────────────────────────────────── */
async function handleSolveAndFill(tabId, openaiKey) {
  try {
    if (!tabId) return { error: 'Missing tabId' };
    if (!openaiKey) return { error: 'Thiếu OpenAI key' };

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
      url: q.url || '',
      entry_id: q.entryId || undefined,
      language: 'vi',
    }));

    const solveResp = await fetch(SOLVE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenAI-Key': openaiKey.trim(),
      },
      body: JSON.stringify({ questions: payload }),
    }).catch(err => ({ ok: false, status: 0, _err: err.message }));
    if (!solveResp.ok) {
      const txt = await solveResp.text().catch(() => '');
      return { error: `Server lỗi HTTP ${solveResp.status}: ${txt.slice(0, 200)}` };
    }
    const solveData = await solveResp.json().catch(() => ({}));
    const answers = Array.isArray(solveData) ? solveData : (solveData.answers || []);

    // 6. Map sang format fill.
    const solvedList = answers.map(r => ({
      index: r.index,
      type: questions.find(q => q.index === r.index)?.type,
      question: questions.find(q => q.index === r.index)?.question || '',
      url: questions.find(q => q.index === r.index)?.url || '',
      answer: r.answer ?? '',
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

    console.log(`[KudaVas] solve-and-fill complete — ${filledCount} filled`);
    return { success: true, count: questions.length, filled: filledCount };
  } catch (err) {
    console.error('[KudaVas] solve-and-fill error:', err);
    return { error: err.message };
  }
}

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
