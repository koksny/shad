/**
 * SHAD - Simple Home Assistant Dashboard
 * Sensor Service
 * 
 * Handles polling and display of temperature/humidity sensors
 */

export class SensorService {
  constructor() {
    /** @type {Map<string, {interval: number|null, config: Object, abortController: AbortController|null, consecutiveErrors: number}>} */
    this.sensors = new Map();
    this.isPaused = false;
    this.isDestroyed = false;
    
    // Track visibility for efficiency
    this.visibilityHandler = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Handle page visibility changes - pause polling when hidden
   */
  handleVisibilityChange() {
    if (this.isDestroyed) return;
    
    if (document.hidden) {
      this.pauseAll();
    } else {
      this.resumeAll();
    }
  }

  /**
   * Pause all sensor polling (when page is hidden)
   */
  pauseAll() {
    this.isPaused = true;
    this.sensors.forEach((sensor, sensorId) => {
      if (sensor.interval) {
        clearInterval(sensor.interval);
        sensor.interval = null;
      }
      // Abort any in-flight requests
      if (sensor.abortController) {
        sensor.abortController.abort();
        sensor.abortController = null;
      }
    });
    console.log('[SensorService] Polling paused (page hidden)');
  }

  /**
   * Resume all sensor polling (when page becomes visible)
   */
  resumeAll() {
    if (this.isDestroyed) return;
    this.isPaused = false;
    
    this.sensors.forEach((sensor, sensorId) => {
      if (sensor.config.url) {
        // Immediate poll on resume
        this.pollSensor(sensorId);
        // Restart interval
        sensor.interval = setInterval(() => {
          this.pollSensor(sensorId);
        }, sensor.config.refreshInterval * 1000);
      }
    });
    console.log('[SensorService] Polling resumed (page visible)');
  }

  /**
   * Initialize a sensor
   * @param {string} sensorId - Sensor identifier (e.g., 'temp1', 'temp2')
   * @param {Object} config - Sensor configuration
   * @param {string} config.url - Sensor data URL
   * @param {string} config.name - Sensor display name
   * @param {number} config.refreshInterval - Refresh interval in seconds
   */
  initSensor(sensorId, config) {
    // Stop any existing polling for this sensor
    this.stopPolling(sensorId);

    this.sensors.set(sensorId, {
      interval: null,
      abortController: null,
      consecutiveErrors: 0,
      config: {
        url: config?.url || '',
        name: config?.name || `Sensor ${sensorId}`,
        refreshInterval: config?.refreshInterval || 30,
      },
    });
  }

  /**
   * Start polling a sensor
   * @param {string} sensorId - Sensor identifier
   */
  startPolling(sensorId) {
    if (this.isDestroyed) return;
    
    const sensor = this.sensors.get(sensorId);
    if (!sensor) {
      console.warn(`Sensor ${sensorId} not initialized`);
      return;
    }

    // Stop existing polling
    this.stopPolling(sensorId);

    const { config } = sensor;

    if (!config.url) {
      console.log(`No URL configured for sensor ${sensorId}`);
      this.updateWidget(sensorId, {
        name: config.name,
        temperature: null,
        humidity: null,
      });
      return;
    }

    // Don't start if paused
    if (this.isPaused) return;

    // Initial poll
    this.pollSensor(sensorId);

    // Set up interval
    sensor.interval = setInterval(() => {
      this.pollSensor(sensorId);
    }, config.refreshInterval * 1000);
  }

  /**
   * Stop polling a sensor
   * @param {string} sensorId - Sensor identifier
   */
  stopPolling(sensorId) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) return;
    
    if (sensor.interval) {
      clearInterval(sensor.interval);
      sensor.interval = null;
    }
    
