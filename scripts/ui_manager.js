export function initUiManager() {
  const settingsBtn = document.querySelector('.settings-btn');
  const mainView = document.getElementById('main-view');
  const settingsView = document.getElementById('settings-view');
  const cardHeader = document.querySelector('.card-header');

  if (settingsBtn && mainView && settingsView && cardHeader) {
    let isSettingsOpen = false;
    settingsBtn.addEventListener('click', () => {
      isSettingsOpen = !isSettingsOpen;
      settingsBtn.classList.toggle('active', isSettingsOpen);
      mainView.style.display = isSettingsOpen ? 'none' : 'block';
      settingsView.style.display = isSettingsOpen ? 'block' : 'none';
      cardHeader.textContent = isSettingsOpen ? 'Settings' : 'KudaVas';
    });
  }

  // Run By Key Toggle & Label Logic
  const runByKeyToggle = document.getElementById('runByKeyToggle');
  const runByKeyInputRow = document.getElementById('runByKeyInputRowContainer');
  const delayInputRow = document.getElementById('delayInputRowContainer');

  if (runByKeyToggle && runByKeyInputRow && delayInputRow) {
    runByKeyToggle.addEventListener('change', (e) => {
      const isVisible = e.target.checked ? 'flex' : 'none';
      runByKeyInputRow.style.display = isVisible;
      delayInputRow.style.display = isVisible;
    });
  }

  const runByKeyLabel = document.getElementById('runByKeyLabel');
  const rContainer = document.getElementById('runByKeyInputContainer');
  const rInput = document.getElementById('runByKeyInput');

  if (runByKeyLabel && rContainer && rInput) {
    const rPhrases = ["Don’t be shy, press a key", "Smash a key", "Any key… yes, that includes space", "Go on, press something"];
    let rFloatInterval = null, rIsHovered = false, rIsFocused = false;

    const startRFloating = () => { if (!rFloatInterval) { rFloatInterval = setInterval(() => { runByKeyLabel.textContent = rPhrases[Math.floor(Math.random() * rPhrases.length)]; }, 3000); } };
    const stopRFloating = () => { if (!rIsHovered && !rIsFocused) { clearInterval(rFloatInterval); rFloatInterval = null; runByKeyLabel.textContent = rPhrases[0]; } };

    rContainer.addEventListener('mouseenter', () => { rIsHovered = true; startRFloating(); });
    rContainer.addEventListener('mouseleave', () => { rIsHovered = false; stopRFloating(); });
    rInput.addEventListener('focus', () => { rIsFocused = true; startRFloating(); });
    rInput.addEventListener('blur', () => { rIsFocused = false; stopRFloating(); });

    rInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      let keyName = e.key === ' ' ? 'Space' : e.key;
      if (keyName.length === 1) keyName = keyName.toUpperCase();
      rInput.value = keyName;
      rIsFocused = false; stopRFloating();
      runByKeyLabel.textContent = "Saved";
    });
  }

  // Delay Input Label Logic
  const delayLabel = document.getElementById('delayLabel');
  const dContainer = document.getElementById('delayInputContainer');
  const dInput = document.getElementById('delayInput');

  if (delayLabel && dContainer && dInput) {
    const dPhrases = ["Take your time", "How many ms?", "Patience is key", "1000 = 1 sec...", "Going slow today?"];
    let dFloatInterval = null, dIsHovered = false, dIsFocused = false;

    const startDFloating = () => { if (!dFloatInterval) { dFloatInterval = setInterval(() => { delayLabel.textContent = dPhrases[Math.floor(Math.random() * dPhrases.length)]; }, 3000); } };
    const stopDFloating = () => { if (!dIsHovered && !dIsFocused) { clearInterval(dFloatInterval); dFloatInterval = null; delayLabel.textContent = dPhrases[0]; } };

    dContainer.addEventListener('mouseenter', () => { dIsHovered = true; startDFloating(); });
    dContainer.addEventListener('mouseleave', () => { dIsHovered = false; stopDFloating(); });
    dInput.addEventListener('focus', () => { dIsFocused = true; startDFloating(); });
    dInput.addEventListener('blur', () => { dIsFocused = false; stopDFloating(); });
  }
}
