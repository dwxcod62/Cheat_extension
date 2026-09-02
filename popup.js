// popup.js - All-in-one AI Automator

const runBtn = document.getElementById('run-ai-btn');
const btnText = document.getElementById('btn-text');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const appBody = document.getElementById('app-body');

const SERVER_URL = CONFIG.PROCESS_ENDPOINT;

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

// Load saved key + shortcut from chrome.storage.local
async function loadSettings() {
  return new Promise((res) => chrome.storage.local.get('kudavas_settings', (s) => res(s?.kudavas_settings || {})));
}

const keyInput = document.getElementById('openai-key');
loadSettings().then(s => {
  if (keyInput && s.openaiKey) keyInput.value = s.openaiKey;
});

if (keyInput) {
  keyInput.addEventListener('input', () => {
    try { localStorage.setItem('kudavas_openai_key', keyInput.value); } catch (_) {}
    // Also persist to chrome.storage.local so settings page stays in sync
    loadSettings().then(s => {
      chrome.storage.local.set({ kudavas_settings: { ...s, openaiKey: keyInput.value } });
    });
  });
}

runBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");

    const openaiKey = keyInput ? keyInput.value.trim() : '';
    if (!openaiKey) throw new Error('Dán OpenAI key vào ô phía trên trước');

    updateUI('running', 'Processing...', 'Scrape → AI solve → Fill (atomic)');

    // Atomic: scrape + AI + fill in one click
    const response = await chrome.runtime.sendMessage({
      action: 'solve-and-fill',
      tabId: tab.id,
      openaiKey,
    });

    if (response && response.error) {
      throw new Error(response.error);
    }

    const filled = response?.filled ?? 0;
    const total = response?.count ?? 0;
    updateUI('done', `Đã fill ${filled}/${total}`, 'You can close this now');

  } catch (err) {
    console.error("[KudaVas] Global Error:", err);
    updateUI('error', 'Error occurred', err.message);
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
