export function initFloatingLabels(userData) {
  const label = document.querySelector('.brutalist-label:not(.ai-label)'); 
  const container = document.querySelector('.brutalist-container');
  const codeInput = document.querySelector('.brutalist-input');

  if (label && container && codeInput) {
    const defaultText = "What subject today?";
    const normalPhrases = [
      "Want a ten?", "Want full marks?", "Going for 10?", "How many times?",
      "This again?", "Lost count yet?", "Teacher behind you!", "She’s behind you!",
      "Teacher’s right there!", "Act normal, quick!", "Stop talking, now!",
      "You’re dead now!", "Caught in 4K!"
    ];

    const pendingPhrases = ["Not solved yet.", "Still unsolved.", "Haven’t solved it.", "No solution yet."];
    const solvedPhrases = ["Solved already.", "It’s solved now.", "Problem solved.", "All done now.", "Got it solved.", "Finally solved it."];
    const runNormalPhrases = ["Enter code first.", "Code required first.", "Need code input.", "Please enter code.", "Code needed now."];
    const runPendingPhrases = ["Not running yet.", "Can’t run yet.", "Still not running.", "Won’t run yet."];
    const runSolvedPhrases = ["Run it now?", "Wanna run now?", "Run it or what?", "Ready to run?"];

    let floatInterval = null;
    let isHovered = false;
    let isFocused = false;
    let currentMode = 'normal';

    const updateLabel = () => {
      let pool = normalPhrases, runPool = runNormalPhrases;
      if (currentMode === 'pending') { pool = pendingPhrases; runPool = runPendingPhrases; }
      else if (currentMode === 'solved') { pool = solvedPhrases; runPool = runSolvedPhrases; }

      label.textContent = pool[Math.floor(Math.random() * pool.length)];
      const runText = document.getElementById('runActionText');
      if (runText) runText.textContent = runPool[Math.floor(Math.random() * runPool.length)];
    };

    const applyColors = () => {
      const runBtn = document.getElementById('runActionBtn');
      if (currentMode === 'pending') {
        label.style.backgroundColor = '#facc15';
        label.style.color = '#1a1c22';
        if (runBtn) { runBtn.style.setProperty('--accent-color', '#facc15'); runBtn.disabled = true; }
      } else if (currentMode === 'solved') {
        label.style.backgroundColor = '#4ade80';
        label.style.color = '#1a1c22';
        if (runBtn) { runBtn.style.setProperty('--accent-color', '#4ade80'); runBtn.disabled = false; }
      } else {
        label.style.backgroundColor = '';
        label.style.color = '';
        if (runBtn) { runBtn.style.setProperty('--accent-color', '#4b5563'); runBtn.disabled = true; }
      }
    };

    const evaluateInputMode = () => {
      const val = codeInput.value.toUpperCase();
      if (userData && userData.code && val === userData.code.toUpperCase()) {
        const status = (userData.status || '').toLowerCase();
        currentMode = (status === 'pending' || status === 'solved') ? status : 'normal';
      } else {
        currentMode = 'normal';
      }
      applyColors();
      if (currentMode !== 'normal') checkAndStartFloating();
      else (!isHovered && !isFocused) ? checkAndStopFloating() : updateLabel();
    };

    const checkAndStartFloating = () => { if (!floatInterval) { updateLabel(); floatInterval = setInterval(updateLabel, 3000); } };
    const checkAndStopFloating = () => {
      if (currentMode === 'normal' && !isHovered && !isFocused) {
        clearInterval(floatInterval);
        floatInterval = null;
        label.textContent = defaultText;
        const runText = document.getElementById('runActionText');
        if (runText) runText.textContent = runNormalPhrases[0];
      }
    };

    codeInput.addEventListener('input', function() {
      const start = this.selectionStart, end = this.selectionEnd;
      this.value = this.value.toUpperCase();
      this.setSelectionRange(start, end);
      if (currentMode !== 'normal') { currentMode = 'normal'; applyColors(); updateLabel(); }
    });

    const checkBtn = document.querySelector('.check-button');
    if (checkBtn) checkBtn.addEventListener('click', evaluateInputMode);
    container.addEventListener('mouseenter', () => { isHovered = true; checkAndStartFloating(); });
    container.addEventListener('mouseleave', () => { isHovered = false; checkAndStopFloating(); });
    codeInput.addEventListener('focus', () => { isFocused = true; checkAndStartFloating(); });
    codeInput.addEventListener('blur', () => { isFocused = false; checkAndStopFloating(); });
  }

  // Settings API Label Logic
  const settingsLabel = document.getElementById('settingsApiLabel');
  if (settingsLabel) {
    const settingsPhrases = ["Your ‘active’ key is…?", "Active key? Prove it", "Let’s see that key 👀", "No key? No entry", "Got a key, or just guessing?", "Type it… if you have one 😏", "Type fast before it expires 😬", "Don’t mess this up"];
    setInterval(() => { settingsLabel.textContent = settingsPhrases[Math.floor(Math.random() * settingsPhrases.length)]; }, 5000);
  }
}
