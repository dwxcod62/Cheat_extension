// settings.js — manage OpenAI key + keyboard shortcut + UI language (opened as standalone page)

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  openaiKey: '',
  serverUrl: 'http://127.0.0.1:8765',
  shortcut: 'Ctrl+Alt+I',
  shortcutEnabled: true,
  language: 'vi',
  notifyOnDone: true,
};

// ── i18n strings (UI only — prompts/AI untouched) ──────────
const I18N = {
  vi: {
    title: '⚙ Settings',
    subtitle: 'Cấu hình KudaVas extension',
    section_openai: 'OpenAI',
    api_key: 'API Key (sk-...)',
    api_key_hint: 'Lưu local qua chrome.storage.local.',
    server_url: 'Server URL',
    server_url_hint: 'Whisper backend.',
    section_shortcut: 'Keyboard Shortcut',
    shortcut_label: 'Phím tắt để chạy AI (mặc định Ctrl+Alt+I)',
    shortcut_hint: 'Bấm vào ô để ghi phím mới (Esc để cancel).',
    reset_shortcut: 'Reset',
    enable_shortcut: 'Bật phím tắt',
    enable_shortcut_desc: 'Khi tắt, dùng nút bấm trong popup.',
    section_language: 'Language',
    language_desc: 'Áp dụng cho giao diện này và popup. Không ảnh hưởng prompt/AI.',
    section_notifications: 'Notifications',
    notify_done_label: 'Hiện thông báo khi xong',
    notify_done_desc: 'Bật/tắt popup hệ thống sau khi Cast Spell fill xong câu trả lời.',
    save: 'Lưu',
    cancel: 'Huỷ',
    status_saved: 'Đã lưu!',
    status_reserved: (sc) => `"${sc}" là phím của trình duyệt. Chọn phím khác.`,
    status_url_empty: 'Server URL không được trống',
    recording_hint: 'Bấm phím bất kỳ…',
    lang_en: 'English',
    lang_vi: 'Tiếng Việt',
    lang_th: 'ไทย',
  },
  en: {
    title: '⚙ Settings',
    subtitle: 'Configure KudaVas extension',
    section_openai: 'OpenAI',
    api_key: 'API Key (sk-...)',
    api_key_hint: 'Stored locally via chrome.storage.local.',
    server_url: 'Server URL',
    server_url_hint: 'Whisper backend.',
    section_shortcut: 'Keyboard Shortcut',
    shortcut_label: 'Hotkey to trigger AI (default Ctrl+Alt+I)',
    shortcut_hint: 'Click the box to record a new key (Esc to cancel).',
    reset_shortcut: 'Reset',
    enable_shortcut: 'Enable hotkey',
    enable_shortcut_desc: 'When off, use the button in the popup.',
    section_language: 'Language',
    language_desc: 'Affects this page and the popup only. Does NOT change prompts or AI behaviour.',
    section_notifications: 'Notifications',
    notify_done_label: 'Show notification when done',
    notify_done_desc: 'Toggle the OS-level popup after Cast Spell finishes filling answers.',
    save: 'Save',
    cancel: 'Cancel',
    status_saved: 'Saved!',
    status_reserved: (sc) => `"${sc}" is reserved by the browser. Pick another.`,
    status_url_empty: 'Server URL cannot be empty',
    recording_hint: 'Press any key…',
    lang_en: 'English',
    lang_vi: 'Tiếng Việt',
    lang_th: 'ไทย',
  },
  th: {
    title: '⚙ ตั้งค่า',
    subtitle: 'ตั้งค่า KudaVas extension',
    section_openai: 'OpenAI',
    api_key: 'API Key (sk-...)',
    api_key_hint: 'จัดเก็บใน chrome.storage.local',
    server_url: 'Server URL',
    server_url_hint: 'Whisper backend',
    section_shortcut: 'คีย์ลัด',
    shortcut_label: 'คีย์ลัดเรียก AI (ค่าเริ่มต้น Ctrl+Alt+I)',
    shortcut_hint: 'คลิกช่องเพื่อบันทึกคีย์ใหม่ (Esc เพื่อยกเลิก)',
    reset_shortcut: 'รีเซ็ต',
    enable_shortcut: 'เปิดใช้คีย์ลัด',
    enable_shortcut_desc: 'ปิดแล้วใช้ปุ่มใน popup แทน',
    section_language: 'ภาษา',
    language_desc: 'ใช้กับหน้านี้และ popup เท่านั้น ไม่กระทบ prompt/AI',
    section_notifications: 'การแจ้งเตือน',
    notify_done_label: 'แสดงแจ้งเตือนเมื่อเสร็จ',
    notify_done_desc: 'เปิด/ปิด popup ของระบบหลัง Cast Spell เติมคำตอบเสร็จ',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    status_saved: 'บันทึกแล้ว!',
    status_reserved: (sc) => `"${sc}" เป็นคีย์ของเบราว์เซอร์ เลือกคีย์อื่น`,
    status_url_empty: 'Server URL ต้องไม่ว่าง',
    recording_hint: 'กดคีย์ใดก็ได้…',
    lang_en: 'English',
    lang_vi: 'Tiếng Việt',
    lang_th: 'ไทย',
  },
};

