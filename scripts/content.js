// scripts/content.js
// Injected into every web page. Listens for messages from the background
// service worker and runs the question extractor on the current document.

(function () {
  if (window.__kudavasContentRegistered) return;
  window.__kudavasContentRegistered = true;

  /* ─── TEXT NORMALIZER ───────────────────────────────────── */
  function safeText(el) {
    if (!el) return '';
    // Chrome/Firefox support innerText; jsdom and some browsers may not.
    if (typeof el.innerText === 'string' && el.innerText.length) return el.innerText;
    return (el.textContent || '').replace(/\s+/g, ' ');
  }

  function cleanText(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  function normalizeResult(result) {
    if (!result || typeof result !== 'object') return result;
    return {
      index:      result.index,
      question:   cleanText(result.question),
      is_passage: result.is_passage ?? false,
      type:       result.type,
      url:        result.url || '',
      entryId:    result.entryId || '',
      options:    Array.isArray(result.options)
                    ? result.options.map(cleanText)
                    : result.options
    };
  }

  /* ─── MEDIA URL DETECTION ───────────────────────────────── */
  // Many Canvas quizzes wrap audio in an iframe that points to a *page*
  // containing a <video>/<audio> tag. We try to extract the real media
  // URL from the iframe src if possible, otherwise keep the iframe URL.
  function findMediaSrc(iframeEl) {
    if (!iframeEl) return '';
    let src = iframeEl.src || iframeEl.getAttribute('data-media-src') || '';
    if (!src) return '';

    // Some iframes use a relative path; resolve against document.
    try {
      src = new URL(src, document.baseURI).href;
    } catch (_) { /* keep original */ }

    return src;
  }

  // Try to extract Kaltura entry_id from a URL.
  // Returns { entryId, partnerId } or null.
  function parseKalturaUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (!host.includes('kaltura')) return null;
      const partnerMatch = u.pathname.match(/\/p\/(\d+)\//);
      const partnerId = partnerMatch ? partnerMatch[1] : null;
      const entryMatch =
        u.pathname.match(/entry_id\/([^/&?]+)/i) ||
        u.search.match(/[?&]entry_id=([^&]+)/i);
      const entryId = entryMatch ? decodeURIComponent(entryMatch[1]) : null;
      if (!entryId) return { entryId: null, partnerId };
      return { entryId, partnerId };
    } catch (_) {
      return null;
    }
  }

  /* ─── PARSERS ───────────────────────────────────────────── */
  function parseMultipleChoice(el) {
    const typeEl = el.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    if (type !== 'multiple_choice_question' && type !== 'true_false_question') return null;
    const qEl = el.querySelector('.question_text');
    if (!qEl) return null;
    const question = cleanText(safeText(qEl));
    if (!question) return null;
    const options = [];
    el.querySelectorAll('.answer_label').forEach(l => {
      const t = cleanText(safeText(l));
      if (t) options.push(t);
    });
    return {
      question,
      type: type === 'true_false_question' ? 'true_false' : 'multiple_choice',
      options
    };
  }

  function parseCheckbox(el) {
    const typeEl = el.querySelector('.question_type');
    if (!typeEl || typeEl.textContent.trim() !== 'multiple_answers_question') return null;
    const qEl = el.querySelector('.question_text');
    if (!qEl) return null;
    const question = cleanText(safeText(qEl));
    if (!question) return null;
    const options = [];
    el.querySelectorAll('.answer_label').forEach(l => {
      const t = cleanText(safeText(l));
      if (t) options.push(t);
    });
    return { question, type: 'checkbox', options };
  }

  function parseTextInput(el) {
    const typeEl = el.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    const valid = [
      'short_answer_question',
      'essay_question',
      'fill_in_multiple_blanks_question',
      'numerical_question'
    ];
    if (!valid.includes(type)) return null;
    const qEl = el.querySelector('.question_text');
    if (!qEl) return null;
    const question = cleanText(safeText(qEl));
    if (!question) return null;
    return { question, type, options: [] };
  }

  function parseMatching(el) {
    const typeEl = el.querySelector('.question_type');
    if (!typeEl || typeEl.textContent.trim() !== 'matching_question') return null;
    const qEl = el.querySelector('.question_text');
    if (!qEl) return null;
    const question = cleanText(safeText(qEl));
    if (!question) return null;

    const terms = [];
    const definitionSet = new Set();
    el.querySelectorAll('.answers .answer').forEach(ans => {
      const termLabel = ans.querySelector('label[for]');
      const selectEl = ans.querySelector('select');
      if (!termLabel || !selectEl) return;
      const term = cleanText(safeText(termLabel));
      if (term) terms.push(term);
      // Thu thập definitions (bỏ placeholder), deduplicate
      selectEl.querySelectorAll('option').forEach(opt => {
        const v = opt.textContent.trim();
        if (v && v !== '[ Choose ]' && v !== '[ Select ]') definitionSet.add(v);
      });
    });
    if (!terms.length) return null;

    return {
      question,
      type: 'matching',
      // Terms đứng riêng (label ở mỗi row dropdown)
      terms,
      // Definitions là các option trong select (unique, không có placeholder)
      options: Array.from(definitionSet),
    };
  }

  function parseMultipleDropdowns(el) {
    const typeEl = el.querySelector('.question_type');
    if (!typeEl || typeEl.textContent.trim() !== 'multiple_dropdowns_question') return null;
    const qEl = el.querySelector('.question_text');
    if (!qEl) return null;
    const clone = qEl.cloneNode(true);
    clone.querySelectorAll('select').forEach(s => s.replaceWith(document.createTextNode('___')));
    const question = cleanText(safeText(clone));
    if (!question) return null;
    const options = [];
    let idx = 0;
    qEl.querySelectorAll('select.question_input').forEach(sel => {
      idx++;
      const choices = extractSelectChoices(sel);
      if (choices.length) options.push(`Blank ${idx}: [${choices.join(', ')}]`);
    });
    return { question, type: 'multiple_dropdowns', options };
  }

  /**
   * Robust select-options extractor.
   * Canvas renders options in 2 different shapes:
   *  (A) Normal: <option value="3815">lightning</option>
   *  (B) Quoted JSON-as-text:
   *      <option value="" selected>[ Select ]</option>
   *      <option value="">["<option value="3815">lightning</option>", "..."]</option>
   *  (C) Unquoted, with literal HTML tags inside textContent:
   *      <option value="">"<option value="3815">lightning</option>"</option>
   *
   * Returns: ['lightning', 'storm', ...]
   */
  function extractSelectChoices(sel) {
    // Canvas renders options in different shapes depending on quiz version:
    //  (A) Normal: <option value="3815">lightning</option>  (most common)
    //  (B) Pre-render JSON-as-text:
    //      <option value="" selected>[ Select ]</option>
    //      <option value="">["<option value="3815">lightning</option>", "..."]</option>
    //
    // Returns: ['lightning', 'storm', ...]
    const out = [];
    const seen = new Set();

    sel.querySelectorAll('option').forEach(opt => {
      const text = (opt.textContent || '').trim();
      const val = opt.getAttribute('value');

      // Filter placeholder / metadata
      if (!text) return;
      if (text === '[ Select ]' || text === '[ Choose ]') return;
      // Filter entries that are JUST quote/brackets fragments
      if (/^[\s\[]*"$/.test(text) || /^"\s*[\],]?$/.test(text)) return;

      // (A) NORMAL — single option with plain text
      if (val && !text.includes('<option') && !text.startsWith('[') && !text.startsWith('"<')) {
        // Skip if text is too long (suggests it's the JSON-as-text container, not a real label)
        if (text.length < 100) {
          if (!seen.has(text)) { seen.add(text); out.push(text); }
          return;
        }
      }

      // (B) JSON-as-text: parse "<option value=X">LABEL</option>" items
      if (text.includes('<option') || text.startsWith('[')) {
        const itemRe = /value\s*=\s*['"]([^'"]+)['"][^>]*>([^<]+)<\/option>/gi;
        let m;
        let pushed = false;
        while ((m = itemRe.exec(text)) !== null) {
          const label = m[2].trim();
          if (label && !seen.has(label)) { seen.add(label); out.push(label); pushed = true; }
        }
        if (pushed) return;
      }

      // Fallback — use text as a single choice
      if (text && !seen.has(text) && text.length < 100) {
        seen.add(text); out.push(text);
      }
    });

    return out;
  }

  function parseIframe(el) {
    if (el.tagName && el.tagName.toLowerCase() === 'iframe') {
      return { question: '', type: 'non-question', url: el.src || '', options: [] };
    }
    return null;
  }

  // Catch-all for HTML pages that don't follow Canvas's class scheme.
  // Detects any container holding a question + answer inputs.
  function parseGenericQuiz(el) {
    if (!el || !el.querySelector) return null;
    const textEl = el.querySelector('.question, .question-text, .questionText, h2, h3, .title, p');
    if (!textEl) return null;
    const question = cleanText(safeText(textEl));
    if (question.length < 5) return null;

    const radios = el.querySelectorAll('input[type="radio"]');
    const checks = el.querySelectorAll('input[type="checkbox"]');
    if (radios.length > 0) {
      const opts = [];
      radios.forEach(r => {
        const lab = r.closest('label') || document.querySelector(`label[for="${r.id}"]`);
        const t = lab ? cleanText(safeText(lab)) : '';
        if (t) opts.push(t);
      });
      if (opts.length > 0) return { question, type: 'multiple_choice', options: opts };
    } else if (checks.length > 0) {
      const opts = [];
      checks.forEach(c => {
        const lab = c.closest('label') || document.querySelector(`label[for="${c.id}"]`);
        const t = lab ? cleanText(safeText(lab)) : '';
        if (t) opts.push(t);
      });
      if (opts.length > 0) return { question, type: 'checkbox', options: opts };
    }
    return null;
  }

  const PARSERS = [
    parseMultipleChoice,
    parseCheckbox,
    parseTextInput,
    parseMatching,
    parseMultipleDropdowns,
    parseIframe,
    parseGenericQuiz
  ];

  function detectIsPassage(el, url) {
    if (url) return true;
    const qEl = el.querySelector?.('.question_text');
    if (!qEl) {
      const txt = cleanText(safeText(el));
      return txt.length > 200;
    }
    return cleanText(safeText(qEl)).length > 200;
  }

  /* ─── CORE EXTRACTOR ────────────────────────────────────── */
  /**
   * Defensive pre-pass: convert any .question_text that is empty but has a
   * hidden .original_question_text textarea into proper HTML.
   * This handles cases where content script runs before Canvas's JS converts
   * the textarea into rich content (esp. for multiple_dropdowns/matching).
   */
  function hydrateQuestionText() {
    document.querySelectorAll('.display_question').forEach(dq => {
      const qt = dq.querySelector('.question_text');
      if (!qt) return;
      const hasContent = (qt.children.length > 0) || (qt.textContent || '').trim().length > 0;
      if (hasContent) return;
      const textarea = dq.querySelector('.original_question_text textarea.textarea_question_text');
      if (!textarea) return;
      const raw = (textarea.value || textarea.textContent || '').trim();
      if (!raw) return;
      try {
        const tmp = document.createElement('div');
        tmp.innerHTML = raw;
        // Move all children into the .question_text
        while (tmp.firstChild) qt.appendChild(tmp.firstChild);
      } catch (_) { /* ignore malformed HTML */ }
    });
  }

  function extractQuestions() {
    hydrateQuestionText();
    const results = [];
    let idx = 0;

    // Pass 1: prefer Canvas-style selectors
    const els = document.querySelectorAll('.display_question, iframe');
    els.forEach(el => {
      if (el.tagName && el.tagName.toLowerCase() === 'iframe') {
        const parent = el.closest('.display_question');
        if (parent) {
          const typeEl = parent.querySelector('.question_type');
          if (typeEl && typeEl.textContent.trim() !== 'text_only_question') return;
        }
      } else {
        const typeEl = el.querySelector('.question_type');
        if (!typeEl) return;
        if (typeEl.textContent.trim() === 'text_only_question') return;
      }

      let matched = null;
      for (const parser of PARSERS) {
        try {
          const r = parser(el);
          if (r) { matched = r; break; }
        } catch (e) { console.error('[KudaVas] parser error:', e); }
      }

      if (matched) {
        // Attach iframe URL (audio/video) if embedded inside a display_question.
        if (!matched.url && el.classList && el.classList.contains('display_question')) {
          const iframe = el.querySelector('iframe');
          if (iframe) {
            matched.url = findMediaSrc(iframe);
            // If Kaltura embed loader, save entry_id so server can build a proper player URL.
            if (matched.url) {
              const k = parseKalturaUrl(matched.url);
              if (k && k.entryId) matched.entryId = k.entryId;
            }
          }
        }
        matched.is_passage = detectIsPassage(el, matched.url);
        matched.index = idx++;
        results.push(normalizeResult(matched));
      }
    });

    // Pass 2: fallback — if nothing was found, scan the body for any quiz-like block.
    if (results.length === 0) {
      const candidates = document.querySelectorAll('.question, [data-question], fieldset');
      candidates.forEach(el => {
        const r = parseGenericQuiz(el);
        if (r) {
          r.is_passage = false;
          r.index = idx++;
          results.push(normalizeResult(r));
        }
      });
    }

    return results;
  }

  /* ─── KEYBOARD SHORTCUT LISTENER ─────────────────────────
     Loads shortcut from chrome.storage.local (set via settings.html)
     and triggers solve-and-fill when the bound key combo is pressed.
  ─────────────────────────────────────────────────────────── */
  let shortcutBound = 'Ctrl+Alt+I';
  let shortcutEnabled = true;
  let shortcutTriggering = false;

  // Load on startup
  try {
    chrome.storage.local.get('kudavas_settings', (s) => {
      const cfg = s?.kudavas_settings;
      if (cfg?.shortcut) shortcutBound = cfg.shortcut;
      if (typeof cfg?.shortcutEnabled === 'boolean') shortcutEnabled = cfg.shortcutEnabled;
      console.log(`%c[KudaVas] shortcut="${shortcutBound}" enabled=${shortcutEnabled}`, 'color:#06b6d4');
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.kudavas_settings) return;
      const cfg = changes.kudavas_settings.newValue || {};
      if (cfg.shortcut) shortcutBound = cfg.shortcut;
      if (typeof cfg.shortcutEnabled === 'boolean') shortcutEnabled = cfg.shortcutEnabled;
    });
  } catch (_) {}

  function eventToShortcut(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push(e.metaKey ? 'Cmd' : 'Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
    parts.push(key);
    return parts.join('+');
  }

  document.addEventListener('keydown', async (e) => {
    if (!shortcutEnabled) return;
    // Don't trigger while typing in input/textarea/contenteditable
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) {
      // Allow if it's a single-char key without alphanumerics — but skip
      return;
    }
    const sc = eventToShortcut(e);
    if (!sc || sc !== shortcutBound) return;

    e.preventDefault();
    e.stopPropagation();

    if (shortcutTriggering) return;
    shortcutTriggering = true;

    showToast('⏳ Đang cào + AI solve + fill…', 'info');

    try {
      // Guard: nếu extension vừa reload, runtime context có thể invalid
      if (!chrome.runtime?.id) {
        showToast('⚠️ Extension vừa reload — tải lại trang (F5) rồi thử lại.', 'warn');
        return;
      }
      const tabId = await getTabId();
      // OpenAI key do server quản lý; chỉ cần gửi tabId.

      const resp = await chrome.runtime.sendMessage({
        action: 'solve-and-fill',
        tabId,
      });

      if (resp?.error) {
        showToast('❌ ' + resp.error, 'err');
      } else {
        showToast(`✓ Đã fill ${resp?.filled ?? '?'}/${resp?.count ?? '?'} câu`, 'ok');
      }
    } catch (err) {
      console.error('[KudaVas] shortcut error:', err);
      const msg = err?.message || String(err);
      if (/Extension context invalidated/i.test(msg) || /Receiving end does not exist/i.test(msg)) {
        showToast('⚠️ Extension vừa reload — bấm F5 trên trang rồi thử lại.', 'warn');
      } else {
        showToast('❌ ' + msg, 'err');
      }
    } finally {
      setTimeout(() => { shortcutTriggering = false; }, 1000);
    }
  });

  async function getTabId() {
    // Try chrome.tabs API; fallback to runtime.getURL
    try {
      // Background can't be queried directly from content script for tabId,
      // but the message handler will use sender.tab.id; we just need a sentinel.
      // The background solve-and-fill handles its own tab discovery if tabId missing.
      // We can pass our own tabId via chrome.runtime.sendMessage({action:'get-tab-id'}).
      const r = await chrome.runtime.sendMessage({ action: 'get-tab-id' });
      return r?.tabId;
    } catch (_) { return undefined; }
  }

  function showToast(text, kind = 'info') {
    const colors = { info: '#06b6d4', ok: '#10b981', err: '#ef4444' };
    const id = '__kudavas_toast__';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 20px;border-radius:8px;background:rgba(0,0,0,0.92);color:white;font-family:-apple-system,Inter,sans-serif;font-size:14px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,0.4);backdrop-filter:blur(8px);transition:opacity 0.2s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.borderLeft = `4px solid ${colors[kind] || '#06b6d4'}`;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 3000);
  }

  /* ─── MESSAGE LISTENER ──────────────────────────────────── */
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

    if (request.action === 'ping') { sendResponse(true); return true; }

    if (request.action === 'extract') {
      let questions = [];
      try {
        questions = extractQuestions();
        console.log(
          `%c[KudaVas] Loaded ${questions.length} question(s)`,
          'color:#ef4444;font-weight:bold'
        );
      } catch (err) {
        console.error('[KudaVas] extractQuestions failed:', err);
      }
      sendResponse({ questions });
      return true;
    }

    // ── FILL ACTION ─────────────────────────────────────────────
    if (request.action === 'fill') {
      const answers = request.questions || [];
      if (!answers.length) {
        console.warn('%c[KudaVas] Filling — no answers to apply', 'color:#facc15;font-weight:bold');
        sendResponse({ ok: false, reason: 'empty' });
        return true;
      }

      console.log('%c[KudaVas] Filling — applying answers to the page...', 'color:#facc15;font-weight:bold');

      const questionEls = document.querySelectorAll('.display_question');
      let filled = 0;

      // Precompute "normalized" text for each .display_question — replace
      // <select>, <input>, <textarea> with placeholders so dropdown/blank
      // questions match the parser's text (which replaces them with ___).
      const qTextCache = new Map();
      const normalizedText = (el) => {
        if (qTextCache.has(el)) return qTextCache.get(el);
        const qt = el.querySelector('.question_text');
        if (!qt) { qTextCache.set(el, ''); return ''; }
        const clone = qt.cloneNode(true);
        clone.querySelectorAll('select, input, textarea').forEach(n => {
          n.replaceWith(clone.ownerDocument.createTextNode('___'));
        });
        const txt = cleanText(safeText(clone));
        qTextCache.set(el, txt);
        return txt;
      };

      answers.forEach((ansObj, i) => {
        const { question: targetQ, answer, type, url: targetUrl } = ansObj;
        if (answer === undefined || answer === null) return;
        const cleanTargetQ = cleanText(targetQ || '');

        let targetEl = null;
        for (const el of questionEls) {
          const qTextEl = el.querySelector('.question_text');
          if (!qTextEl) continue;
          if (targetUrl) {
            const iframe = el.querySelector('iframe');
            if (iframe && iframe.src === targetUrl) { targetEl = el; break; }
          }
          const currentQText = normalizedText(el);
          if (currentQText && cleanTargetQ && (
              currentQText.indexOf(cleanTargetQ) >= 0 ||
              cleanTargetQ.indexOf(currentQText) >= 0
          )) {
            targetEl = el; break;
          }
        }

        if (!targetEl) {
          return;
        }

        console.log(`%c[KudaVas] Q${i + 1} — Filling [${type}]`, 'color:#4ade80', { question: targetQ, answer });

        // If AI trả null/undefined answer → skip cả câu với warning rõ ràng
        if (answer === null || answer === undefined || answer === '') {
          console.warn(
            `%c[KudaVas] ⚠ Q${i + 1} (${type}) — no answer from AI, skipping. ` +
            `error=${ansObj.error || 'n/a'}`,
            'color:#fbbf24;font-weight:bold'
          );
          return;
        }

        try {
          if (type === 'multiple_choice' || type === 'true_false') {
            const cleanAns = cleanText(String(answer));
            let picked = false;
            targetEl.querySelectorAll('.answer_label').forEach(label => {
              const t = cleanText(safeText(label));
              if (t === cleanAns || t.includes(cleanAns) || cleanAns.includes(t)) {
                const input = label.closest('.answer')?.querySelector('input');
                if (input && !input.checked) input.click();
                picked = true;
              }
            });
            if (picked) filled++;
          }
          else if (type === 'checkbox') {
            const arr = (Array.isArray(answer) ? answer : [answer]).map(a => cleanText(String(a)));
            let picked = false;
            targetEl.querySelectorAll('.answer_label').forEach(label => {
              const t = cleanText(safeText(label));
              if (arr.some(a => t === a || t.includes(a))) {
                const input = label.closest('.answer')?.querySelector('input');
                if (input && !input.checked) input.click();
                picked = true;
              }
            });
            if (picked) filled++;
          }
          else if (type === 'matching') {
            // answer: { "<term>": "<definition>", ... }
            const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
            let pickedCount = 0;

            // Build a flat list of {sel, label} for every dropdown in the question,
            // because Canvas renders matching as multiple .answer > label+select rows.
            // Walk up the tree until we find a sibling label with non-empty text.
            const selectPool = Array.from(targetEl.querySelectorAll('select')).map(sel => {
              let contextText = '';
              let node = sel;
              for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const lbl = node.querySelector('label[for]') || node.querySelector('label');
                if (lbl) {
                  contextText = cleanText(safeText(lbl));
                  if (contextText) break;
                }
              }
              return { sel, contextText, used: false };
            });

            // Normalize text để so khớp khi AI trả về hơi khác (apostrophe, punctuation, case).
            //   "earth's" vs "earths" → normalize cả 2 về cùng dạng
            //   "Earthquake" vs "earthquake " → lowercase + trim
            const norm = (s) => cleanText(String(s))
              .toLowerCase()
              .replace(/[''`´]/g, "'")   // smart quotes → straight
              .replace(/[^a-z0-9\s]/g, ' ') // bỏ punctuation
              .replace(/\s+/g, ' ')
              .trim();

            // Pair terms → definitions and fill each select.
            // Each select is consumed at most once per question so two
            // matching_questions back-to-back don't bleed indices.
            const entries = Object.entries(obj);
            for (const [term, def] of entries) {
              const cleanT = cleanText(String(term));
              const cleanD = cleanText(String(def));
              if (!cleanT || !cleanD) continue;

              // Prefer an unused select whose surrounding text mentions the term.
              let targetIdx = selectPool.findIndex(p => !p.used && p.contextText.includes(cleanT));
              if (targetIdx < 0) {
                // Fallback: pick the first unused select in order.
                targetIdx = selectPool.findIndex(p => !p.used);
              }
              if (targetIdx < 0) continue; // no free selects left in this question

              const targetSel = selectPool[targetIdx];
              const sel = targetSel.sel;
              const normD = norm(def);
              let matched = false;
              for (const opt of sel.options) {
                const optT = cleanText(opt.text);
                if (!optT || optT === '[ Select ]' || optT === '[ Choose ]') continue;

                // Layer 1: exact / contains match (đã có)
                let ok = optT === cleanD || optT.includes(cleanD) || cleanD.includes(optT);
                // Layer 2: normalized match (handle apostrophe/punctuation/case)
                if (!ok && normD) {
                  const normOpt = norm(optT);
                  ok = normOpt === normD || normOpt.includes(normD) || normD.includes(normOpt);
                }
                if (!ok) {
                  // JSON-as-string fallback
                  const optText = opt.text || '';
                  if (optText.includes('<option')) {
                    const re = /value\s*=\s*"([^"]+)"[^>]*>([^<]+)<\/option>/gi;
                    let m;
                    while ((m = re.exec(optText)) !== null) {
                      const label = m[2].trim();
                      if (label === cleanD || label.includes(cleanD) || cleanD.includes(label)) {
                        sel.value = m[1];
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        matched = true;
                        break;
                      }
                      if (normD) {
                        const normLbl = norm(label);
                        if (normLbl === normD || normLbl.includes(normD) || normD.includes(normLbl)) {
                          sel.value = m[1];
                          sel.dispatchEvent(new Event('change', { bubbles: true }));
                          matched = true;
                          break;
                        }
                      }
                    }
                    if (matched) break;
                  }
                  continue;
                }
                if (ok) {
                  if (opt.value) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    matched = true;
                  }
                  break;
                }
              }

              if (matched) {
                targetSel.used = true;
                pickedCount++;
                console.log(`%c[KudaVas] matching ✓ "${cleanT}" → "${cleanD}" (sel.value="${sel.value}")`, 'color:#10b981');
              } else {
                console.log(`%c[KudaVas] matching ✗ "${cleanT}" → "${cleanD}" — no option matched`, 'color:#ef4444');
              }
            }

            if (pickedCount > 0) filled++;
          }
          else if (type === 'multiple_dropdowns') {
            // Normalize answer to array of strings
            let arr;
            if (Array.isArray(answer)) {
              arr = answer;
            } else if (answer && typeof answer === 'object') {
              // Object case: take values in numeric-key order, fall back to insertion order
              arr = Object.values(answer).map(v => String(v));
            } else if (answer === null || answer === undefined || answer === '') {
              arr = [];
            } else {
              arr = [String(answer)];
            }

            const selects = targetEl.querySelectorAll('.question_text select');
            console.log(`%c[KudaVas] multi-dropdown fill — answer=${JSON.stringify(answer)} → arr=${JSON.stringify(arr)} selects=${selects.length}`, 'color:#06b6d4');

            // If AI trả thiếu items, log cảnh báo để debug — không silent skip
            if (arr.length !== selects.length) {
              console.warn(
                `%c[KudaVas] ⚠ multi-dropdown length mismatch: ${arr.length} answers vs ${selects.length} blanks. ` +
                `Last ${Math.max(0, selects.length - arr.length)} blank(s) will be skipped.`,
                'color:#fbbf24;font-weight:bold'
              );
            }

            let picked = false;
            selects.forEach((sel, idx) => {
              if (!arr[idx]) {
                console.log(`  [sel ${idx}] no answer for this blank (arr[${idx}]=undefined)`);
                return;
              }
              const val = cleanText(String(arr[idx]));
              if (!val) return;
              console.log(`  [sel ${idx}] target value="${val}" current sel.value="${sel.value}" options=${sel.options.length}`);

              // Try every option text directly first
              let matched = false;
              for (const opt of sel.options) {
                const optT = cleanText(opt.text);
                if (!optT) continue;
                // Skip the "[ Select ]" placeholder
                if (optT === '[ Select ]' || optT === '[ Choose ]') continue;
                if (optT === val || optT.includes(val) || val.includes(optT)) {
                  if (opt.value) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log(`    ✓ matched opt.text "${optT}" → value "${opt.value}"`);
                    picked = true; matched = true;
                    break;
                  }
                }
              }

              // Fallback: option text is JSON-as-string ("\"<option value=X>LABEL</option>\", ...")
              // Need to find label inside that string and use its value
              if (!matched) {
                for (const opt of sel.options) {
                  const text = opt.text || '';
                  if (!text.includes('<option')) continue;
                  // Supports: value="X">LABEL</option> (quoted value, any chars before >)
                  // Also: value="X" >LABEL</option> (space before >)
                  const re = /value\s*=\s*"([^"]+)"[^>]*>([^<]+)<\/option>/gi;
                  let m;
                  while ((m = re.exec(text)) !== null) {
                    const label = m[2].trim();
                    if (!label) continue;
                    if (label === val || label.includes(val) || val.includes(label)) {
                      sel.value = m[1];
                      sel.dispatchEvent(new Event('change', { bubbles: true }));
                      console.log(`    ✓ JSON-fallback matched label "${label}" → value "${m[1]}"`);
                      picked = true; matched = true;
                      break;
                    }
                  }
                  if (matched) break;
                }
              }

              if (!matched) {
                console.log(`    ✗ NO MATCH for value="${val}". Available options:`);
                for (const opt of sel.options) {
                  console.log(`        - value="${opt.value}" text="${opt.textContent.slice(0, 60)}"`);
                }
              }
            });
            if (picked) filled++;
          }
          else if (
            type === 'text_input' ||
            type === 'short_answer_question' ||
            type === 'essay_question' ||
            type === 'numerical_question'
          ) {
            // Single-input types
            const input = targetEl.querySelector(
              'input.question_input, textarea.question_input, input[type="text"], textarea'
            );
            if (input) {
              input.value = String(answer);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              filled++;
            }
          }
          else if (type === 'fill_in_multiple_blanks_question') {
            // Mỗi blank = 1 input.question_input nằm trong .question_text.
            // AI có thể trả string (chỉ blank đầu) hoặc array (đầy đủ).
            const inputs = Array.from(
              targetEl.querySelectorAll(
                '.question_text input.question_input, .question_text textarea.question_input'
              )
            );
            if (!inputs.length) {
              // Fallback: scan toàn question element
              inputs.push(...targetEl.querySelectorAll('input.question_input, textarea.question_input'));
            }
            if (!inputs.length) return;

            // Chuẩn hóa answer thành array
            let arr;
            if (Array.isArray(answer)) {
              arr = answer.map(x => String(x ?? '').trim()).filter(Boolean);
              // Nếu array rỗng sau filter, fallback string
              if (!arr.length) arr = [String(answer[0] ?? '')];
            } else {
              arr = [String(answer ?? '')];
            }

            let filledAny = false;
            inputs.forEach((inp, i) => {
              // Nếu AI chỉ trả 1 giá trị, lặp lại cho mọi blank
              // (matches prompt spec: "STRING that fills the FIRST blank" — tốt nhất lặp)
              const v = arr[i] ?? arr[0];
              if (!v) return;
              inp.value = v;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              filledAny = true;
            });
            if (filledAny) filled++;
          }
        } catch (fillErr) {
          console.error(`[KudaVas] Q${i + 1} fill error:`, fillErr);
        }
      });

      console.log(`%c[KudaVas] Filled ${filled}/${answers.length} answer(s).`, 'color:#22c55e;font-weight:bold');
      sendResponse({ ok: true, filled });
      return true;
    }
  });

  console.log('%c[KudaVas] Content script ready.', 'color:#a855f7;font-weight:bold');
})();
