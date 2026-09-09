import React, { useEffect, useMemo, useState } from 'react';
import QuestionCard from './components/QuestionCard.jsx';
import EmptyState from './components/EmptyState.jsx';
import { t, loadStoredLanguage, onLanguageChange, getLanguage } from './i18n.js';

const SERVER = 'http://127.0.0.1:8765';
const KEY_STORAGE = 'kudavas_license_key';   // persisted license key (8 chars A-Z 0-9)
const OPENAI_STORAGE = 'kudavas_openai_key'; // persisted OpenAI key (encrypted by browser)

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
  const [licenseKey, setLicenseKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [keyStatus, setKeyStatus] = useState({ state: 'idle' }); // idle | checking | valid | invalid | error
  const [authStatus, setAuthStatus] = useState({ state: 'idle', msg: '' }); // idle | checking | ok | fail | key_in_use
  const [, forceRerender] = useState(0);

  // Initial load: storage license + openai key + check session
  useEffect(() => {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('kudavas_settings');
        if (stored?.kudavas_settings?.licenseKey) {
          setLicenseKey(stored.kudavas_settings.licenseKey);
        }
        if (stored?.kudavas_settings?.openaiKey) {
          setOpenaiKey(stored.kudavas_settings.openaiKey);
        }
      } catch (_) {}
      try {
        const saved = localStorage.getItem(KEY_STORAGE);
        if (saved && !licenseKey) setLicenseKey(saved);
        const savedOpenai = localStorage.getItem(OPENAI_STORAGE);
        if (savedOpenai && !openaiKey) setOpenaiKey(savedOpenai);
      } catch (_) {}
      // Check existing session
      try {
        const sess = await chrome.storage.session.get('kudavas_session');
        if (sess?.kudavas_session?.token) {
          setAuthStatus({ state: 'ok', msg: '✓ Logged in' });
        }
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
        if (msg.settings?.licenseKey) setLicenseKey(msg.settings.licenseKey);
        if (msg.settings?.language) {
          forceRerender(n => n + 1);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Auto-verify license key mỗi khi user thay đổi (debounce 400ms)
  useEffect(() => {
    const trimmed = licenseKey.trim().toUpperCase();
    if (!trimmed) {
      setKeyStatus({ state: 'idle' });
      return;
    }
    if (!/^[A-Z0-9]{1,8}$/.test(trimmed)) {
      setKeyStatus({ state: 'invalid', reason: 'format' });
      return;
    }
    setKeyStatus({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(SERVER + '/verify-license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: trimmed }),
        });
        if (!resp.ok) {
          setKeyStatus({ state: 'error', reason: `HTTP ${resp.status}` });
          return;
        }
        const data = await resp.json();
        if (data.valid) {
          setKeyStatus({ state: 'valid', reason: data.reason, total: data.total_keys });
        } else {
          setKeyStatus({ state: 'invalid', reason: data.reason, total: data.total_keys });
        }
      } catch (err) {
        setKeyStatus({ state: 'error', reason: err.message });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [licenseKey]);

  function persistKey(v) {
    // Sanitize: chỉ giữ A-Z 0-9, uppercase, max 8 chars
    const sanitized = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setLicenseKey(sanitized);
    try { localStorage.setItem(KEY_STORAGE, sanitized); } catch (_) {}
  }

  function persistOpenai(v) {
    setOpenaiKey(v);
    try { localStorage.setItem(OPENAI_STORAGE, v); } catch (_) {}
  }

  // ─── Auth / Login (call /auth/login to get session token) ───
  async function getMachineId() {
    try {
      const extId = chrome.runtime.id || 'unknown';
      const installed = await chrome.management.getSelf().catch(() => ({}));
      const info = [extId, installed.installType || '', installed.version || ''].join('|');
      return btoa(info).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    } catch (_) {
      return 'unknown';
    }
  }

  async function doAuth() {
    const trimmedKey = licenseKey.trim().toUpperCase();
    const trimmedOpenai = openaiKey.trim();
    if (!trimmedKey || !trimmedOpenai) {
      setAuthStatus({ state: 'fail', msg: 'Missing fields' });
      return;
    }
    if (keyStatus.state !== 'valid' && !trimmedKey.match(/^[A-Z0-9]{8}$/)) {
      setAuthStatus({ state: 'fail', msg: 'Invalid format' });
      return;
    }

    setAuthStatus({ state: 'checking', msg: 'Logging in…' });
    const machineId = await getMachineId();
    try {
      const resp = await fetch(SERVER + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_key: trimmedKey,
          openai_api_key: trimmedOpenai,
          machine_id: machineId,
        }),
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 409) {
        const info = data.detail || {};
        setAuthStatus({
          state: 'key_in_use',
          msg: t('status_key_in_use', (info.active_machine || '').slice(0, 12)),
        });
        return;
      }

      if (!resp.ok) {
        setAuthStatus({ state: 'fail', msg: data.detail || data.error || 'Auth failed' });
        return;
      }

      // Save session (in-memory only — wiped on server restart)
      await chrome.storage.session.set({
        kudavas_session: {
          token: data.token,
          licenseKey: trimmedKey,
          serverUrl: SERVER,
          loggedInAt: new Date().toISOString(),
        },
      });
      // Also persist settings for next popup open
      await chrome.storage.local.set({
        kudavas_settings: {
          licenseKey: trimmedKey,
          openaiKey: trimmedOpenai,
          serverUrl: SERVER,
        },
      });

      setAuthStatus({ state: 'ok', msg: '✓ Logged in' });
      setStatus({ state: 'idle', msg: t('status_logged_in'), detail: '' });
    } catch (err) {
      setAuthStatus({ state: 'fail', msg: err.message });
    }
  }

  async function doLogout() {
    try {
      const sess = await chrome.storage.session.get('kudavas_session');
      const token = sess?.kudavas_session?.token;
      if (token) {
        await fetch(SERVER + '/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-token': token },
        }).catch(() => {});
      }
      await chrome.storage.session.remove('kudavas_session');
      setAuthStatus({ state: 'idle', msg: '' });
    } catch (_) {}
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

    // Require active session (logged in)
    let session;
    try {
      const sess = await chrome.storage.session.get('kudavas_session');
      session = sess?.kudavas_session;
    } catch (_) {}
    if (!session?.token) {
      setStatus({
        state: 'error',
        msg: t('status_not_logged_in'),
        detail: t('status_not_logged_in_detail'),
      });
      setAuthStatus({ state: 'fail', msg: t('btn_need_login') });
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
        session,
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
      // Detect token expired (401) → suggest re-login
      const isAuthErr = /401|Token|UNLOGGED/i.test(err.message);
      if (isAuthErr) {
        try { await chrome.storage.session.remove('kudavas_session'); } catch (_) {}
        setAuthStatus({ state: 'idle', msg: '' });
      }
      setStatus({
        state: 'error',
        msg: t('status_error_prefix') + err.message,
        detail: isAuthErr ? t('status_token_expired_detail') : '',
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
              title={keyStatus.state === 'valid' ? t('btn_scrape_title') : t('btn_scrape_title_no_key')}
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

      {/* ─── Auth (license key + openai key → session token) ─── */}
      <div className="key-bar">
        <label className="key-label" htmlFor="license-key">
          {t('key_label')}
        </label>
        <div className="key-input-wrap">
          <input
            id="license-key"
            className={`key-input ${keyStatus.state === 'valid' ? 'is-valid' : keyStatus.state === 'invalid' ? 'is-invalid' : ''}`}
            type={showKey ? 'text' : 'password'}
            placeholder={t('key_placeholder')}
            value={licenseKey}
            onChange={e => persistKey(e.target.value)}
            maxLength={8}
            spellCheck={false}
            autoComplete="off"
            style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 600 }}
          />
          {keyStatus.state === 'checking' && (
            <span className="key-status-spinner" title={t('key_checking')}>⏳</span>
          )}
          {keyStatus.state === 'valid' && (
            <span className="key-status-ok" title={t('key_valid_title')}>✓</span>
          )}
          {keyStatus.state === 'invalid' && (
            <span className="key-status-err" title={t('key_invalid_title')}>✗</span>
          )}
          {keyStatus.state === 'error' && (
            <span className="key-status-warn" title={keyStatus.reason || ''}>!</span>
          )}
          <button
            className="key-toggle"
            onClick={() => setShowKey(s => !s)}
            type="button"
            title={showKey ? t('key_hide') : t('key_show')}
          >
            {showKey ? '🙈' : '👁'}
          </button>
          {licenseKey && (
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
          {authStatus.state === 'ok' ? (
            <button
              className="key-check-btn logged-in"
              onClick={doLogout}
              type="button"
              title={t('btn_logout_title')}
            >
              {t('btn_logged_in')}
            </button>
          ) : (
            <button
              className="key-check-btn"
              onClick={doAuth}
              disabled={authStatus.state === 'checking'}
              type="button"
              title={t('btn_check_title')}
            >
              {authStatus.state === 'checking' ? t('btn_checking') : t('btn_check')}
            </button>
          )}
        </div>

        {/* ─── OpenAI Key row ─── */}
        <label className="key-label" htmlFor="openai-key" style={{ gridArea: 'label2', fontSize: 11 }}>
          <span style={{ fontSize: 11 }}>🔑 OpenAI</span>
        </label>
        <div className="key-input-wrap" style={{ gridArea: 'input2' }}>
          <input
            id="openai-key"
            className="key-input"
            type={showOpenai ? 'text' : 'password'}
            placeholder="sk-..."
            value={openaiKey}
            onChange={e => persistOpenai(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
          <button
            className="key-toggle"
            onClick={() => setShowOpenai(s => !s)}
            type="button"
            title={showOpenai ? t('key_hide') : t('key_show')}
          >
            {showOpenai ? '🙈' : '👁'}
          </button>
          {openaiKey && (
            <button
              className="key-clear"
              onClick={() => persistOpenai('')}
              type="button"
              title={t('key_clear')}
            >
              ✕
            </button>
          )}
        </div>
        <div className="key-actions" style={{ gridArea: 'actions2' }}>
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

        {authStatus.msg && authStatus.state !== 'ok' && (
          <div className={`key-hint ${authStatus.state === 'key_in_use' ? 'key-warn' : 'key-err'}`}>
            {authStatus.msg}
          </div>
        )}
        {authStatus.state === 'ok' && (
          <div className="key-hint key-ok">
            ✓ Session active
          </div>
        )}
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

      <footer className="app-footer">
        <span>{t('copyright')}</span>
        <span className="app-footer-sep">·</span>
        <span>v2.0</span>
      </footer>
    </div>
  );
}