let currentLang = 'vi';
function t(key) {
  const dict = I18N[currentLang] || I18N.vi;
  const val = dict[key];
  if (val === undefined) return I18N.vi[key] || key;
  return typeof val === 'function' ? val : val;
}

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
  currentLang = state.language || 'vi';
  $('api-key').value = state.openaiKey;
  $('server-url').value = state.serverUrl;
  $('language-select').value = currentLang;
  applyTranslations();
  renderShortcut();
  renderSwitch();
  renderNotify();
}

function applyTranslations() {
  $('title-text').innerHTML = t('title');
  $('subtitle-text').textContent = t('subtitle');
  $('section-openai').textContent = t('section_openai');
  $('api-key-label').textContent = t('api_key');
  $('api-key-hint').textContent = t('api_key_hint');
  $('server-url-label').textContent = t('server_url');
  $('server-url-hint').textContent = t('server_url_hint');
  $('section-shortcut').textContent = t('section_shortcut');
  $('shortcut-label-text').innerHTML = t('shortcut_label');
  $('shortcut-hint').textContent = t('shortcut_hint');
  $('reset-shortcut-btn').textContent = t('reset_shortcut');
  $('enable-shortcut-label').textContent = t('enable_shortcut');
  $('enable-shortcut-desc').textContent = t('enable_shortcut_desc');
  $('section-language').textContent = t('section_language');
  $('language-desc').textContent = t('language_desc');
  $('section-notifications').textContent = t('section_notifications');
  $('notify-done-label').textContent = t('notify_done_label');
  $('notify-done-desc').textContent = t('notify_done_desc');
  $('save-btn').textContent = t('save');
  $('cancel-btn').textContent = t('cancel');
  // language options
  $('lang-en-option').textContent = t('lang_en');
  $('lang-vi-option').textContent = t('lang_vi');
  $('lang-th-option').textContent = t('lang_th');
}

function renderShortcut() {
  $('shortcut-label').innerHTML = formatShortcut(state.shortcut);
}

function renderSwitch() {
  const sw = $('shortcut-enabled');
  sw.classList.toggle('on', state.shortcutEnabled);
}

function renderNotify() {
  const sw = $('notify-done');
  sw.classList.toggle('on', state.notifyOnDone);
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
  $('shortcut-label').textContent = t('recording_hint');
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
    showStatus(t('status_reserved')(sc), false);
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

// ── Notify switch ────────────────────────────────────────
$('notify-done').addEventListener('click', () => {
  state.notifyOnDone = !state.notifyOnDone;
  renderNotify();
});

// ── Reset shortcut ─────────────────────────────────────────
$('reset-shortcut-btn').addEventListener('click', () => {
  state.shortcut = DEFAULTS.shortcut;
  renderShortcut();
});

// ── Language preview (live update, no save) ──────────────
$('language-select').addEventListener('change', (e) => {
  currentLang = e.target.value;
  applyTranslations();
  renderShortcut();
  renderSwitch();
  renderNotify();
});

// ── Save ───────────────────────────────────────────────────
$('save-btn').addEventListener('click', async () => {
  const key = $('api-key').value.trim();
  const url = $('server-url').value.trim();
  const lang = $('language-select').value;
  if (!url) {
    showStatus(t('status_url_empty'), false);
    return;
  }

  state.openaiKey = key;
  state.serverUrl = url.replace(/\/+$/, '');
  state.language = lang;
  state.notifyOnDone = state.notifyOnDone !== false;  // default true
  currentLang = lang;

  await chrome.storage.local.set({ kudavas_settings: state });
  showStatus(t('status_saved'));

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
