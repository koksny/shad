/**
 * SHAD - Simple Home Assistant Dashboard
 * Configuration Manager
 * 
 * Central configuration and state management
 */

import { getUrlParams, getColorRgb, deepMerge } from './utils/helpers.js';
import { cameraManager } from './services/CameraManager.js';
import { weatherService } from './services/WeatherService.js';
import { sensorService } from './services/SensorService.js';
import { calendarService } from './services/CalendarService.js';
import { widgetManager } from './widgets/WidgetManager.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  theme: 'dark',
  cameras: [{ url: '', name: 'Camera 1' }],
  widgets: {
    clock: {
      enabled: true,
      position: { x: 20, y: 20 },
      size: { w: 250, h: 150 },
    },
    weather: {
      enabled: true,
      position: { x: 0, y: 20 }, // Will be calculated
      size: { w: 250, h: 150 },
      weatherData: { city: '', lat: null, lon: null },
    },
    temp1: {
      enabled: true,
      position: { x: 20, y: 0 }, // Will be calculated
      size: { w: 250, h: 150 },
    },
    temp2: {
      enabled: true,
      position: { x: 0, y: 0 }, // Will be calculated
      size: { w: 250, h: 150 },
    },
  },
  sensors: {
    temp1: { url: '', refreshInterval: 30, name: 'Sensor 1' },
    temp2: { url: '', refreshInterval: 30, name: 'Sensor 2' },
  },
  appearance: {
    opacity: 0.9,
    blur: 10,
    fontSize: 16,
  },
  cameraGrid: {
    columns: 1,
    rows: 1,
    numCameras: 1,
  },
  calendarFontSize: 5,
};

export class ConfigManager {
  constructor() {
    this.config = this.createDefaultConfig();
    this.dashboardMode = 1;
    this.initialized = false;
  }

  /**
   * Create a fresh default config with calculated positions
   * @returns {Object} Default configuration
   */
  createDefaultConfig() {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    
    // Calculate positions based on window size
    config.widgets.weather.position.x = window.innerWidth - 270;
    config.widgets.temp1.position.y = window.innerHeight - 170;
    config.widgets.temp2.position.x = window.innerWidth - 270;
    config.widgets.temp2.position.y = window.innerHeight - 170;
    
    return config;
  }

