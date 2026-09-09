// popup.js - All-in-one AI Automator

const runBtn = document.getElementById('run-ai-btn');
const authBtn = document.getElementById('auth-btn');
const btnText = document.getElementById('btn-text');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const connPill = document.getElementById('conn-status');
const authStatus = document.getElementById('auth-status');
const authHint = document.getElementById('auth-hint');

const serverUrlInput = document.getElementById('server-url');
const licenseKeyInput = document.getElementById('license-key');
const openaiKeyInput = document.getElementById('openai-key');

function setAuthStatus(state, msg) {
  if (!authStatus) return;
  authStatus.style.display = 'inline-block';
  if (state === 'ok') {
    authStatus.className = 'conn-pill ok';
    authStatus.textContent = '✓ Logged in';
  } else if (state === 'fail') {
    authStatus.className = 'conn-pill fail';
    authStatus.textContent = '✗ ' + msg;
  } else if (state === 'checking') {
    authStatus.className = 'conn-pill checking';
    authStatus.textContent = '...';
  } else {
    authStatus.style.display = 'none';
  }
  if (authHint) {
    if (state === 'key_in_use') {
      authHint.style.display = 'block';
      authHint.textContent = msg;
      authHint.style.color = '#ef4444';
    } else {
      authHint.style.display = 'none';
    }
  }
}

function updateUI(state, msg, detail = "") {
  statusText.textContent = msg;
  statusDetail.textContent = detail;

  if (state === 'idle') {
    appBody.className = '';
    runBtn.disabled = false;
    btnText.textContent = "Ask AI to Solve";
  } else if (state === 'running') {
    appBody.className = 'running';
    runBtn.disabled = true;
    btnText.textContent = "Processing...";
  } else if (state === 'done') {
    appBody.className = 'done';
    runBtn.disabled = true;
    btnText.textContent = "Done!";
    setTimeout(() => updateUI('idle', 'Ready to solve', 'Server is online'), 3000);
  } else if (state === 'error') {
    appBody.className = '';
    runBtn.disabled = false;
    btnText.textContent = "Try Again";
    statusText.style.color = '#ef4444';
    setTimeout(() => { statusText.style.color = ''; }, 3000);
  }
}

// ── SESSION STORAGE (chrome.storage.session — cleared on Ctrl+C) ──
async function getSession() {
  return new Promise(res => chrome.storage.session.get('kudavas_session', s => res(s?.kudavas_session || null)));
}
async function saveSession(session) {
  if (session) {
    return new Promise(res => chrome.storage.session.set({ kudavas_session: session }, res));
  } else {
    return new Promise(res => chrome.storage.session.remove('kudavas_session', res));
  }
}

// ── SETTINGS STORAGE (chrome.storage.local — persists) ──
async function loadSettings() {
  return new Promise(res =>
    chrome.storage.local.get('kudavas_settings', (s) => res(s?.kudavas_settings || {}))
  );
}
async function saveSettings(patch) {
  const current = await loadSettings();
  const merged = { ...current, ...patch };
  return new Promise((res) => {
    chrome.storage.local.set({ kudavas_settings: merged }, res);
  });
}

// ── MACHINE ID ────────────────────────────────────────────────────────────────
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

// ── AUTH / LOGIN ──────────────────────────────────────────────────────────────
async function doAuth() {
  const url = (serverUrlInput?.value || '').trim().replace(/\/+$/, '');
  const licenseKey = (licenseKeyInput?.value || '').trim().toUpperCase();
  const openaiKey = (openaiKeyInput?.value || '').trim();
  const machineId = await getMachineId();

  if (!url || !licenseKey || !openaiKey) {
    setAuthStatus('fail', 'Missing fields');
    return;
  }

  setAuthStatus('checking', 'Logging in…');

  try {
    const resp = await fetch(url + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, openai_api_key: openaiKey, machine_id: machineId }),
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.status === 409) {
      const info = data.detail || {};
      const activeMachine = info.active_machine || 'unknown';
      const activeSince = info.active_since || '';
      setAuthStatus('key_in_use',
        `Key đang dùng trên máy khác (${(activeMachine || '').slice(0, 12)}...) từ ${activeSince}`);
      setConnPill('fail', 'Key in use');
      await saveSession(null);
      return;
    }

    if (!resp.ok) {
      setAuthStatus('fail', data.detail || data.error || 'Auth failed');
      setConnPill('fail', 'Bad key');
      return;
    }

    // Success — save token + server URL
    await saveSession({
      token: data.token,
      licenseKey,
      serverUrl: url,
      loggedInAt: new Date().toISOString(),
    });

    setAuthStatus('ok');
    setConnPill('ok', 'Online ✓');
    await saveSettings({ serverUrl: url, licenseKey, openaiKey });
    runBtn.disabled = false;

  } catch (e) {
    setAuthStatus('fail', e.message);
    setConnPill('fail', 'Offline');
  }
}

