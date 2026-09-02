import React, { useEffect, useMemo, useState } from 'react';
import QuestionCard from './components/QuestionCard.jsx';
import EmptyState from './components/EmptyState.jsx';

const SERVER = 'http://127.0.0.1:8765';
const KEY_STORAGE = 'kudavas_openai_key';

const isExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

const TYPE_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'multiple_choice', label: 'Trắc nghiệm' },
  { id: 'true_false', label: 'Đúng/Sai' },
  { id: 'checkbox', label: 'Nhiều đáp án' },
  { id: 'matching', label: 'Ghép đôi' },
  { id: 'multiple_dropdowns', label: 'Điền nhiều chỗ' },
  { id: 'text_input', label: 'Tự luận' },
  { id: 'audio', label: 'Có audio' },
];

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [solved, setSolved] = useState([]);
  const [scrapedTab, setScrapedTab] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ state: 'idle', msg: 'Sẵn sàng', detail: '' });
  const [scraping, setScraping] = useState(false);

  // OpenAI key — lưu localStorage để user khỏi nhập lại mỗi lần mở popup
  const [openaiKey, setOpenaiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      // Prefer chrome.storage.local (settings page) over localStorage (legacy)
      try {
        const stored = await chrome.storage.local.get('kudavas_settings');
        if (stored?.kudavas_settings?.openaiKey) {
          setOpenaiKey(stored.kudavas_settings.openaiKey);
          return;
        }
      } catch (_) {}
      try {
        const saved = localStorage.getItem(KEY_STORAGE);
        if (saved) setOpenaiKey(saved);
      } catch (_) {}
    })();
  }, []);

  // Listen for settings updates from settings page
  useEffect(() => {
    if (!isExt) return;
    const listener = (msg) => {
      if (msg.action === 'settings-updated' && msg.settings?.openaiKey) {
        setOpenaiKey(msg.settings.openaiKey);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function persistKey(v) {
    setOpenaiKey(v);
    try { localStorage.setItem(KEY_STORAGE, v); } catch (_) {}
  }

  /* ─── Initial fetch khi mở popup lần đầu ─── */
  useEffect(() => {
    if (!isExt) return;
    chrome.runtime.sendMessage({ action: 'get-active-questions' }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp?.questions) {
        setQuestions(resp.questions);
        setStatus({ state: 'done', msg: `Đã tải ${resp.questions.length} câu hỏi`, detail: 'Từ tab đang hoạt động' });
      }
    });
  }, []);

  /* ─── Background updates ─── */
  useEffect(() => {
    if (!isExt) return;
    const listener = (msg) => {
      if (msg.action === 'questions-updated' && msg.questions) {
        setQuestions(msg.questions);
        setStatus({ state: 'done', msg: `Đã cập nhật ${msg.questions.length} câu hỏi`, detail: msg.detail || '' });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /* ─── Cào + AI solve trong 1 nút bấm ─── */
  async function handleScrape() {
    if (scraping) return;

    if (!openaiKey.trim()) {
      setStatus({ state: 'error', msg: 'Chưa có OpenAI key', detail: 'Dán sk-... vào ô phía trên rồi bấm lại.' });
      return;
    }

    setScraping(true);
    setStatus({ state: 'running', msg: 'Đang cào + giải + fill…', detail: '' });

    try {
      // 1. Lấy tab đang mở
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Không tìm thấy tab đang hoạt động');
      setScrapedTab(tab);

      // 2. Gọi atomic handler trong background (scrape + solve + fill)
      const resp = await chrome.runtime.sendMessage({
        action: 'solve-and-fill',
        tabId: tab.id,
        openaiKey: openaiKey.trim(),
      });
      if (!resp) throw new Error('Extension không phản hồi');
      if (resp.error) throw new Error(resp.error);

      const filledCount = resp?.filled ?? 0;
      const total = resp?.count ?? 0;

      // 3. Load lại questions từ cache (để dashboard show)
      const after = await chrome.runtime.sendMessage({ action: 'get-active-questions' });
      const qs = after?.questions || [];
      setQuestions(qs);

      // Reconstruct solvedList từ cache (background đã cache solvedAnswers)
      const solvedList = (qs || []).map(q => ({
        index: q.index,
        type: q.type,
        question: q.question || '',
        url: q.url || '',
        answer: '', // background không expose solvedAnswers; để user review dùng modal riêng nếu cần
      }));

      setStatus({
        state: 'done',
        msg: `Xong ${filledCount}/${total} câu`,
        detail: isExt ? `Đã fill ${filledCount} câu lên trang` : '',
      });
    } catch (err) {
      console.error(err);
      setStatus({ state: 'error', msg: 'Lỗi: ' + err.message, detail: '' });
    } finally {
      setScraping(false);
    }
  }

  const filtered = useMemo(() => {
    return questions.filter(q => {
      if (filter === 'audio') return !!q.url;
      if (filter !== 'all' && q.type !== filter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const txt = (q.question || '').toLowerCase();
        const opts = (Array.isArray(q.options) ? q.options.join(' ') : '').toLowerCase();
        if (!txt.includes(s) && !opts.includes(s)) return false;
      }
      return true;
    });
  }, [questions, filter, search]);

  const counts = useMemo(() => {
    const c = { all: questions.length, audio: 0 };
    questions.forEach(q => {
      c[q.type] = (c[q.type] || 0) + 1;
      if (q.url) c.audio += 1;
    });
    return c;
  }, [questions]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo">K</div>
          <div>
            <div className="brand-name">KudaVas Dashboard</div>
            <div className="brand-tag">Cào + AI solve trong 1 bấm</div>
          </div>
        </div>
        <div className="toolbar">
          {isExt && (
            <button
              className="primary"
              onClick={handleScrape}
              disabled={scraping}
              title={openaiKey.trim() ? 'Cào + gửi AI solve' : 'Cần OpenAI key trước'}
            >
              {scraping ? '⏳ Đang xử lý…' : '▶ Cào + AI'}
            </button>
          )}
          <button
            className="ghost"
            onClick={() => { setQuestions([]); setSolved([]); setStatus({ state: 'idle', msg: 'Đã xoá', detail: '' }); }}
            title="Xoá danh sách câu hỏi"
          >
            🗑
          </button>
        </div>
      </header>

      {/* ─── OpenAI key input ─── */}
      <div className="key-bar">
        <label className="key-label" htmlFor="openai-key">
          🔑 OpenAI Key
        </label>
        <div className="key-input-wrap">
          <input
            id="openai-key"
            className="key-input"
            type={showKey ? 'text' : 'password'}
            placeholder="sk-..."
            value={openaiKey}
            onChange={e => persistKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="key-toggle"
            onClick={() => setShowKey(s => !s)}
            type="button"
            title={showKey ? 'Ẩn key' : 'Hiện key'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
          {openaiKey && (
            <button
              className="key-clear"
              onClick={() => persistKey('')}
              type="button"
              title="Xoá key"
            >
              ✕
            </button>
          )}
        </div>
        <div className="key-actions">
          <button
            className="key-change-btn"
            onClick={() => {
              persistKey('');
              setShowKey(true);
              setStatus({ state: 'idle', msg: 'Đã xoá key', detail: 'Nhập key mới rồi bấm "▶ Cào + AI"' });
              // focus input sau khi state update
              setTimeout(() => document.getElementById('openai-key')?.focus(), 0);
            }}
            type="button"
            title={openaiKey ? 'Xoá key hiện tại để nhập key mới' : 'Nhập OpenAI key'}
          >
            🔑 Đổi key
          </button>
          <button
            className="key-change-btn"
            onClick={() => {
              if (isExt) {
                chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
              } else {
                window.open('settings.html', '_blank');
              }
            }}
            type="button"
            title="Mở trang Settings (tab mới)"
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      <div className="status-bar">
        <div className="status-pill">
          <span className={`status-dot ${status.state}`} />
          <span>{status.msg}</span>
          {status.detail && <span style={{ color: 'var(--text-mute)' }}>· {status.detail}</span>}
        </div>
        <div className="stats">
          <span className="stat"><span className="stat-value">{filtered.length}</span> / {questions.length} hiển thị</span>
          {counts.audio > 0 && <span className="stat">🔊 <span className="stat-value">{counts.audio}</span> media</span>}
        </div>
      </div>

      {questions.length > 0 && (
        <div className="filters">
          {TYPE_FILTERS.map(f => (
            <span
              key={f.id}
              className={`chip ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && counts[f.id] ? ` (${counts[f.id]})` : f.id === 'all' ? ` (${counts.all})` : ''}
            </span>
          ))}
          <input
            className="search-input"
            placeholder="Tìm trong câu hỏi…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      <main className="content">
        {questions.length === 0 ? (
          <EmptyState
            hint={isExt
              ? 'Mở một trang HTML có câu hỏi, dán OpenAI key vào ô phía trên, bấm "▶ Cào + AI" để bắt đầu.'
              : 'Đây là dashboard standalone. Build dashboard rồi load dist/dashboard/index.html vào extension popup.'}
          />
        ) : filtered.length === 0 ? (
          <EmptyState hint="Không có câu hỏi nào khớp bộ lọc hiện tại." />
        ) : (
          <div className="q-list">
            {filtered.map(q => (
              <QuestionCard key={q.index} q={q} solved={solved.find(s => s.index === q.index)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