  /**
   * Initialize the configuration manager and all services
   */
  async init() {
    if (this.initialized) return;

    // Parse URL parameters
    const urlParams = getUrlParams();
    this.dashboardMode = parseInt(urlParams.get('dashboard') ?? '1');

    // Initialize services with DOM elements
    this.initializeServices();

    // Load configuration
    await this.loadConfig();

    // Load calendar data
    await calendarService.loadEvents();

    // Apply configuration
    this.applyConfig();

    // Set up event listeners
    this.setupEventListeners();

    // Set up window resize handler (debounced)
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => widgetManager.applyAll(), 100);
    });

    // Set up page unload cleanup
    window.addEventListener('beforeunload', () => {
      this.destroy();
    });

    // Set dashboard mode
    this.setDashboardMode(this.dashboardMode);

    // Start calendar checking
    calendarService.startChecking(this.dashboardMode !== 0);

    // Initialize interact.js
    widgetManager.initInteract();

    // Update accent color RGB variable
    this.updateAccentColorRgb();

    this.initialized = true;
    console.log('SHAD ConfigManager initialized');
  }

  /**
   * Initialize all services with DOM elements
   */
  initializeServices() {
    // Camera manager
    const cameraGrid = document.querySelector('.camera-grid');
    if (cameraGrid) {
      cameraManager.init(cameraGrid);
      // HD mode (dashboard=0) uses powerful devices, no staggering needed
      // Kiosk mode (dashboard=1) uses low-power Pi devices, needs staggered loading
      cameraManager.setHDMode(this.dashboardMode === 0);
    }

    // Weather service
    const weatherInfo = document.querySelector('.weather-info');
    const cityInput = document.getElementById('cityInput');
    const citySuggestions = document.querySelector('.city-suggestions');
    if (weatherInfo && cityInput && citySuggestions) {
      weatherService.init({
        weatherInfo,
        cityInput,
        suggestions: citySuggestions,
      });
    }

    // Calendar service
    const calendarBanner = document.querySelector('.calendar-banner');
    if (calendarBanner) {
      calendarService.init(calendarBanner);
    }

    // Register widgets
    ['clock', 'weather', 'temp1', 'temp2'].forEach((widgetId) => {
      widgetManager.registerWidget(widgetId, this.config.widgets[widgetId]);
    });

    // Initialize sensors
    ['temp1', 'temp2'].forEach((sensorId) => {
      sensorService.initSensor(sensorId, this.config.sensors[sensorId]);
    });
  }

  /**
   * Load configuration from file
   */
  async loadConfig() {
    const urlParams = getUrlParams();
    const configId = urlParams.get('config') || '1';
    const configSuffix = this.dashboardMode === 0 ? '_HD' : '';

    try {
      let response = await fetch(`config/shad_default${configId}${configSuffix}.conf`);
      
      // Fall back to regular config if HD config not found
      if (!response.ok && this.dashboardMode === 0) {
        console.log('HD config not found, falling back to regular config');
        response = await fetch(`config/shad_default${configId}.conf`);
      }

      if (response.ok) {
        const loadedConfig = await response.json();
        // Merge with defaults, excluding calendar events (loaded separately)
        delete loadedConfig.calendarEvents;
        this.config = deepMerge(this.config, loadedConfig);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  /**
   * Apply the current configuration to all components
   */
  applyConfig() {
    // Apply theme
    document.body.setAttribute('data-theme', this.config.theme);
    this.updateAccentColorRgb();

    // Update theme selector
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.value = this.config.theme;
    }

    // Apply appearance
    this.applyAppearance();

    // Apply calendar font size
    calendarService.setFontSize(this.config.calendarFontSize);

    // Configure and apply widgets
    Object.entries(this.config.widgets).forEach(([widgetId, widgetConfig]) => {
      widgetManager.updateConfig(widgetId, widgetConfig);
    });
    widgetManager.applyAll();

    // Configure weather
    if (this.config.widgets.weather?.weatherData) {
      weatherService.loadFromConfig(this.config.widgets.weather.weatherData);
    }

    // Configure and start sensors
    ['temp1', 'temp2'].forEach((sensorId) => {
      sensorService.updateConfig(sensorId, this.config.sensors[sensorId]);
      if (widgetManager.isEnabled(sensorId)) {
        sensorService.startPolling(sensorId);
      }
    });

    // Configure cameras
    cameraManager.updateConfig(this.config.cameras, this.config.cameraGrid);
    cameraManager.setupGrid();

    // Update settings panel inputs
    this.updateSettingsPanel();
  }

  /**
   * Apply appearance settings
   */
  applyAppearance() {
    const { opacity, blur, fontSize } = this.config.appearance;
    document.documentElement.style.setProperty('--widget-opacity', opacity);
    document.documentElement.style.setProperty('--blur-amount', `${blur}px`);
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
  }

  /**
   * Update accent color RGB CSS variable
   */
  updateAccentColorRgb() {
    const rgb = getColorRgb('--accent-color');
    if (rgb) {
      document.documentElement.style.setProperty('--accent-color-rgb', rgb);
    }
  }

  /**
   * Update settings panel inputs to match current config
   */
  updateSettingsPanel() {
    // Appearance
    const opacityInput = document.getElementById('widgetOpacity');
    const blurInput = document.getElementById('blurAmount');
    const fontSizeInput = document.getElementById('fontSize');
    const calFontSizeInput = document.getElementById('calendarFontSize');
    const numCamerasInput = document.getElementById('numCameras');

    if (opacityInput) opacityInput.value = this.config.appearance.opacity;
    if (blurInput) blurInput.value = this.config.appearance.blur;
    if (fontSizeInput) fontSizeInput.value = this.config.appearance.fontSize;
    if (calFontSizeInput) calFontSizeInput.value = this.config.calendarFontSize;
    if (numCamerasInput) numCamerasInput.value = this.config.cameraGrid.numCameras;

    // Sensors
    ['temp1', 'temp2'].forEach((sensorId) => {
      const sensor = this.config.sensors[sensorId];
      const urlInput = document.getElementById(`${sensorId}Url`);
      const nameInput = document.getElementById(`${sensorId}Name`);
      const intervalInput = document.getElementById(`${sensorId}Interval`);

      if (urlInput) urlInput.value = sensor?.url || '';
      if (nameInput) nameInput.value = sensor?.name || '';
      if (intervalInput) intervalInput.value = sensor?.refreshInterval || 30;
    });

    // Widget toggles
    document.querySelectorAll('.widget-toggle').forEach((toggle) => {
      const toggleInput = toggle.querySelector('input');
      const widgetName = toggle.querySelector('span')?.textContent?.trim();
      const widgetMap = {
        'Clock Widget': 'clock',
        'Weather Widget': 'weather',
        'Temperature Sensor 1': 'temp1',
        'Temperature Sensor 2': 'temp2',
      };
      const widgetId = widgetMap[widgetName];
      if (widgetId && toggleInput) {
        toggleInput.checked = widgetManager.isEnabled(widgetId);
      }
    });

    // Camera settings
    this.updateCameraSettings();
  }

  /**
   * Update camera settings in panel
   */
  updateCameraSettings() {
    const container = document.getElementById('cameraSettings');
    if (!container) return;

    container.innerHTML = cameraManager.generateSettingsHTML();

    // Attach event listeners
    container.querySelectorAll('.camera-url').forEach((input) => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.config.cameras[index].url = e.target.value;
      });
    });

    container.querySelectorAll('.camera-name').forEach((input) => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.config.cameras[index].name = e.target.value;
      });
    });

    container.querySelectorAll('.camera-apply-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.applyCameraSettings(index);
      });
    });
  }

  /**
   * Apply camera settings for a specific camera
   * @param {number} index - Camera index
   */
  applyCameraSettings(index) {
    cameraManager.updateConfig(this.config.cameras, this.config.cameraGrid);
    cameraManager.applySettings(index);
  }

  /**
   * Apply sensor settings
   * @param {string} sensorId - Sensor identifier
   */
  applySensorSettings(sensorId) {
    const urlInput = document.getElementById(`${sensorId}Url`);
    const nameInput = document.getElementById(`${sensorId}Name`);
    const intervalInput = document.getElementById(`${sensorId}Interval`);

    if (!urlInput || !nameInput || !intervalInput) return;

    const config = {
      url: urlInput.value.trim(),
      name: nameInput.value.trim(),
      refreshInterval: parseInt(intervalInput.value) || 30,
    };

    this.config.sensors[sensorId] = config;
    sensorService.applySettings(sensorId, config);

    // Enable widget
    widgetManager.setVisibility(sensorId, true);
    this.config.widgets[sensorId].enabled = true;
  }

  /**
   * Set up all event listeners
   */
  setupEventListeners() {
    // Settings panel toggle
    const settingsToggle = document.querySelector('.settings-toggle');
    const settingsPanel = document.querySelector('.settings-panel');
    if (settingsToggle && settingsPanel) {
      settingsToggle.addEventListener('click', () => {
        settingsPanel.classList.toggle('active');
      });
    }

    // Theme selector
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        this.config.theme = e.target.value;
        document.body.setAttribute('data-theme', e.target.value);
        this.updateAccentColorRgb();
      });
    }

    // Number of cameras
    const numCamerasInput = document.getElementById('numCameras');
    if (numCamerasInput) {
      numCamerasInput.addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        if (!isNaN(value)) {
          cameraManager.updateGridLayout(value);
          this.config.cameraGrid = { ...cameraManager.config };
          this.config.cameras = [...cameraManager.cameraConfigs];
          cameraManager.setupGrid();
          this.updateCameraSettings();
        }
      });
    }

    // Appearance sliders
    this.setupAppearanceListeners();

    // Widget toggles
    this.setupWidgetToggleListeners();

    // Calendar controls
    this.setupCalendarListeners();

    // Import/Export
    this.setupImportExportListeners();

    // Keyboard shortcuts
    this.setupKeyboardListeners();
  }

  /**
   * Set up appearance control listeners
   */
  setupAppearanceListeners() {
    const opacityInput = document.getElementById('widgetOpacity');
    const blurInput = document.getElementById('blurAmount');
    const fontSizeInput = document.getElementById('fontSize');
    const calFontSizeInput = document.getElementById('calendarFontSize');

    if (opacityInput) {
      opacityInput.addEventListener('input', (e) => {
        this.config.appearance.opacity = parseFloat(e.target.value);
        this.applyAppearance();
      });
    }

    if (blurInput) {
      blurInput.addEventListener('input', (e) => {
        this.config.appearance.blur = parseInt(e.target.value);
        this.applyAppearance();
      });
    }

    if (fontSizeInput) {
      fontSizeInput.addEventListener('input', (e) => {
        this.config.appearance.fontSize = parseInt(e.target.value);
        this.applyAppearance();
      });
    }

    if (calFontSizeInput) {
      calFontSizeInput.addEventListener('input', (e) => {
        this.config.calendarFontSize = parseFloat(e.target.value);
        calendarService.setFontSize(e.target.value);
      });
    }
  }

  /**
   * Set up widget toggle listeners
   */
  setupWidgetToggleListeners() {
    const widgetMap = {
      'Clock Widget': 'clock',
      'Weather Widget': 'weather',
      'Temperature Sensor 1': 'temp1',
      'Temperature Sensor 2': 'temp2',
    };

    document.querySelectorAll('.widget-toggle').forEach((toggle) => {
      const input = toggle.querySelector('input');
      const name = toggle.querySelector('span')?.textContent?.trim();
      const widgetId = widgetMap[name];

      if (!input || !widgetId) return;

      input.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        widgetManager.setVisibility(widgetId, enabled);
        this.config.widgets[widgetId].enabled = enabled;

        // Start/stop sensor polling
        if (widgetId === 'temp1' || widgetId === 'temp2') {
          if (enabled) {
            sensorService.startPolling(widgetId);
          } else {
            sensorService.stopPolling(widgetId);
          }
        }
      });
    });
  }

  /**
   * Set up calendar control listeners
   */
  setupCalendarListeners() {
    const dateInput = document.getElementById('calendarDate');
    const messageInput = document.getElementById('calendarMessage');
    const saveBtn = document.getElementById('saveCalendarEvent');
    const testBtn = document.getElementById('testCalendar');
    const exportBtn = document.getElementById('exportCalendar');

    if (saveBtn && dateInput && messageInput) {
      saveBtn.addEventListener('click', () => {
        calendarService.setEvent(dateInput.value, messageInput.value);
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => {
        calendarService.testBanner();
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        calendarService.downloadEvents();
      });
    }
  }

  /**
   * Set up import/export listeners
   */
  setupImportExportListeners() {
    const importInput = document.getElementById('importConfig');

    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const imported = JSON.parse(event.target.result);
              this.config = deepMerge(this.config, imported);
              this.applyConfig();
            } catch (error) {
              console.error('Error importing configuration:', error);
              alert('Error importing configuration file');
            }
          };
          reader.readAsText(file);
        }
      });
    }
  }

  /**
   * Set up keyboard shortcut listeners
   */
  setupKeyboardListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key >= '0' && e.key <= '9') {
        const urlParams = getUrlParams();
        const dashboardMode = urlParams.get('dashboard') ?? '1';
        window.location.href = `index.html?config=${e.key}&dashboard=${dashboardMode}`;
      }
    });
  }

  /**
   * Set dashboard mode (0 = HD/cameras only, 1 = full dashboard)
   * @param {number} mode - Dashboard mode
   */
  setDashboardMode(mode) {
    this.dashboardMode = mode;

    const dashboard = document.querySelector('.dashboard');
    const settingsToggle = document.querySelector('.settings-toggle');
    const cameraGrid = document.querySelector('.camera-grid');

    if (mode === 0) {
      // HD mode - cameras only
      if (dashboard) dashboard.style.display = 'none';
      if (settingsToggle) settingsToggle.style.display = 'none';
      if (cameraGrid) cameraGrid.style.zIndex = '1';
      widgetManager.hideAll();
      calendarService.hideBanner();
    } else {
      // Full dashboard mode
      if (dashboard) dashboard.style.display = 'block';
      if (settingsToggle) settingsToggle.style.display = 'block';
      if (cameraGrid) cameraGrid.style.zIndex = '-1';
      widgetManager.showEnabled();
    }
  }

  /**
   * Export current configuration
   */
  exportConfig() {
    // Update widget positions from current state
    const widgetConfigs = widgetManager.exportConfigs();
    Object.entries(widgetConfigs).forEach(([widgetId, config]) => {
      if (this.config.widgets[widgetId]) {
        this.config.widgets[widgetId].position = config.position;
        this.config.widgets[widgetId].size = config.size;
        this.config.widgets[widgetId].enabled = config.enabled;
      }
    });

    // Update weather data
    if (this.config.widgets.weather) {
      this.config.widgets.weather.weatherData = weatherService.getWeatherData();
    }

    const exportData = {
      theme: this.config.theme,
      cameras: this.config.cameras,
      widgets: this.config.widgets,
      sensors: this.config.sensors,
      appearance: this.config.appearance,
      cameraGrid: this.config.cameraGrid,
      calendarFontSize: this.config.calendarFontSize,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dashboard-config.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Reset to default configuration
   */
  resetConfig() {
    this.config = this.createDefaultConfig();
    this.applyConfig();
  }

  /**
   * Clean up all resources
   */
  destroy() {
    cameraManager.destroy();
    weatherService.destroy();
    sensorService.destroy();
    calendarService.destroy();
    widgetManager.destroy();
    this.initialized = false;
    console.log('[ConfigManager] All services destroyed');
  }
  
  /**
   * Get health status for all services (debugging)
   * @returns {Object} Health status of all services
   */
  getHealthStatus() {
    return {
      configManager: {
        initialized: this.initialized,
        dashboardMode: this.dashboardMode,
        theme: this.config.theme,
      },
      cameras: cameraManager.getHealthStatus(),
      weather: weatherService.getHealthStatus(),
      sensors: sensorService.getHealthStatus(),
      widgets: widgetManager.getHealthStatus(),
    };
  }
}

// Export singleton instance
export const configManager = new ConfigManager();
