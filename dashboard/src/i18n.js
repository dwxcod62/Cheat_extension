// i18n.js — UI translations for dashboard popup.
// Read from chrome.storage.local.kudavas_settings.language, default 'vi'.
// UI-only — never touches prompts/AI/Whisper.

const I18N = {
  vi: {
    brand_name: 'KudaVas Dashboard',
    brand_tag: '🪄 Cast Spell — cào + giải trong 1 bấm',
    btn_scrape: '🪄 Cast Spell',
    btn_scraping: '⏳ Đang xử lý…',
    btn_scrape_title: '🪄 Cast Spell',
    btn_scrape_title_no_key: 'Cần OpenAI key trước',
    btn_clear_title: 'Xoá danh sách câu hỏi',
    btn_open_settings: '⚙ Settings',
    btn_open_settings_title: 'Mở trang Settings (tab mới)',
    key_label: '🔑 OpenAI Key',
    key_placeholder: 'sk-...',
    key_show: 'Hiện key',
    key_hide: 'Ẩn key',
    key_clear: 'Xoá key',
    key_change: '🔑 Đổi key',
    key_change_title_with: 'Xoá key hiện tại để nhập key mới',
    key_change_title_without: 'Nhập OpenAI key',
    status_idle: 'Sẵn sàng',
    status_cleared: 'Đã xoá',
    status_key_cleared: 'Đã xoá key',
    status_key_cleared_detail: 'Nhập key mới rồi bấm "🪄 Cast Spell"',
    status_no_key: 'Chưa có OpenAI key',
    status_no_key_detail: 'Dán sk-... vào ô phía trên rồi bấm lại.',
    status_running: 'Đang cào + giải + fill…',
    status_error_prefix: 'Lỗi: ',
    status_loaded: (n) => `Đã tải ${n} câu hỏi`,
    status_loaded_detail: 'Từ tab đang hoạt động',
    status_updated: (n) => `Đã cập nhật ${n} câu hỏi`,
    status_done: (f, t) => `Xong ${f}/${t} câu`,
    status_done_detail: (n) => `Đã fill ${n} câu lên trang`,
    stat_visible: (a, b) => `${a} / ${b} hiển thị`,
    stat_audio: (n) => `🔊 ${n} media`,
    search_placeholder: 'Tìm trong câu hỏi…',
    filter_all: 'Tất cả',
    filter_multiple_choice: 'Trắc nghiệm',
    filter_true_false: 'Đúng/Sai',
    filter_checkbox: 'Nhiều đáp án',
    filter_matching: 'Ghép đôi',
    filter_multiple_dropdowns: 'Điền nhiều chỗ',
    filter_text_input: 'Tự luận',
    filter_audio: 'Có audio',
    empty_title: 'Chưa có câu hỏi nào',
    empty_hint_ext: 'Mở một trang HTML có câu hỏi, dán OpenAI key vào ô phía trên, bấm "🪄 Cast Spell" để bắt đầu.',
    empty_hint_dev: 'Đây là dashboard standalone. Build dashboard rồi load dist/dashboard/index.html vào extension popup.',
    empty_hint_filter: 'Không có câu hỏi nào khớp bộ lọc hiện tại.',
    type_multiple_choice: 'Trắc nghiệm',
    type_true_false: 'Đúng/Sai',
    type_checkbox: 'Nhiều đáp án',
    type_matching: 'Ghép đôi',
    type_multiple_dropdowns: 'Điền nhiều chỗ trống',
    type_text_input: 'Tự luận',
    type_short_answer_question: 'Trả lời ngắn',
    type_essay_question: 'Tự luận dài',
    type_fill_in_multiple_blanks_question: 'Điền vào chỗ trống',
    type_numerical_question: 'Số',
    type_non_question: 'Media',
    badge_passage: 'Passage',
    badge_has_media: '🔊 có media',
    badge_ai_answered: '✓ AI trả lời',
    answer_label: 'AI answer:',
  },
  en: {
    brand_name: 'KudaVas Dashboard',
    brand_tag: '🪄 Cast Spell — one click quiz solver',
    btn_scrape: '🪄 Cast Spell',
    btn_scraping: '⏳ Working…',
    btn_scrape_title: '🪄 Cast Spell',
    btn_scrape_title_no_key: 'OpenAI key required first',
    btn_clear_title: 'Clear question list',
    btn_open_settings: '⚙ Settings',
    btn_open_settings_title: 'Open Settings page (new tab)',
    key_label: '🔑 OpenAI Key',
    key_placeholder: 'sk-...',
    key_show: 'Show key',
    key_hide: 'Hide key',
    key_clear: 'Clear key',
    key_change: '🔑 Change key',
    key_change_title_with: 'Clear current key to enter a new one',
    key_change_title_without: 'Enter OpenAI key',
    status_idle: 'Ready',
    status_cleared: 'Cleared',
    status_key_cleared: 'Key cleared',
    status_key_cleared_detail: 'Enter a new key then click "🪄 Cast Spell"',
    status_no_key: 'No OpenAI key yet',
    status_no_key_detail: 'Paste sk-... above and try again.',
    status_running: 'Scraping + solving + filling…',
    status_error_prefix: 'Error: ',
    status_loaded: (n) => `Loaded ${n} question(s)`,
    status_loaded_detail: 'From active tab',
    status_updated: (n) => `Updated ${n} question(s)`,
    status_done: (f, t) => `Done ${f}/${t}`,
    status_done_detail: (n) => `Filled ${n} answer(s) onto page`,
    stat_visible: (a, b) => `${a} / ${b} shown`,
    stat_audio: (n) => `🔊 ${n} media`,
    search_placeholder: 'Search questions…',
    filter_all: 'All',
    filter_multiple_choice: 'Multiple choice',
    filter_true_false: 'True/False',
    filter_checkbox: 'Multi-select',
    filter_matching: 'Matching',
    filter_multiple_dropdowns: 'Fill-in multiple',
    filter_text_input: 'Free text',
    filter_audio: 'Has audio',
    empty_title: 'No questions yet',
    empty_hint_ext: 'Open a page with quiz HTML, paste your OpenAI key above, click "🪄 Cast Spell".',
    empty_hint_dev: 'This is a standalone dashboard. Build the dashboard then load dist/dashboard/index.html into the extension popup.',
    empty_hint_filter: 'No questions match the current filter.',
    type_multiple_choice: 'Multiple choice',
    type_true_false: 'True/False',
    type_checkbox: 'Multi-select',
    type_matching: 'Matching',
    type_multiple_dropdowns: 'Fill-in multiple blanks',
    type_text_input: 'Free text',
    type_short_answer_question: 'Short answer',
    type_essay_question: 'Essay',
    type_fill_in_multiple_blanks_question: 'Fill-in blanks',
    type_numerical_question: 'Numerical',
    type_non_question: 'Media',
    badge_passage: 'Passage',
    badge_has_media: '🔊 has media',
    badge_ai_answered: '✓ AI answered',
    answer_label: 'AI answer:',
  },
  th: {
    brand_name: 'KudaVas Dashboard',
    brand_tag: '🪄 Cast Spell — ขูด + แก้ในคลิกเดียว',
    btn_scrape: '🪄 Cast Spell',
    btn_scraping: '⏳ กำลังทำงาน…',
    btn_scrape_title: '🪄 Cast Spell',
    btn_scrape_title_no_key: 'ต้องใส่ OpenAI key ก่อน',
    btn_clear_title: 'ล้างรายการคำถาม',
    btn_open_settings: '⚙ ตั้งค่า',
    btn_open_settings_title: 'เปิดหน้าตั้งค่า (แท็บใหม่)',
    key_label: '🔑 OpenAI Key',
    key_placeholder: 'sk-...',
    key_show: 'แสดง key',
    key_hide: 'ซ่อน key',
    key_clear: 'ล้าง key',
    key_change: '🔑 เปลี่ยน key',
    key_change_title_with: 'ล้าง key เพื่อใส่ใหม่',
    key_change_title_without: 'ใส่ OpenAI key',
    status_idle: 'พร้อม',
    status_cleared: 'ล้างแล้ว',
    status_key_cleared: 'ล้าง key แล้ว',
    status_key_cleared_detail: 'ใส่ key ใหม่แล้วกด "🪄 Cast Spell"',
    status_no_key: 'ยังไม่มี OpenAI key',
    status_no_key_detail: 'วาง sk-... ด้านบนแล้วลองอีกครั้ง',
    status_running: 'กำลังขูด + แก้ + เติม…',
    status_error_prefix: 'ผิดพลาด: ',
    status_loaded: (n) => `โหลด ${n} คำถาม`,
    status_loaded_detail: 'จากแท็บที่ใช้งาน',
    status_updated: (n) => `อัปเดต ${n} คำถาม`,
    status_done: (f, t) => `เสร็จ ${f}/${t}`,
    status_done_detail: (n) => `เติมคำตอบ ${n} ข้อลงหน้า`,
    stat_visible: (a, b) => `แสดง ${a} / ${b}`,
    stat_audio: (n) => `🔊 ${n} สื่อ`,
    search_placeholder: 'ค้นหาคำถาม…',
    filter_all: 'ทั้งหมด',
    filter_multiple_choice: 'ปรนัย',
    filter_true_false: 'จริง/เท็จ',
    filter_checkbox: 'หลายคำตอบ',
    filter_matching: 'จับคู่',
    filter_multiple_dropdowns: 'เติมหลายช่อง',
    filter_text_input: 'อัตนัย',
    filter_audio: 'มีเสียง',
    empty_title: 'ยังไม่มีคำถาม',
    empty_hint_ext: 'เปิดหน้าที่มีคำถาม HTML วาง OpenAI key ด้านบน แล้วกด "🪄 Cast Spell"',
    empty_hint_dev: 'นี่คือ dashboard แบบ standalone build แล้วโหลด dist/dashboard/index.html เข้า popup ของ extension',
    empty_hint_filter: 'ไม่มีคำถามที่ตรงกับตัวกรอง',
    type_multiple_choice: 'ปรนัย',
    type_true_false: 'จริง/เท็จ',
    type_checkbox: 'หลายคำตอบ',
    type_matching: 'จับคู่',
    type_multiple_dropdowns: 'เติมหลายช่องว่าง',
    type_text_input: 'อัตนัย',
    type_short_answer_question: 'ตอบสั้น',
    type_essay_question: 'เรียงความ',
    type_fill_in_multiple_blanks_question: 'เติมช่องว่าง',
    type_numerical_question: 'ตัวเลข',
    type_non_question: 'สื่อ',
    badge_passage: 'Passage',
    badge_has_media: '🔊 มีสื่อ',
    badge_ai_answered: '✓ AI ตอบแล้ว',
    answer_label: 'AI ตอบ:',
  },
};

let currentLang = 'vi';
const listeners = new Set();

export function setLanguage(lang) {
  if (!I18N[lang]) lang = 'vi';
  currentLang = lang;
  listeners.forEach(fn => { try { fn(lang); } catch (_) {} });
  if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent('kudavas-lang-change', { detail: lang }));
}

export function getLanguage() {
  return currentLang;
}

export function t(key, ...args) {
  const dict = I18N[currentLang] || I18N.vi;
  const v = dict[key];
  if (v === undefined) return I18N.vi[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadStoredLanguage() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get('kudavas_settings');
      const lang = stored?.kudavas_settings?.language;
      if (lang && I18N[lang]) setLanguage(lang);
    }
  } catch (_) {}
  return currentLang;
}
