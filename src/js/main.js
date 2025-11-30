/**
 * SHAD - Simple Home Assistant Dashboard
 * Main Entry Point
 * 
 * Initializes the dashboard application
 */

import { configManager } from './ConfigManager.js';
import { formatTime24h, formatDateDMY } from './utils/helpers.js';

/**
 * Update the clock widget
 */
function updateClock() {
  const now = new Date();
  const clockElement = document.querySelector('.clock');
  const dateElement = document.querySelector('.date');

  if (clockElement) {
    clockElement.textContent = formatTime24h(now);
  }
  if (dateElement) {
    dateElement.textContent = formatDateDMY(now);
  }
}

/**
 * Load configuration by ID
 * @param {string} configId - Configuration ID (0-9)
 */
function loadConfig(configId) {
  const urlParams = new URLSearchParams(window.location.search);
  const dashboardMode = urlParams.get('dashboard') ?? '1';
  window.location.href = `index.html?config=${configId}&dashboard=${dashboardMode}`;
}

/**
 * Initialize the application
 */
async function initApp() {
  try {
    // Initialize configuration manager and all services
    await configManager.init();

    // Start clock updates
    updateClock();
    setInterval(updateClock, 1000);

    console.log('SHAD Dashboard initialized successfully');
  } catch (error) {
    console.error('Error initializing dashboard:', error);
  }
}

// Expose functions to global scope for HTML onclick handlers
window.loadConfig = loadConfig;
window.configManager = configManager;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