    // Abort any in-flight request
    if (sensor.abortController) {
      sensor.abortController.abort();
      sensor.abortController = null;
    }
  }

  /**
   * Poll a sensor for data
   * @param {string} sensorId - Sensor identifier
   */
  async pollSensor(sensorId) {
    if (this.isDestroyed || this.isPaused) return;
    
    const sensor = this.sensors.get(sensorId);
    if (!sensor) return;

    const { config } = sensor;
    
    // Abort any previous in-flight request for this sensor
    if (sensor.abortController) {
      sensor.abortController.abort();
    }
    
    // Create new abort controller for this request
    sensor.abortController = new AbortController();
    const timeoutId = setTimeout(() => sensor.abortController?.abort(), 10000); // 10s timeout

    try {
      // Add cache-busting parameter
      const url = `${config.url}?_=${Date.now()}`;
      const response = await fetch(url, {
        cache: 'no-cache',
        signal: sensor.abortController.signal,
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      clearTimeout(timeoutId);
      
      if (this.isDestroyed) return;

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const dataText = await response.text();

      // Parse sensor data (format: T:XX.X M:XX.X)
      const tempMatch = dataText.match(/T:([\d.]+)/);
      const humMatch = dataText.match(/M:([\d.]+)/);

      const temperature = tempMatch ? parseFloat(tempMatch[1]) : null;
      const humidity = humMatch ? parseFloat(humMatch[1]) : null;

      // Reset error counter on success
      sensor.consecutiveErrors = 0;
      
      this.updateWidget(sensorId, {
        name: config.name,
        temperature,
        humidity,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Don't log abort errors (expected when switching tabs or cleaning up)
      if (error.name === 'AbortError') return;
      
      sensor.consecutiveErrors++;
      
      // Only log errors occasionally to reduce console spam
      if (sensor.consecutiveErrors <= 3 || sensor.consecutiveErrors % 10 === 0) {
        console.error(`[SensorService] Error polling ${sensorId} (attempt ${sensor.consecutiveErrors}):`, error.message);
      }
      
      this.updateWidget(sensorId, {
        name: config.name,
        temperature: null,
        humidity: null,
        error: true,
      });
    } finally {
      sensor.abortController = null;
    }
  }

  /**
   * Update sensor widget display
   * @param {string} sensorId - Sensor identifier
   * @param {Object} data - Sensor data
   * @param {string} data.name - Sensor name
   * @param {number|null} data.temperature - Temperature value
   * @param {number|null} data.humidity - Humidity value
   * @param {boolean} [data.error] - Whether there was an error
   */
  updateWidget(sensorId, data) {
    const widget = document.getElementById(sensorId);
    if (!widget) return;

    const nameElement = widget.querySelector('.sensor-name');
    const tempElement = widget.querySelector('.temperature');
    const humElement = widget.querySelector('.humidity');

    if (nameElement) {
      nameElement.textContent = data.name;
    }

    if (tempElement) {
      if (data.error) {
        tempElement.textContent = 'Error';
      } else if (data.temperature !== null) {
        tempElement.textContent = `${data.temperature.toFixed(1)}°C`;
      } else {
        tempElement.textContent = '--°C';
      }
    }

    if (humElement) {
      if (data.error) {
        humElement.textContent = '';
      } else if (data.humidity !== null) {
        humElement.textContent = `${data.humidity.toFixed(0)}%`;
      } else {
        humElement.textContent = '--%';
      }
    }
  }

  /**
   * Update sensor configuration
   * @param {string} sensorId - Sensor identifier
   * @param {Object} config - New configuration
   */
  updateConfig(sensorId, config) {
    const sensor = this.sensors.get(sensorId);
    if (sensor) {
      sensor.config = {
        url: config?.url || '',
        name: config?.name || `Sensor ${sensorId}`,
        refreshInterval: config?.refreshInterval || 30,
      };
    } else {
      this.initSensor(sensorId, config);
    }
  }

  /**
   * Get sensor configuration
   * @param {string} sensorId - Sensor identifier
   * @returns {Object|null} Sensor configuration
   */
  getConfig(sensorId) {
    return this.sensors.get(sensorId)?.config || null;
  }

  /**
   * Apply sensor settings and restart polling
   * @param {string} sensorId - Sensor identifier
   * @param {Object} config - New configuration
   */
  applySettings(sensorId, config) {
    this.updateConfig(sensorId, config);
    this.startPolling(sensorId);
  }

  /**
   * Stop all sensor polling
   */
  stopAll() {
    this.sensors.forEach((sensor, sensorId) => {
      this.stopPolling(sensorId);
    });
  }

  /**
   * Clean up all resources
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    // Remove visibility listener
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    
    this.stopAll();
    this.sensors.clear();
    console.log('[SensorService] Destroyed');
  }
  
  /**
   * Get health status for debugging
   * @returns {Object} Health status of all sensors
   */
  getHealthStatus() {
    const status = {};
    this.sensors.forEach((sensor, sensorId) => {
      status[sensorId] = {
        polling: sensor.interval !== null,
        url: sensor.config.url,
        consecutiveErrors: sensor.consecutiveErrors,
        hasInFlightRequest: sensor.abortController !== null,
      };
    });
    return {
      isPaused: this.isPaused,
      isDestroyed: this.isDestroyed,
      sensors: status,
    };
  }
}

// Export singleton instance
export const sensorService = new SensorService();
