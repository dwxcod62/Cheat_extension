// scripts/config.js
// Centralized configuration for the KudaVas extension.

const CONFIG = {
  // --- SERVER SETTINGS ---
  // Local Whisper server (chạy whisper_server.py ở port 8765).
  // Có thể dùng ngrok để truy cập từ extension.
  API_BASE_URL: "http://127.0.0.1:8765",

  // --- ENDPOINTS ---
  get PROCESS_ENDPOINT() {
    return `${this.API_BASE_URL}/process`;
  },
  get SOLVE_ENDPOINT() {
    // Server Whisper đã thêm endpoint /solve → transcribe audio + GPT solve.
    // Mặc định: <API_BASE_URL>/solve. Ghi đè nếu deploy riêng.
    return `${this.API_BASE_URL}/solve`;
  },

  // --- OTHER SETTINGS ---
  DEBUG_MODE: true
};

// Note: If you switch to ES Modules (type="module"), you can export this:
// export default CONFIG;

