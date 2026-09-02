export function initAiFeatures() {
  const aiLabel = document.getElementById('aiLabelText');
  if (aiLabel) {
    const aiPhrases = ["Use AI?", "Run with AI?", "Enable AI?", "AI mode?", "Let AI do it?", "Trust AI with this?", "Give it to AI?", "AI take the wheel?"];
    setInterval(() => { aiLabel.textContent = aiPhrases[Math.floor(Math.random() * aiPhrases.length)]; }, 5000);
  }

  const aiToggle = document.querySelector('.toggle');
  const inputRowContainer = document.getElementById('inputRowContainer');
  const aiGif = document.getElementById('aiAnimationGif');
  const runActionBtn = document.getElementById('runActionBtn');
  const aiRunBtn = document.getElementById('aiRunBtn');

  if (aiToggle && inputRowContainer && aiGif && runActionBtn && aiRunBtn) {
    aiToggle.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      inputRowContainer.style.display = isChecked ? 'none' : 'flex';
      aiGif.style.display = isChecked ? 'block' : 'none';
      runActionBtn.style.display = isChecked ? 'none' : 'block';
      aiRunBtn.style.display = isChecked ? 'block' : 'none';
    });
  }

  const aiAskBtn  = document.getElementById('aiRunBtn');
  const aiAskText = document.getElementById('aiRunText');
  const aiRunResetText = document.getElementById('aiRunResetText');

  if (aiAskBtn && aiAskText) {
    aiAskBtn.addEventListener('click', async () => {
      if (aiAskBtn.hasAttribute('data-running') || aiAskBtn.disabled) return;

      aiAskBtn.setAttribute('data-running', 'true');
      aiAskBtn.style.cursor = 'wait';

      // ── Lấy tab đang active ────────────────────────────────────────────────
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError(aiAskBtn, aiAskText, aiRunResetText, 'No tab found');
        return;
      }

      // ── Phase 1: LOADING (red) ─────────────────────────────────────────────
      // Content script đã được inject tự động bởi manifest khi trang load.
      // Nếu tab chưa refresh sau khi cài extension → báo user refresh.
      aiAskText.textContent = 'Loading ....';
      aiAskBtn.style.setProperty('--accent-color', '#ef4444');

      const extractRes = await sendMsg(tab.id, { action: 'extract' });
      if (!extractRes) {
        // Content script chưa có → yêu cầu user refresh trang
        setError(aiAskBtn, aiAskText, aiRunResetText, 'Refresh page!');
        return;
      }

      const questions = extractRes.questions ?? [];

      // ── Phase 2: FILLING (yellow) ──────────────────────────────────────────
      await delay(1200);
      aiAskText.textContent = 'Filling....';
      aiAskBtn.style.setProperty('--accent-color', '#facc15');

      await sendMsg(tab.id, { action: 'fill', questions });

      // ── Phase 3: DONE (green) ──────────────────────────────────────────────
      await delay(1200);
      aiAskText.textContent = 'Done';
      aiAskBtn.style.setProperty('--accent-color', '#4ade80');
      aiAskBtn.style.cursor = 'not-allowed';
      aiAskBtn.disabled = true;
      if (aiRunResetText) aiRunResetText.style.display = 'block';
    });
  }

  if (aiRunResetText && aiAskBtn && aiAskText) {
    aiRunResetText.addEventListener('click', () => {
      aiAskBtn.removeAttribute('data-running');
      aiAskBtn.disabled = false;
      aiAskText.textContent = 'Ask AI';
      aiAskBtn.style.setProperty('--accent-color', '#a855f7');
      aiAskBtn.style.cursor = 'pointer';
      aiRunResetText.style.display = 'none';
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Gửi message đến content script. Trả về response hoặc null nếu lỗi. */
function sendMsg(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          // Không log error — chỉ resolve null để caller xử lý
          resolve(null);
        } else {
          resolve(response ?? null);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

/** Hiển thị trạng thái lỗi trên nút Ask AI. */
function setError(btn, textEl, resetEl, msg) {
  textEl.textContent = msg;
  btn.style.setProperty('--accent-color', '#ef4444');
  btn.style.cursor = 'not-allowed';
  btn.disabled = true;
  if (resetEl) resetEl.style.display = 'block';
}
