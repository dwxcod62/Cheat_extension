import React, { useEffect, useState } from 'react';
import { t, onLanguageChange } from '../i18n.js';

const TYPE_LABEL_KEYS = {
  multiple_choice: 'type_multiple_choice',
  true_false: 'type_true_false',
  checkbox: 'type_checkbox',
  matching: 'type_matching',
  multiple_dropdowns: 'type_multiple_dropdowns',
  text_input: 'type_text_input',
  short_answer_question: 'type_short_answer_question',
  essay_question: 'type_essay_question',
  fill_in_multiple_blanks_question: 'type_fill_in_multiple_blanks_question',
  numerical_question: 'type_numerical_question',
  'non-question': 'type_non_question',
};

function formatAnswer(ans) {
  if (ans == null || ans === '') return '';
  if (Array.isArray(ans)) return ans.join(', ');
  if (typeof ans === 'object') return JSON.stringify(ans);
  return String(ans);
}

export default function QuestionCard({ q, solved }) {
  // re-render on language change
  const [, force] = useState(0);
  useEffect(() => onLanguageChange(() => force(n => n + 1)), []);

  const cardCls = [
    'q-card',
    q.is_passage ? 'passage' : '',
    q.url ? 'audio' : '',
    solved ? 'solved' : '',
  ].filter(Boolean).join(' ');

  const typeLabel = t(TYPE_LABEL_KEYS[q.type]) || q.type || 'unknown';
  const answerText = formatAnswer(solved?.answer);
  const hasAnswer = answerText !== '';

  return (
    <div className={cardCls}>
      <div className="q-head">
        <div className="q-head-left">
          <span className="q-num">#{q.index + 1}</span>
          <span className={`q-type ${q.type}`}>{typeLabel}</span>
          {q.is_passage && (
            <span className="q-type multiple_choice" style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }}>
              {t('badge_passage')}
            </span>
          )}
        </div>
        <div>
          {q.url && (
            <span className="q-type" style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15' }}>
              {t('badge_has_media')}
            </span>
          )}
          {hasAnswer && <span className="q-type solved-badge">{t('badge_ai_answered')}</span>}
        </div>
      </div>

      <div className="q-body">
        {q.question && (
          <div
            className="q-text"
            dangerouslySetInnerHTML={{ __html: q.question }}
          />
        )}

        {Array.isArray(q.options) && q.options.length > 0 && (
          <div className="q-options">
            {q.options.map((opt, i) => {
              const optStr = String(opt);
              const matched = hasAnswer && (
                optStr === answerText
                || (Array.isArray(solved?.answer) && solved.answer.includes(optStr))
              );
              return (
                <div className={`q-option ${matched ? 'matched' : ''}`} key={i}>
                  <span className="q-option-idx">{String.fromCharCode(65 + i)}</span>
                  <span dangerouslySetInnerHTML={{ __html: optStr }} />
                </div>
              );
            })}
          </div>
        )}

        {typeof q.options === 'string' && q.options && (
          <div className="q-options">
            <div className="q-option">
              <span className="q-option-idx">🔗</span>
              <span>{q.options}</span>
            </div>
          </div>
        )}

        {q.url && (
          <div className="q-url">
            <span>🎙 </span>
            <a href={q.url} target="_blank" rel="noreferrer">{q.url}</a>
          </div>
        )}

        {hasAnswer && (
          <div className="q-answer">
            <span className="q-answer-label">{t('answer_label')}</span>
            <span className="q-answer-text">{answerText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
