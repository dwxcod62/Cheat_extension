// scripts/test_html_parsing.mjs
// Verify content.js parsers against real test_*.html files.
// Loads each HTML into JSDOM, injects a stub for chrome.* APIs,
// then calls extractQuestions() and fill() with mock answers,
// and prints a coverage report.

import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TEST_FILES = [
  'test_only_1_audio.html',
  'test_lis_with_audio.html',
  'test_3.html',
  'test_2.html',
  'new.html',
].map(f => join(ROOT, f));

// Minimal chrome.* stub for content.js — CAPTURES registered listeners
function makeChromeStub() {
  globalThis.__capturedListeners = [];
  return {
    runtime: {
      onMessage: {
        addListener: (fn) => globalThis.__capturedListeners.push(fn),
      },
      sendMessage: () => {},
      lastError: null,
    },
  };
}

async function runOnFile(htmlPath) {
  console.log('\n' + '='.repeat(70));
  console.log('FILE:', htmlPath.split(/[\\/]/).pop());
  console.log('='.repeat(70));

  const html = readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.__capturedListeners = [];
  window.chrome = makeChromeStub();

  // Inject content.js source into the DOM
  const contentSrc = readFileSync(join(ROOT, 'scripts/content.js'), 'utf8');
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = contentSrc;
  window.document.body.appendChild(scriptEl);

  // The content.js script auto-registers a chrome.runtime.onMessage listener.
  // To call extractQuestions directly we need to extract it. Easier: call via stub listener.

  // Fetch all registered listeners
  const listeners = globalThis.__capturedListeners || [];
  console.log(`[setup] Found ${listeners.length} content.js listener(s) registered.`);

  if (!listeners.length) {
    console.log('[FAIL] No listener registered.');
    return;
  }

  const handler = listeners[0];

  // === EXTRACT ===
  let extractResp;
  const extractPromise = new Promise((resolve) => {
    extractResp = (resp) => resolve(resp);
  });
  handler({ action: 'extract' }, {}, extractResp);
  const exData = await extractPromise;
  const questions = exData?.questions || [];
  console.log(`[extract] Found ${questions.length} question(s).`);
  questions.forEach((q, i) => {
    const tags = [];
    if (q.url) tags.push(`AUDIO[${q.url.slice(0, 50)}...]`);
    console.log(`  Q${i + 1} [${q.type}] ${(q.question || '').slice(0, 70)}${tags.length ? '  ' + tags.join(' ') : ''}`);
  });

  // === FILL with mocked answers ===
  const mocks = makeMockAnswers(questions);

  // Reset debug buffer before fill
  if (window.__fillDebug) window.__fillDebug.length = 0;

  const fillPromise = new Promise((resolve) => {
    handler({ action: 'fill', questions: mocks }, {}, resolve);
  });
  const fillData = await fillPromise;
  console.log(`[fill] ok=${fillData.ok}  filled=${fillData.filled}/${mocks.length}`);

  // Verify DOM state
  verifyDomState(window.document, questions);
}

function makeMockAnswers(questions) {
  // For each question, fabricate an answer that's likely to match.
  return questions.map((q) => {
    switch (q.type) {
      case 'multiple_choice':
      case 'true_false':
        return { ...q, answer: q.options?.[0] || '' };
      case 'checkbox':
        return { ...q, answer: q.options?.slice(0, 1) || [''] };
      case 'matching': {
        // Parse the "term: [opt1 | opt2]" format
        const obj = {};
        q.options?.forEach(o => {
          const m = o.match(/^([^:]+):\s*\[(.+)\]$/);
          if (m) {
            const term = m[1].trim();
            const firstOpt = m[2].split('|')[0].trim();
            obj[term] = firstOpt;
          }
        });
        return { ...q, answer: obj };
      }
      case 'multiple_dropdowns': {
        // For each blank, use the first option listed
        const arr = [];
        q.options?.forEach(o => {
          const m = o.match(/:\s*\[(.+)\]$/);
          if (m) arr.push(m[1].split(',')[0].trim());
        });
        return { ...q, answer: arr };
      }
      case 'multiple_dropdowns_string': {
        // Mimics AI returning a bare string for 1-blank dropdown
        const arr = [];
        q.options?.forEach(o => {
          const m = o.match(/:\s*\[(.+)\]$/);
          if (m) arr.push(m[1].split(',')[0].trim());
        });
        return { ...q, answer: arr[0] || '' };
      }
      case 'fill_in_multiple_blanks_question':
      case 'short_answer_question':
      case 'numerical_question':
        return { ...q, answer: 'mock answer' };
      case 'essay_question':
        return { ...q, answer: 'mock essay answer longer than ten chars' };
      default:
        return { ...q, answer: null };
    }
  });
}

function verifyDomState(doc, questions) {
  console.log('\n[verify] DOM state after fill:');
  const dqs = doc.querySelectorAll('.display_question');
  let okCount = 0, failCount = 0;
  dqs.forEach((dq, idx) => {
    const typeEl = dq.querySelector('.question_type');
    const type = typeEl?.textContent.trim() || 'unknown';
    const qid = dq.id;

    const checks = [];
    if (type === 'multiple_choice_question' || type === 'true_false_question') {
      const checked = dq.querySelector('input.question_input:checked');
      if (checked) checks.push(`checked[${checked.value}]`);
    } else if (type === 'multiple_answers_question') {
      const checked = dq.querySelectorAll('input.question_input:checked');
      checks.push(`${checked.length} ticked`);
    } else if (type === 'matching_question') {
      const selects = dq.querySelectorAll('select.question_input');
      selects.forEach((s, i) => { if (s.value) checks.push(`select${i}=${s.value}`); });
    } else if (type === 'multiple_dropdowns_question') {
      const selects = dq.querySelectorAll('select.question_input');
      selects.forEach((s, i) => { if (s.value) checks.push(`dropdown${i}=${s.value}`); else checks.push(`dropdown${i}=EMPTY`); });
    } else if (
      type === 'short_answer_question' ||
      type === 'fill_in_multiple_blanks_question' ||
      type === 'numerical_question' ||
      type === 'essay_question'
    ) {
      const inputs = dq.querySelectorAll('input.question_input, textarea.question_input');
      inputs.forEach((inp, i) => {
        checks.push(`input${i}=${(inp.value || '').slice(0, 20) || 'EMPTY'}`);
      });
    } else {
      checks.push('(skip)');
    }
    console.log(`  ${qid} [${type}]: ${checks.join(', ')}`);
    if (checks.some(c => !c.includes('EMPTY') && !c.includes('skip') && !c.includes('(skip)'))) okCount++;
    else if (!checks.some(c => c.includes('(skip)'))) failCount++;
  });
  console.log(`\n[verify] DOM filled: ${okCount} ok / ${failCount} empty`);
}

(async () => {
  for (const f of TEST_FILES) {
    try {
      await runOnFile(f);
    } catch (err) {
      console.error(`[ERROR] ${f}:`, err.message);
    }
  }
})();
