import React, { useEffect, useMemo, useState } from 'react';
import QuestionCard from './components/QuestionCard.jsx';
import EmptyState from './components/EmptyState.jsx';
import { t, loadStoredLanguage, onLanguageChange, getLanguage } from './i18n.js';

const SERVER = 'http://127.0.0.1:8765';
const KEY_STORAGE = 'kudavas_openai_key';

const isExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

const FILTER_IDS = ['all', 'multiple_choice', 'true_false', 'checkbox', 'matching', 'multiple_dropdowns', 'text_input', 'audio'];

const FILTER_LABEL_KEYS = {
  all: 'filter_all',
  multiple_choice: 'filter_multiple_choice',
  true_false: 'filter_true_false',
  checkbox: 'filter_checkbox',
  matching: 'filter_matching',
  multiple_dropdowns: 'filter_multiple_dropdowns',
  text_input: 'filter_text_input',
  audio: 'filter_audio',
};

export default function App() {
  const [questions, setQuestions] = useState([]);
  const [solved, setSolved] = useState([]);
  const [scrapedTab, setScrapedTab] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ state: 'idle' });
  const [scraping, setScraping] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [, forceRerender] = useState(0);

  // Initial load: storage key + language
  useEffect(() => {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('kudavas_settings');
        if (stored?.kudavas_settings?.openaiKey) {
          setOpenaiKey(stored.kudavas_settings.openaiKey);
        }
      } catch (_) {}
      try {
        const saved = localStorage.getItem(KEY_STORAGE);
        if (saved && !openaiKey) setOpenaiKey(saved);
      } catch (_) {}
    })();
    loadStoredLanguage().then(() => forceRerender(n => n + 1));
    const off = onLanguageChange(() => forceRerender(n => n + 1));
    return () => off();
  }, []);

  // Listen for settings updates from settings page
  useEffect(() => {
    if (!isExt) return;
    const listener = (msg) => {
      if (msg.action === 'settings-updated') {
        if (msg.settings?.openaiKey) setOpenaiKey(msg.settings.openaiKey);
        if (msg.settings?.language) {
          // i18n module already updated via setLanguage — just re-render
          forceRerender(n => n + 1);
        }
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
        setStatus({
          state: 'done',
          msg: t('status_loaded', resp.questions.length),
          detail: t('status_loaded_detail'),
        });
      }
    });
  }, []);

  /* ─── Background updates ─── */
  useEffect(() => {
    if (!isExt) return;
    const listener = (msg) => {
      if (msg.action === 'questions-updated' && msg.questions) {
        setQuestions(msg.questions);
        setStatus({
          state: 'done',
          msg: t('status_updated', msg.questions.length),
          detail: msg.detail || '',
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /* ─── Cào + AI solve trong 1 nút bấm ─── */
  async function handleScrape() {
    if (scraping) return;

    if (!openaiKey.trim()) {
      setStatus({
        state: 'error',
        msg: t('status_no_key'),
        detail: t('status_no_key_detail'),
      });
      return;
    }

    setScraping(true);
    setStatus({ state: 'running', msg: t('status_running'), detail: '' });

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Không tìm thấy tab đang hoạt động');
      setScrapedTab(tab);

      const resp = await chrome.runtime.sendMessage({
        action: 'solve-and-fill',
        tabId: tab.id,
        openaiKey: openaiKey.trim(),
      });
      if (!resp) throw new Error('Extension không phản hồi');
      if (resp.error) throw new Error(resp.error);

      const filledCount = resp?.filled ?? 0;
      const total = resp?.count ?? 0;

      const after = await chrome.runtime.sendMessage({ action: 'get-active-questions' });
      const qs = after?.questions || [];
      setQuestions(qs);

      setStatus({
        state: 'done',
        msg: t('status_done', filledCount, total),
        detail: isExt ? t('status_done_detail', filledCount) : '',
      });
    } catch (err) {
      console.error(err);
      setStatus({
        state: 'error',
        msg: t('status_error_prefix') + err.message,
        detail: '',
      });
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

  // Default status text for idle
  const statusMsg = status.msg ?? (status.state === 'idle' ? t('status_idle') : '');

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo">K</div>
          <div>
            <div className="brand-name">{t('brand_name')}</div>
            <div className="brand-tag">{t('brand_tag')}</div>
          </div>
        </div>
        <div className="toolbar">
          {isExt && (
            <button
              className="primary"
              onClick={handleScrape}
              disabled={scraping}
              title={openaiKey.trim() ? t('btn_scrape_title') : t('btn_scrape_title_no_key')}
            >
              {scraping ? t('btn_scraping') : t('btn_scrape')}
            </button>
          )}
          <button
            className="ghost"
            onClick={() => {
              setQuestions([]);
              setSolved([]);
              setStatus({ state: 'idle', msg: t('status_cleared'), detail: '' });
            }}
            title={t('btn_clear_title')}
          >
            🗑
          </button>
        </div>
      </header>

      {/* ─── OpenAI key input ─── */}
      <div className="key-bar">
        <label className="key-label" htmlFor="openai-key">
          {t('key_label')}
        </label>
        <div className="key-input-wrap">
          <input
            id="openai-key"
            className="key-input"
            type={showKey ? 'text' : 'password'}
            placeholder={t('key_placeholder')}
            value={openaiKey}
            onChange={e => persistKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="key-toggle"
            onClick={() => setShowKey(s => !s)}
            type="button"
            title={showKey ? t('key_hide') : t('key_show')}
          >
            {showKey ? '🙈' : '👁'}
          </button>
          {openaiKey && (
            <button
              className="key-clear"
              onClick={() => persistKey('')}
              type="button"
              title={t('key_clear')}
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
              setStatus({
                state: 'idle',
                msg: t('status_key_cleared'),
                detail: t('status_key_cleared_detail'),
              });
              setTimeout(() => document.getElementById('openai-key')?.focus(), 0);
            }}
            type="button"
            title={openaiKey ? t('key_change_title_with') : t('key_change_title_without')}
          >
            {t('key_change')}
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
            title={t('btn_open_settings_title')}
          >
            {t('btn_open_settings')}
          </button>
        </div>
      </div>

      <div className="status-bar">
        <div className="status-pill">
          <span className={`status-dot ${status.state}`} />
          <span>{statusMsg}</span>
          {status.detail && <span style={{ color: 'var(--text-mute)' }}>· {status.detail}</span>}
        </div>
        <div className="stats">
          <span className="stat">
            <span className="stat-value">{filtered.length}</span> / {t('stat_visible', filtered.length, questions.length).split('/').slice(1).join('/').trim()}
          </span>
          {counts.audio > 0 && (
            <span className="stat">
              <span className="stat-value">{counts.audio}</span> {t('stat_audio', counts.audio).split(/\s/).slice(1).join(' ')}
            </span>
          )}
        </div>
      </div>

      {questions.length > 0 && (
        <div className="filters">
          {FILTER_IDS.map(id => (
            <span
              key={id}
              className={`chip ${filter === id ? 'active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {t(FILTER_LABEL_KEYS[id])}
              {id !== 'all' && counts[id] ? ` (${counts[id]})` : id === 'all' ? ` (${counts.all})` : ''}
            </span>
          ))}
          <input
            className="search-input"
            placeholder={t('search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      <main className="content">
        {questions.length === 0 ? (
          <EmptyState
            hint={isExt ? t('empty_hint_ext') : t('empty_hint_dev')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState hint={t('empty_hint_filter')} />
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