async function doLogout() {
  const session = await getSession();
  if (!session?.token) return;

  try {
    await fetch(session.serverUrl + '/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-token': session.token,
      },
    }).catch(() => {});
  } catch (_) {}

  await saveSession(null);
  setAuthStatus('', '');
  setConnPill('ok', 'Online');
}

// ── CONNECTION CHECK ──────────────────────────────────────────────────────────
function setConnPill(state, label) {
  if (!connPill) return;
  connPill.className = 'conn-pill ' + state;
  connPill.textContent = label;
}

async function checkConnection() {
  const url = (serverUrlInput?.value || '').trim().replace(/\/+$/, '');
  if (!url) {
    setConnPill('fail', 'No URL');
    return false;
  }
  setConnPill('checking', 'ping…');
  try {
    const r = await fetch(url + '/health', { method: 'GET' });
    if (!r.ok) {
      setConnPill('fail', 'Down');
      return false;
    }
    setConnPill('ok', 'Online');
    const session = await getSession();
    if (session?.token) {
      setAuthStatus('ok');
    } else {
      setAuthStatus('', '');
    }
    return true;
  } catch (e) {
    setConnPill('fail', 'Offline');
    return false;
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
(async function init() {
  const s = await loadSettings();
  const session = await getSession();

  if (serverUrlInput) serverUrlInput.value = s.serverUrl || 'http://127.0.0.1:8765';
  if (licenseKeyInput) licenseKeyInput.value = (s.licenseKey || '').toUpperCase();
  if (openaiKeyInput) openaiKeyInput.value = s.openaiKey || '';

  if (session?.token) {
    setAuthStatus('ok');
    runBtn.disabled = false;
  } else {
    runBtn.disabled = true;
    btnText.textContent = 'Check để đăng nhập';
  }

  const inputs = [serverUrlInput, licenseKeyInput, openaiKeyInput].filter(Boolean);
  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      clearTimeout(inp._t);
      inp._t = setTimeout(async () => {
        await saveSettings({
          serverUrl: serverUrlInput?.value?.trim() || '',
          licenseKey: licenseKeyInput?.value?.toUpperCase() || '',
          openaiKey: openaiKeyInput?.value?.trim() || '',
        });
        checkConnection();
      }, 500);
    });
  });

  setTimeout(() => checkConnection(), 200);
})();

// ── AUTH BUTTON ───────────────────────────────────────────────────────────────
if (authBtn) {
  authBtn.addEventListener('click', async () => {
    const session = await getSession();
    if (session?.token) {
      await doLogout();
    } else {
      await doAuth();
    }
  });
}

// ── SERVER PRESETS ────────────────────────────────────────────────────────────
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const url = btn.getAttribute('data-url');
    if (serverUrlInput) serverUrlInput.value = url;
    await saveSettings({ serverUrl: url });
    setTimeout(() => checkConnection(), 100);
  });
});

// ── MAIN ACTION ──────────────────────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");

    const serverUrl = (serverUrlInput?.value || '').trim();
    if (!serverUrl) throw new Error('Nhập Server URL trước');

    const session = await getSession();
    if (!session?.token) throw new Error('Chưa đăng nhập — bấm Check trước');

    updateUI('running', 'Processing...', 'Scrape → AI solve → Fill');

    const response = await chrome.runtime.sendMessage({
      action: 'solve-and-fill',
      tabId: tab.id,
      session,
    });

    if (response && response.error) {
      throw new Error(response.error);
    }

    const filled = response?.filled ?? 0;
    const total = response?.count ?? 0;
    updateUI('done', `Đã fill ${filled}/${total}`, 'You can close this now');
  } catch (err) {
    updateUI('error', 'Lỗi: ' + err.message, '');
  }
});

/** Helper to send message to content script */
function sendMsg(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}
