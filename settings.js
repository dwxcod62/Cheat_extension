// settings.js — manage OpenAI key + keyboard shortcut (opened as standalone page)

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  openaiKey: '',
  serverUrl: 'http://127.0.0.1:8765',
  shortcut: 'Ctrl+Alt+I',
  shortcutEnabled: true,
};

// Reserved browser shortcuts we should never bind
const RESERVED = new Set([
  'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+L', 'Ctrl+H',
  'Ctrl+J', 'Ctrl+P', 'Ctrl+S', 'Ctrl+R', 'Ctrl+F', 'Ctrl+G',
  'F12', 'F5', 'F11', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C',
  'Alt+F4', 'Alt+Tab',
]);

let state = { ...DEFAULTS };
let recording = false;

async function load() {
  const stored = await chrome.storage.local.get('kudavas_settings');
  state = { ...DEFAULTS, ...(stored.kudavas_settings || {}) };
  $('api-key').value = state.openaiKey;
  $('server-url').value = state.serverUrl;
  renderShortcut();
  renderSwitch();
}

function renderShortcut() {
  $('shortcut-label').innerHTML = formatShortcut(state.shortcut);
}

function renderSwitch() {
  const sw = $('shortcut-enabled');
  sw.classList.toggle('on', state.shortcutEnabled);
}

function formatShortcut(s) {
  if (!s) return '(chưa đặt)';
  return s.split('+').map(k => `<kbd>${k}</kbd>`).join(' + ');
}

function showStatus(msg, ok = true) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${ok ? 'ok' : 'err'}`;
  setTimeout(() => { el.className = 'status'; }, 2500);
}

function eventToShortcut(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push(e.metaKey ? 'Cmd' : 'Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith('Arrow')) key = key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;

  parts.push(key);
  return parts.join('+');
}

// ── Shortcut recording ─────────────────────────────────────
$('shortcut-display').addEventListener('click', startRecording);
$('shortcut-display').addEventListener('keydown', onRecordKey);

function startRecording() {
  recording = true;
  const disp = $('shortcut-display');
  disp.classList.add('recording');
  disp.focus();
  $('shortcut-label').textContent = 'Bấm phím bất kỳ…';
}

function stopRecording(saved = true) {
  recording = false;
  const disp = $('shortcut-display');
  disp.classList.remove('recording');
  if (!saved) renderShortcut();
}

function onRecordKey(e) {
  if (!recording) {
    // When not recording, swallow keys to prevent typing into "focused" div
    e.preventDefault();
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') { stopRecording(false); return; }

  const sc = eventToShortcut(e);
  if (!sc) return;

  const parts = sc.split('+');
  if (parts.length < 2) return;

  if (RESERVED.has(sc)) {
    showStatus(`"${sc}" là phím của trình duyệt. Chọn phím khác.`, false);
    return;
  }

  state.shortcut = sc;
  renderShortcut();
  stopRecording();
}

// ── Switch ─────────────────────────────────────────────────
$('shortcut-enabled').addEventListener('click', () => {
  state.shortcutEnabled = !state.shortcutEnabled;
  renderSwitch();
});

// ── Reset shortcut ─────────────────────────────────────────
$('reset-shortcut').addEventListener('click', () => {
  state.shortcut = DEFAULTS.shortcut;
  renderShortcut();
});

// ── Save ───────────────────────────────────────────────────
$('save-btn').addEventListener('click', async () => {
  const key = $('api-key').value.trim();
  const url = $('server-url').value.trim();
  if (!url) {
    showStatus('Server URL không được trống', false);
    return;
  }

  state.openaiKey = key;
  state.serverUrl = url.replace(/\/+$/, '');

  await chrome.storage.local.set({ kudavas_settings: state });
  showStatus('Đã lưu!');

  try {
    chrome.runtime.sendMessage({ action: 'settings-updated', settings: state });
  } catch (_) {}
});

// ── Cancel ─────────────────────────────────────────────────
$('cancel-btn').addEventListener('click', () => {
  window.close();
});

// Initial load
load();
