/**
 * SHAD - Simple Home Assistant Dashboard
 * Weather Service
 * 
 * Handles weather data fetching and city search
 */

import { getWeatherIcon } from '../utils/helpers.js';

export class WeatherService {
  constructor() {
    this.currentLat = null;
    this.currentLon = null;
    this.currentCity = '';
    this.updateInterval = null;
    this.searchTimeout = null;
    this.weatherInfoElement = null;
    this.cityInputElement = null;
    this.suggestionsElement = null;
    
    // Abort controllers for cancelable requests
    this.weatherAbortController = null;
    this.searchAbortController = null;
    
    // Track state
    this.isDestroyed = false;
    this.isPaused = false;
    this.isFetching = false;
    this.lastFetchTime = 0;
    
    // Bound handlers for cleanup
    this.boundHandlers = {};
    
    // Update interval: 15 minutes
    this.UPDATE_INTERVAL_MS = 15 * 60 * 1000;
    // Minimum time between fetches: 1 minute
    this.MIN_FETCH_INTERVAL_MS = 60 * 1000;
    // Search debounce: 300ms
    this.SEARCH_DEBOUNCE_MS = 300;
    // Request timeout: 15 seconds
    this.REQUEST_TIMEOUT_MS = 15000;
    
    // Setup visibility handling
    this.visibilityHandler = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Handle page visibility changes
   */
  handleVisibilityChange() {
    if (this.isDestroyed) return;
    
    if (document.hidden) {
      this.pause();
    } else {
      this.resume();
    }
  }

  /**
   * Pause weather updates when page is hidden
   */
  pause() {
    this.isPaused = true;
    this.stopAutoUpdate();
    // Abort any in-flight requests
    this.abortRequests();
    console.log('[WeatherService] Paused (page hidden)');
  }

  /**
   * Resume weather updates when page becomes visible
   */
  resume() {
    if (this.isDestroyed) return;
    this.isPaused = false;
    
    // Check if we need to refresh (more than update interval since last fetch)
    const timeSinceLastFetch = Date.now() - this.lastFetchTime;
    if (this.currentLat && this.currentLon && timeSinceLastFetch > this.UPDATE_INTERVAL_MS) {
      this.updateWeather();
    }
    
    this.startAutoUpdate();
    console.log('[WeatherService] Resumed (page visible)');
  }

  /**
   * Abort any in-flight requests
   */
  abortRequests() {
    if (this.weatherAbortController) {
      this.weatherAbortController.abort();
      this.weatherAbortController = null;
    }
    if (this.searchAbortController) {
      this.searchAbortController.abort();
      this.searchAbortController = null;
    }
  }

  /**
   * Initialize the weather service
   * @param {Object} elements - DOM elements
   * @param {HTMLElement} elements.weatherInfo - Weather info container
   * @param {HTMLInputElement} elements.cityInput - City search input
   * @param {HTMLElement} elements.suggestions - City suggestions container
   */
  init(elements) {
    this.weatherInfoElement = elements.weatherInfo;
    this.cityInputElement = elements.cityInput;
    this.suggestionsElement = elements.suggestions;

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for city search
   */
  setupEventListeners() {
    if (!this.cityInputElement || !this.suggestionsElement) return;

    // Store bound handlers for later cleanup
    this.boundHandlers.citySearch = () => this.handleCitySearch();
    this.boundHandlers.suggestionClick = (e) => this.handleSuggestionClick(e);
    this.boundHandlers.outsideClick = (e) => {
      if (
        !this.cityInputElement.contains(e.target) &&
        !this.suggestionsElement.contains(e.target)
      ) {
        this.suggestionsElement.innerHTML = '';
      }
    };

    // City search input handler
    this.cityInputElement.addEventListener('input', this.boundHandlers.citySearch);

    // City suggestion click handler
    this.suggestionsElement.addEventListener('click', this.boundHandlers.suggestionClick);

    // Close suggestions when clicking outside
    document.addEventListener('click', this.boundHandlers.outsideClick);
  }

  /**
   * Handle city search input
   */
  handleCitySearch() {
    clearTimeout(this.searchTimeout);

    const query = this.cityInputElement.value.trim();
    if (query.length < 3) {
      this.suggestionsElement.innerHTML = '';
      return;
    }

    this.searchTimeout = setTimeout(() => {
      this.searchCities(query);
    }, this.SEARCH_DEBOUNCE_MS);
  }

  /**
   * Search for cities using Open-Meteo geocoding API
   * @param {string} query - Search query
   */
  async searchCities(query) {
    if (this.isDestroyed) return;
    
    // Abort any previous search
    if (this.searchAbortController) {
      this.searchAbortController.abort();
    }
    
    this.searchAbortController = new AbortController();
    const timeoutId = setTimeout(() => this.searchAbortController?.abort(), this.REQUEST_TIMEOUT_MS);
    
    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          query
        )}&count=5&language=en&format=json`,
        { signal: this.searchAbortController.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (this.isDestroyed) return;
      
      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        this.suggestionsElement.innerHTML = '<li>No results found</li>';
        return;
      }

      const suggestions = data.results
        .map(
          (city) =>
            `<li data-lat="${city.latitude}" data-lon="${city.longitude}">${this.escapeHtml(city.name)}, ${this.escapeHtml(city.country)}</li>`
        )
        .join('');

      this.suggestionsElement.innerHTML = suggestions;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Don't log abort errors
      if (error.name === 'AbortError') return;
      
      console.error('[WeatherService] Error searching cities:', error);
      if (this.suggestionsElement) {
        this.suggestionsElement.innerHTML = '<li>Error searching cities</li>';
      }
    } finally {
      this.searchAbortController = null;
    }
  }
  
  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle click on city suggestion
   * @param {Event} e - Click event
   */
  async handleSuggestionClick(e) {
    const li = e.target.closest('li');
    if (!li || !li.dataset.lat) return;

    const lat = parseFloat(li.dataset.lat);
    const lon = parseFloat(li.dataset.lon);
    const cityName = li.textContent.trim();

    this.cityInputElement.value = cityName;
    this.suggestionsElement.innerHTML = '';

    this.currentLat = lat;
    this.currentLon = lon;
    this.currentCity = cityName;

    await this.updateWeather();
  }

  /**
   * Load weather data from config
   * @param {Object} weatherData - Saved weather data
   * @param {string} weatherData.city - City name
   * @param {number} weatherData.lat - Latitude
   * @param {number} weatherData.lon - Longitude
   */
  async loadFromConfig(weatherData) {
    if (!weatherData) return;

    this.currentCity = weatherData.city || '';
    this.currentLat = weatherData.lat || null;
    this.currentLon = weatherData.lon || null;

    if (this.cityInputElement) {
      this.cityInputElement.value = this.currentCity;
    }

    if (this.currentLat && this.currentLon) {
      await this.updateWeather();
    }
  }

  /**
   * Get current weather data for export
   * @returns {Object} Weather data
   */
  getWeatherData() {
    return {
      city: this.currentCity,
      lat: this.currentLat,
      lon: this.currentLon,
    };
  }

  /**
   * Start automatic weather updates
   */
  startAutoUpdate() {
    this.stopAutoUpdate();

    if (this.currentLat && this.currentLon) {
      this.updateInterval = setInterval(() => {
        this.updateWeather();
      }, this.UPDATE_INTERVAL_MS);
    }
  }

  /**
   * Stop automatic weather updates
   */
  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Update weather data from API
   */
  async updateWeather() {
    if (this.isDestroyed || this.isPaused) return;
    if (!this.currentLat || !this.currentLon || !this.weatherInfoElement) {
      return;
    }
    
    // Prevent duplicate requests
    if (this.isFetching) {
      console.log('[WeatherService] Request already in progress, skipping');
      return;
    }
    
    // Rate limit requests
    const timeSinceLastFetch = Date.now() - this.lastFetchTime;
    if (this.lastFetchTime > 0 && timeSinceLastFetch < this.MIN_FETCH_INTERVAL_MS) {
      console.log('[WeatherService] Rate limited, skipping request');
      return;
    }
    
    // Abort any previous weather request
    if (this.weatherAbortController) {
      this.weatherAbortController.abort();
    }
    
    this.weatherAbortController = new AbortController();
    this.isFetching = true;
    const timeoutId = setTimeout(() => this.weatherAbortController?.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?` +
          `latitude=${this.currentLat}&longitude=${this.currentLon}` +
          `&current_weather=true` +
          `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
          `&hourly=temperature_2m,relativehumidity_2m,windspeed_10m,windgusts_10m,pressure_msl` +
          `&timezone=auto`,
        { signal: this.weatherAbortController.signal }
      );

      clearTimeout(timeoutId);
      
      if (this.isDestroyed) return;

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      this.lastFetchTime = Date.now();
      this.renderWeather(data);

      // Restart auto-update timer on successful fetch
      this.startAutoUpdate();
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Don't log abort errors
      if (error.name === 'AbortError') return;
      
      console.error('[WeatherService] Error updating weather:', error);
      this.renderError();
    } finally {
      this.isFetching = false;
      this.weatherAbortController = null;
    }
  }

  /**
   * Render weather data to the DOM
   * @param {Object} data - Weather API response
   */
  renderWeather(data) {
    if (!this.weatherInfoElement) return;

    const current = data.current_weather;
    const currentHour = new Date().getHours();

    // Build forecast HTML
    let forecastDays = '';
    for (let i = 1; i <= 4; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      forecastDays += `
        <div class="forecast-item">
          <div>${date.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
          <div>${getWeatherIcon(data.daily.weathercode[i])}</div>
          <div>${Math.round(data.daily.temperature_2m_max[i])}°</div>
          <div>${Math.round(data.daily.temperature_2m_min[i])}°</div>
        </div>
      `;
    }

    this.weatherInfoElement.innerHTML = `
      <div class="weather-icon">${getWeatherIcon(current.weathercode)}</div>
      <div class="temperature">${Math.round(current.temperature)}°C</div>
      <div class="last-update">Last updated: ${new Date().toLocaleTimeString('en-GB', {
        hour12: false,
      })}</div>
      <div class="weather-details">
        <div class="wind">Wind: ${Math.round(current.windspeed)} km/h</div>
        <div class="gusts">Gusts: ${Math.round(
          data.hourly.windgusts_10m[currentHour]
        )} km/h</div>
        <div class="pressure">Pressure: ${Math.round(
          data.hourly.pressure_msl[currentHour]
        )} hPa</div>
        <div class="humidity">Humidity: ${
          data.hourly.relativehumidity_2m[currentHour]
        }%</div>
      </div>
      <div class="forecast">
        <div class="forecast-title">Next Days:</div>
        <div class="forecast-items">
          ${forecastDays}
        </div>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError() {
    if (!this.weatherInfoElement) return;

    this.weatherInfoElement.innerHTML = `
      <div class="weather-icon">❌</div>
      <div class="temperature">--°C</div>
      <div class="last-update">Error loading weather</div>
    `;
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    // Remove visibility handler
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    
    // Abort in-flight requests
    this.abortRequests();
    
    // Stop auto-update
    this.stopAutoUpdate();
    clearTimeout(this.searchTimeout);
    
    // Remove event listeners
    if (this.cityInputElement && this.boundHandlers.citySearch) {
      this.cityInputElement.removeEventListener('input', this.boundHandlers.citySearch);
    }
    if (this.suggestionsElement && this.boundHandlers.suggestionClick) {
      this.suggestionsElement.removeEventListener('click', this.boundHandlers.suggestionClick);
    }
    if (this.boundHandlers.outsideClick) {
      document.removeEventListener('click', this.boundHandlers.outsideClick);
    }
    
    this.boundHandlers = {};
    console.log('[WeatherService] Destroyed');
  }
  
  /**
   * Get health status for debugging
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      isDestroyed: this.isDestroyed,
      isPaused: this.isPaused,
      isFetching: this.isFetching,
      hasLocation: !!(this.currentLat && this.currentLon),
      city: this.currentCity,
      lastFetchTime: this.lastFetchTime ? new Date(this.lastFetchTime).toISOString() : null,
      autoUpdateActive: this.updateInterval !== null,
    };
  }
}

// Export singleton instance
export const weatherService = new WeatherService();
