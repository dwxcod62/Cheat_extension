import React from 'react';

const TYPE_LABELS = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng/Sai',
  checkbox: 'Nhiều đáp án',
  matching: 'Ghép đôi',
  multiple_dropdowns: 'Điền nhiều chỗ trống',
  text_input: 'Tự luận',
  short_answer_question: 'Trả lời ngắn',
  essay_question: 'Tự luận dài',
  fill_in_multiple_blanks_question: 'Điền vào chỗ trống',
  numerical_question: 'Số',
  'non-question': 'Media',
};

function formatAnswer(ans) {
  if (ans == null || ans === '') return '';
  if (Array.isArray(ans)) return ans.join(', ');
  if (typeof ans === 'object') return JSON.stringify(ans);
  return String(ans);
}

export default function QuestionCard({ q, solved }) {
  const cardCls = [
    'q-card',
    q.is_passage ? 'passage' : '',
    q.url ? 'audio' : '',
    solved ? 'solved' : '',
  ].filter(Boolean).join(' ');

  const typeLabel = TYPE_LABELS[q.type] || q.type || 'unknown';
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
              Passage
            </span>
          )}
        </div>
        <div>
          {q.url && <span className="q-type" style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15' }}>🔊 có media</span>}
          {hasAnswer && <span className="q-type solved-badge">✓ AI trả lời</span>}
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
            <span className="q-answer-label">AI answer:</span>
            <span className="q-answer-text">{answerText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
