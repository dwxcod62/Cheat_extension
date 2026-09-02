export let userData = null;

export async function loadUserData() {
  try {
    const response = await fetch('user.json');
    userData = await response.json();
    updateUserBranding(userData);
    return userData;
  } catch (error) {
    console.error('Error loading user.json:', error);
  }
}

function updateUserBranding(data) {
  if (data.name) {
    const userNameEl = document.querySelector('.user-name');
    if (userNameEl) userNameEl.textContent = data.name;
  }

  if (data.plan) {
    const badge = document.querySelector('.badge');
    if (badge) {
      const plan = data.plan.trim();
      const planLower = plan.toLowerCase();

      // Reset existing plan classes
      badge.classList.remove('badge-pro', 'badge-standard');

      if (planLower === 'pro') {
        badge.classList.add('badge-pro');
        badge.textContent = 'Pro';
      } else if (planLower === 'standard') {
        badge.classList.add('badge-standard');
        badge.textContent = 'Standard';
      } else {
        badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
      }
    }
  }

  // Active Key Logic
  if (data.activeKey && data.activeKey.toLowerCase() === 'active') {
    const settingsInputRow = document.getElementById('settingsInputRowContainer');
    const successMessageContainer = document.getElementById('activeKeySuccessMessage');
    
    if (settingsInputRow && successMessageContainer) {
      settingsInputRow.style.display = 'none';
      
      const successPhrases = [
        "You unlocked it 🔓",
        "Achievement unlocked: Access",
        "You’re in.",
        "Activated. Nice.",
        "All set.",
        "Access granted.",
        "Welcome aboard."
      ];
      successMessageContainer.textContent = successPhrases[Math.floor(Math.random() * successPhrases.length)];
      successMessageContainer.style.display = 'block';
    }
  }
}
