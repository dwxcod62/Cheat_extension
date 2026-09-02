// question_extractor.js
// Ports all Canvas question parsers from temp/extension/question_scripts/
// into a single ES module, running directly on the current document/tab.

// ─── TEXT NORMALIZER ────────────────────────────────────────────────────────
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
    options:    Array.isArray(result.options)
                  ? result.options.map(cleanText)
                  : result.options
  };
}

// ─── PARSERS ────────────────────────────────────────────────────────────────

function parseMultipleChoice(element) {
  try {
    const typeEl = element.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    if (type !== 'multiple_choice_question' && type !== 'true_false_question') return null;

    const questionTextEl = element.querySelector('.question_text');
    if (!questionTextEl) return null;

    const question = questionTextEl.innerText.trim();
    if (!question) return null;

    const options = [];
    element.querySelectorAll('.answer_label').forEach(label => {
      const text = label.innerText.trim();
      if (text) options.push(text);
    });

    return {
      question,
      type: type === 'true_false_question' ? 'true_false' : 'multiple_choice',
      options
    };
  } catch (err) {
    console.error('[parseMultipleChoice] Error:', err);
    return null;
  }
}

function parseCheckbox(element) {
  try {
    const typeEl = element.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    if (type !== 'multiple_answers_question') return null;

    const questionTextEl = element.querySelector('.question_text');
    if (!questionTextEl) return null;

    const question = questionTextEl.innerText.trim();
    if (!question) return null;

    const options = [];
    element.querySelectorAll('.answer_label').forEach(label => {
      const text = label.innerText.trim();
      if (text) options.push(text);
    });

    return { question, type: 'checkbox', options };
  } catch (err) {
    console.error('[parseCheckbox] Error:', err);
    return null;
  }
}

function parseTextInput(element) {
  try {
    const typeEl = element.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    const textInputTypes = [
      'short_answer_question',
      'essay_question',
      'fill_in_multiple_blanks_question',
      'numerical_question'
    ];
    if (!textInputTypes.includes(type)) return null;

    const questionTextEl = element.querySelector('.question_text');
    if (!questionTextEl) return null;

    const question = questionTextEl.innerText.trim();
    if (!question) return null;

    return { question, type: 'text_input', options: [] };
  } catch (err) {
    console.error('[parseTextInput] Error:', err);
    return null;
  }
}

function parseMatching(element) {
  try {
    const typeEl = element.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    if (type !== 'matching_question') return null;

    const questionTextEl = element.querySelector('.question_text');
    if (!questionTextEl) return null;

    const question = questionTextEl.innerText.trim();
    if (!question) return null;

    const options = [];
    element.querySelectorAll('.answers .answer').forEach(answer => {
      const termLabel = answer.querySelector('label[for]');
      const selectEl = answer.querySelector('select');
      if (!termLabel || !selectEl) return;

      const term = termLabel.innerText.trim();
      const choices = [];
      selectEl.querySelectorAll('option').forEach(opt => {
        const val = opt.textContent.trim();
        if (val && val !== '[ Choose ]') choices.push(val);
      });

      if (term) options.push(`${term}: [${choices.join(' | ')}]`);
    });

    return { question, type: 'matching', options };
  } catch (err) {
    console.error('[parseMatching] Error:', err);
    return null;
  }
}

function parseMultipleDropdowns(element) {
  try {
    const typeEl = element.querySelector('.question_type');
    const type = typeEl ? typeEl.textContent.trim() : '';
    if (type !== 'multiple_dropdowns_question') return null;

    const questionTextEl = element.querySelector('.question_text');
    if (!questionTextEl) return null;

    const clone = questionTextEl.cloneNode(true);
    clone.querySelectorAll('select').forEach(sel => {
      sel.replaceWith(document.createTextNode('___'));
    });

    const question = (clone.innerText || clone.textContent || '').trim();
    if (!question) return null;

    const options = [];
    let blankIndex = 0;
    questionTextEl.querySelectorAll('select.question_input').forEach(sel => {
      blankIndex++;
      const choices = [];
      sel.querySelectorAll('option').forEach(opt => {
        const val = opt.getAttribute('value');
        if (!val) return;
        const text = opt.textContent.trim();
        if (text && !/^\["\s*$/.test(text) && !/^\s*"]\s*$/.test(text)) {
          choices.push(text);
        }
      });
      if (choices.length > 0) options.push(`Blank ${blankIndex}: [${choices.join(', ')}]`);
    });

    return { question, type: 'multiple_dropdowns', options };
  } catch (err) {
    console.error('[parseMultipleDropdowns] Error:', err);
    return null;
  }
}

function parseIframe(element) {
  try {
    if (element.tagName && element.tagName.toLowerCase() === 'iframe') {
      return {
        question: '',
        type: 'non-question',
        url: element.src || '',
        options: ''
      };
    }
    return null;
  } catch (err) {
    console.error('[parseIframe] Error:', err);
    return null;
  }
}

// ─── PASSAGE DETECTION ──────────────────────────────────────────────────────
// A question is considered part of a "passage" if it has an embedded iframe
// (audio/video/listening) or if the question_text contains a block of reading
// text (heuristic: > 150 chars) that makes it a reading-comprehension item.
function detectIsPassage(element, url) {
  if (url) return true; // has an iframe → passage/audio
  const qEl = element.querySelector('.question_text');
  if (!qEl) return false;
  const rawText = qEl.innerText || qEl.textContent || '';
  return rawText.trim().length > 200; // long stem = probably a reading passage question
}

// ─── CORE RUNNER ────────────────────────────────────────────────────────────
const PARSERS = [
  parseMultipleChoice,
  parseCheckbox,
  parseTextInput,
  parseMatching,
  parseMultipleDropdowns,
  parseIframe,
];

export function extractQuestions(targetDocument = document) {
  const results = [];
  let currentIndex = 0;

  const questionEls = targetDocument.querySelectorAll('.display_question, iframe');

  questionEls.forEach(el => {
    if (el.tagName.toLowerCase() === 'iframe') {
      const parent = el.closest('.display_question');
      if (parent) {
        const typeEl = parent.querySelector('.question_type');
        if (typeEl && typeEl.textContent.trim() !== 'text_only_question') return;
      }
    } else {
      const typeEl = el.querySelector('.question_type');
      if (!typeEl) return;
      const rawType = typeEl.textContent.trim();
      if (rawType === 'text_only_question') return;
    }

    let matched = null;

    for (const parser of PARSERS) {
      try {
        const result = parser(el);
        if (result) { matched = result; break; }
      } catch (err) {
        console.error('[extractQuestions] Parser threw:', err);
      }
    }

    if (matched) {
      // Attach iframe URL if embedded inside a display_question
      if (!matched.url && el.classList && el.classList.contains('display_question')) {
        const iframe = el.querySelector('iframe');
        if (iframe) matched.url = iframe.src;
      }

      matched.is_passage = detectIsPassage(el, matched.url);
      matched.index = currentIndex++;

      results.push(normalizeResult(matched));
    }
  });

  return results;
}
