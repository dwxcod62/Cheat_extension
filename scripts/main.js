import { loadUserData } from './user_data.js';
import { initFloatingLabels } from './floating_labels.js';
import { initAiFeatures } from './ai_features.js';
import { initUiManager } from './ui_manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  const userData = await loadUserData();
  initFloatingLabels(userData);
  initAiFeatures();
  initUiManager();
});
