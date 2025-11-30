/**
 * SHAD - Simple Home Assistant Dashboard
 * Utility Functions
 */

/**
 * Throttle function to limit how often a function can be called
 * @param {Function} func - The function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Debounce function to delay execution until after wait period
 * @param {Function} func - The function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

/**
 * Get weather icon emoji based on weather code
 * @param {number} code - Open-Meteo weather code
 * @returns {string} Weather emoji
 */
export function getWeatherIcon(code) {
  const icons = {
    0: '☀️',   // Clear sky
    1: '🌤️',   // Mainly clear
    2: '⛅',   // Partly cloudy
    3: '☁️',   // Overcast
    45: '🌫️',  // Fog
    48: '🌫️',  // Depositing rime fog
    51: '🌧️',  // Light drizzle
    53: '🌧️',  // Moderate drizzle
    55: '🌧️',  // Dense drizzle
    61: '🌧️',  // Slight rain
    63: '🌧️',  // Moderate rain
    65: '🌧️',  // Heavy rain
    71: '🌨️',  // Slight snow
    73: '🌨️',  // Moderate snow
    75: '🌨️',  // Heavy snow
    77: '🌨️',  // Snow grains
    80: '🌧️',  // Slight rain showers
    81: '🌧️',  // Moderate rain showers
    82: '🌧️',  // Violent rain showers
    85: '🌨️',  // Slight snow showers
    86: '🌨️',  // Heavy snow showers
    95: '⛈️',  // Thunderstorm
    96: '⛈️',  // Thunderstorm with slight hail
    99: '⛈️',  // Thunderstorm with heavy hail
  };
  return icons[code] || '❓';
}

/**
 * Extract RGB values from a CSS color
 * @param {string} cssVar - CSS variable name
 * @returns {string} RGB values as "r, g, b"
 */
export function getColorRgb(cssVar) {
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim();
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match ? `${match[1]}, ${match[2]}, ${match[3]}` : '';
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
export function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format time as HH:MM:SS (24-hour)
 * @param {Date} date - Date object
 * @returns {string} Formatted time string
 */
export function formatTime24h(date) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/**
 * Format date as DD/MM/YYYY
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
export function formatDateDMY(date) {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate optimal grid layout for number of items
 * @param {number} numItems - Number of items to display
 * @returns {{columns: number, rows: number}} Grid dimensions
 */
export function calculateGridLayout(numItems) {
  numItems = clamp(numItems, 1, 18);
  
  let columns;
  if (numItems <= 1) columns = 1;
  else if (numItems <= 2) columns = 2;
  else if (numItems <= 4) columns = 2;
  else if (numItems <= 6) columns = 3;
  else if (numItems <= 9) columns = 3;
  else if (numItems <= 12) columns = 4;
  else if (numItems <= 16) columns = 4;
  else columns = 6;
  
  const rows = Math.ceil(numItems / columns);
  
  return { columns, rows };
}

/**
 * Parse URL query parameters
 * @returns {URLSearchParams} URL search params object
 */
export function getUrlParams() {
  return new URLSearchParams(window.location.search);
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
export function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Create a cleanup registry for managing disposables
 * @returns {Object} Cleanup registry with add and dispose methods
 */
export function createCleanupRegistry() {
  const cleanups = new Set();
  
  return {
    add(cleanup) {
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    dispose() {
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      });
      cleanups.clear();
    },
  };
}
