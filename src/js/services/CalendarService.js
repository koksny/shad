/**
 * SHAD - Simple Home Assistant Dashboard
 * Calendar Service
 * 
 * Handles calendar events and banner display
 */

import { formatDateISO } from '../utils/helpers.js';

export class CalendarService {
  constructor() {
    this.events = {};
    this.bannerElement = null;
    this.checkInterval = null;
    this.isVisible = false;
    this.isDestroyed = false;
    this.isPaused = false;
    
    // Abort controller for fetch
    this.abortController = null;
    
    // Check interval: 30 seconds
    this.CHECK_INTERVAL_MS = 30 * 1000;
    
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
   * Pause checking when page is hidden
   */
  pause() {
    this.isPaused = true;
    this.stopChecking();
    console.log('[CalendarService] Paused (page hidden)');
  }

  /**
   * Resume checking when page becomes visible
   */
  resume() {
    if (this.isDestroyed) return;
    this.isPaused = false;
    
    // Check immediately on resume
    this.checkTodayEvent();
    console.log('[CalendarService] Resumed (page visible)');
  }

  /**
   * Initialize the calendar service
   * @param {HTMLElement} bannerElement - The calendar banner element
   */
  init(bannerElement) {
    this.bannerElement = bannerElement;
  }

  /**
   * Load calendar events from file
   * @returns {Promise<void>}
   */
  async loadEvents() {
    if (this.isDestroyed) return;
    
    // Abort any previous load
    if (this.abortController) {
      this.abortController.abort();
    }
    
    this.abortController = new AbortController();
    
    try {
      const response = await fetch('config/calendar.json', {
        signal: this.abortController.signal,
      });
      
      if (this.isDestroyed) return;
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      
      // Normalize event keys to ISO date format
      this.events = Object.keys(data).reduce((acc, key) => {
        acc[key] = data[key];
        return acc;
      }, {});

      console.log(`[CalendarService] Loaded ${Object.keys(this.events).length} calendar events`);
    } catch (error) {
      // Don't log abort errors
      if (error.name === 'AbortError') return;
      
      console.error('[CalendarService] Error loading calendar data:', error);
      this.events = {};
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Set events directly (for import/export)
   * @param {Object} events - Calendar events object
   */
  setEvents(events) {
    this.events = events || {};
  }

  /**
   * Get all events
   * @returns {Object} Calendar events
   */
  getEvents() {
    return { ...this.events };
  }

  /**
   * Add or update an event
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} message - Event message
   */
  setEvent(date, message) {
    if (message && message.trim()) {
      this.events[date] = message.trim();
    } else {
      delete this.events[date];
    }
  }

  /**
   * Get event for a specific date
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {string|null} Event message or null
   */
  getEvent(date) {
    return this.events[date] || null;
  }

  /**
   * Start checking for calendar events
   * @param {boolean} dashboardMode - Whether dashboard mode is enabled
   */
  startChecking(dashboardMode = true) {
    if (this.isDestroyed || this.isPaused) return;
    
    this.stopChecking();

    // Don't run checks in HD mode (dashboard=0)
    if (!dashboardMode) {
      this.hideBanner();
      return;
    }

    // Initial check
    this.checkTodayEvent();

    // Set up interval
    this.checkInterval = setInterval(() => {
      if (!this.isPaused) {
        this.checkTodayEvent();
      }
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop checking for calendar events
   */
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for today's event and update banner
   */
  checkTodayEvent() {
    if (!this.bannerElement) return;

    const today = formatDateISO(new Date());
    const event = this.events[today];

    if (event) {
      this.showBanner(event);
    } else {
      this.hideBanner();
    }
  }

  /**
   * Show the calendar banner with a message
   * @param {string} message - Message to display
   */
  showBanner(message) {
    if (!this.bannerElement || this.isDestroyed) return;

    // Escape HTML to prevent XSS
    const div = document.createElement('div');
    div.textContent = message;
    this.bannerElement.textContent = div.textContent;
    
    this.bannerElement.style.width = 'auto';
    this.bannerElement.classList.add('visible');
    this.bannerElement.classList.add('sliding');
    this.isVisible = true;
  }

  /**
   * Hide the calendar banner
   */
  hideBanner() {
    if (!this.bannerElement) return;

    this.bannerElement.classList.remove('visible');
    this.bannerElement.classList.remove('sliding');
    this.isVisible = false;
  }

  /**
   * Test the calendar banner with a test message
   */
  testBanner() {
    this.showBanner('Test Message - This is a test scroll!');
  }

  /**
   * Export calendar events as JSON blob
   * @returns {Blob} JSON blob of calendar events
   */
  exportEvents() {
    return new Blob([JSON.stringify(this.events, null, 2)], {
      type: 'application/json',
    });
  }

  /**
   * Download calendar events as a file
   */
  downloadEvents() {
    const blob = this.exportEvents();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'calendar.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Update calendar font size CSS variable
   * @param {number} size - Font size in em units
   */
  setFontSize(size) {
    document.documentElement.style.setProperty(
      '--calendar-font-size',
      `${size}em`
    );
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    // Remove visibility handler
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    
    // Abort any in-flight request
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    this.stopChecking();
    this.hideBanner();
    console.log('[CalendarService] Destroyed');
  }
  
  /**
   * Get health status for debugging
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      isDestroyed: this.isDestroyed,
      isPaused: this.isPaused,
      eventCount: Object.keys(this.events).length,
      isVisible: this.isVisible,
      checkingActive: this.checkInterval !== null,
    };
  }
}

// Export singleton instance
export const calendarService = new CalendarService();
