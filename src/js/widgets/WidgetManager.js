/**
 * SHAD - Simple Home Assistant Dashboard
 * Widget Manager
 * 
 * Handles widget positioning, resizing, and visibility
 */

import { throttle } from '../utils/helpers.js';

export class WidgetManager {
  constructor() {
    this.widgets = new Map();
    this.interactInitialized = false;
    this.isDestroyed = false;
    
    // Store interact instances for cleanup
    this.interactableElements = [];
    
    // Bound handlers for cleanup
    this.boundDragMove = null;
    this.boundResizeMove = null;
    
    // Base dimensions for font scaling
    this.BASE_WIDTH = 250;
    this.BASE_HEIGHT = 150;
    this.BASE_FONT_SIZE = 16;
    
    // Minimum widget dimensions
    this.MIN_WIDTH = 100;
    this.MIN_HEIGHT = 80;
  }

  /**
   * Initialize a widget
   * @param {string} widgetId - Widget identifier
   * @param {Object} config - Widget configuration
   * @param {boolean} config.enabled - Whether widget is visible
   * @param {{x: number, y: number}} config.position - Widget position
   * @param {{w: number, h: number}} config.size - Widget size
   */
  registerWidget(widgetId, config) {
    if (this.isDestroyed) return;
    
    const element = document.getElementById(widgetId);
    if (!element) {
      console.warn(`Widget element not found: ${widgetId}`);
      return;
    }

    // Validate and sanitize config
    const position = this.sanitizePosition(config?.position);
    const size = this.sanitizeSize(config?.size);

    this.widgets.set(widgetId, {
      element,
      config: {
        enabled: config?.enabled ?? true,
        position,
        size,
      },
    });
  }

  /**
   * Sanitize position values
   * @param {Object} position - Position object
   * @returns {Object} Sanitized position
   */
  sanitizePosition(position) {
    const x = Math.max(0, parseFloat(position?.x) || 0);
    const y = Math.max(0, parseFloat(position?.y) || 0);
    
    // Ensure widget stays within viewport bounds (with some buffer)
    const maxX = Math.max(0, window.innerWidth - 50);
    const maxY = Math.max(0, window.innerHeight - 50);
    
    return {
      x: Math.min(x, maxX),
      y: Math.min(y, maxY),
    };
  }

  /**
   * Sanitize size values
   * @param {Object} size - Size object
   * @returns {Object} Sanitized size
   */
  sanitizeSize(size) {
    const w = Math.max(this.MIN_WIDTH, parseFloat(size?.w) || this.BASE_WIDTH);
    const h = Math.max(this.MIN_HEIGHT, parseFloat(size?.h) || this.BASE_HEIGHT);
    
    // Cap maximum size to prevent excessive memory use
    return {
      w: Math.min(w, 2000),
      h: Math.min(h, 2000),
    };
  }

  /**
   * Apply configuration to all registered widgets
   */
  applyAll() {
    this.widgets.forEach((widget, widgetId) => {
      this.applyPosition(widgetId);
      this.applyVisibility(widgetId);
    });
  }

  /**
   * Apply position and size to a widget
   * @param {string} widgetId - Widget identifier
   */
  applyPosition(widgetId) {
    const widget = this.widgets.get(widgetId);
    if (!widget) return;

    const { element, config } = widget;
    const { position, size } = config;

    // Apply position
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;

    // Apply size
    element.style.width = `${size.w}px`;
    element.style.height = `${size.h}px`;

    // Apply scaled font size
    this.applyFontScale(element, size.w, size.h);
  }

  /**
   * Apply font scaling based on widget size
   * @param {HTMLElement} element - Widget element
   * @param {number} width - Widget width
   * @param {number} height - Widget height
   */
  applyFontScale(element, width, height) {
    const scaleWidth = width / this.BASE_WIDTH;
    const scaleHeight = height / this.BASE_HEIGHT;
    const scale = Math.min(scaleWidth, scaleHeight);
    const fontSize = this.BASE_FONT_SIZE * scale;
    element.style.fontSize = `${fontSize}px`;
  }

  /**
   * Apply visibility to a widget
   * @param {string} widgetId - Widget identifier
   */
  applyVisibility(widgetId) {
    const widget = this.widgets.get(widgetId);
    if (!widget) return;

    widget.element.style.display = widget.config.enabled ? 'block' : 'none';
  }

  /**
   * Set widget visibility
   * @param {string} widgetId - Widget identifier
   * @param {boolean} visible - Whether widget should be visible
   * @returns {boolean} The new visibility state
   */
  setVisibility(widgetId, visible) {
    const widget = this.widgets.get(widgetId);
    if (!widget) return false;

    widget.config.enabled = visible;
    this.applyVisibility(widgetId);
    return visible;
  }

  /**
   * Toggle widget visibility
   * @param {string} widgetId - Widget identifier
   * @returns {boolean} The new visibility state
   */
  toggleVisibility(widgetId) {
    const widget = this.widgets.get(widgetId);
    if (!widget) return false;

    return this.setVisibility(widgetId, !widget.config.enabled);
  }

  /**
   * Get widget configuration
   * @param {string} widgetId - Widget identifier
   * @returns {Object|null} Widget configuration
   */
  getConfig(widgetId) {
    return this.widgets.get(widgetId)?.config || null;
  }

  /**
   * Update widget configuration
   * @param {string} widgetId - Widget identifier
   * @param {Object} config - New configuration
   */
  updateConfig(widgetId, config) {
    const widget = this.widgets.get(widgetId);
    if (!widget) return;

    if (config.enabled !== undefined) {
      widget.config.enabled = config.enabled;
    }
    if (config.position) {
      widget.config.position = { ...config.position };
    }
    if (config.size) {
      widget.config.size = { ...config.size };
    }
  }

  /**
   * Get all widget configurations for export
   * @returns {Object} All widget configurations
   */
  exportConfigs() {
    const configs = {};
    
    this.widgets.forEach((widget, widgetId) => {
      const { element, config } = widget;
      
      // Get current position from element (may have been moved)
      const x = parseFloat(element.style.left) || config.position.x;
      const y = parseFloat(element.style.top) || config.position.y;
      const w = element.offsetWidth || config.size.w;
      const h = element.offsetHeight || config.size.h;

      configs[widgetId] = {
        enabled: config.enabled,
        position: { x, y },
        size: { w, h },
      };
    });

    return configs;
  }

  /**
   * Initialize interact.js for drag and resize
   */
  initInteract() {
    if (this.isDestroyed || this.interactInitialized || typeof interact === 'undefined') {
      return;
    }

    const self = this;
    
    // Create throttled handlers and store references for potential cleanup
    this.boundDragMove = throttle(this.dragMoveListener.bind(this), 16);
    this.boundResizeMove = throttle(function (event) {
      if (self.isDestroyed) return;
      
      const target = event.target;
      
      // Apply minimum size constraints
      const width = Math.max(self.MIN_WIDTH, event.rect.width);
      const height = Math.max(self.MIN_HEIGHT, event.rect.height);
      
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
      target.style.left = `${event.rect.left}px`;
      target.style.top = `${event.rect.top}px`;

      // Apply font scaling
      self.applyFontScale(target, width, height);
    }, 16);

    // Draggable
    interact('.widget').draggable({
      inertia: true,
      modifiers: [
        // Keep widgets within the viewport with some buffer
        interact.modifiers.restrict({
          restriction: 'parent',
          endOnly: false,
        }),
      ],
      listeners: {
        move: this.boundDragMove,
      },
    });

    // Resizable
    interact('.widget').resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      modifiers: [
        interact.modifiers.restrictSize({
          min: { width: this.MIN_WIDTH, height: this.MIN_HEIGHT },
          max: { width: 2000, height: 2000 },
        }),
      ],
      listeners: {
        move: this.boundResizeMove,
      },
    });

    this.interactInitialized = true;
    console.log('[WidgetManager] interact.js initialized');
  }

  /**
   * Handle drag move events
   * @param {Object} event - Interact.js event
   */
  dragMoveListener(event) {
    if (this.isDestroyed) return;
    
    const target = event.target;
    const left = (parseFloat(target.style.left) || 0) + event.dx;
    const top = (parseFloat(target.style.top) || 0) + event.dy;
    
    // Ensure position stays non-negative
    target.style.left = `${Math.max(0, left)}px`;
    target.style.top = `${Math.max(0, top)}px`;
  }

  /**
   * Hide all widgets (for HD mode)
   */
  hideAll() {
    this.widgets.forEach((widget) => {
      widget.element.style.display = 'none';
    });
  }

  /**
   * Show all enabled widgets
   */
  showEnabled() {
    this.widgets.forEach((widget, widgetId) => {
      if (widget.config.enabled) {
        widget.element.style.display = 'block';
      }
    });
  }

  /**
   * Check if a widget is enabled
   * @param {string} widgetId - Widget identifier
   * @returns {boolean} Whether widget is enabled
   */
  isEnabled(widgetId) {
    return this.widgets.get(widgetId)?.config.enabled ?? false;
  }

  /**
   * Get list of widget IDs
   * @returns {string[]} Array of widget IDs
   */
  getWidgetIds() {
    return Array.from(this.widgets.keys());
  }

  /**
   * Clean up all resources
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    // Clean up interact.js if initialized
    if (this.interactInitialized && typeof interact !== 'undefined') {
      try {
        // Unset interact on all widgets
        interact('.widget').unset();
      } catch (e) {
        console.warn('[WidgetManager] Error cleaning up interact.js:', e);
      }
    }
    
    // Clear widget references
    this.widgets.clear();
    this.boundDragMove = null;
    this.boundResizeMove = null;
    
    console.log('[WidgetManager] Destroyed');
  }

  /**
   * Get health status for debugging
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const widgetStatus = {};
    this.widgets.forEach((widget, id) => {
      widgetStatus[id] = {
        enabled: widget.config.enabled,
        position: widget.config.position,
        size: widget.config.size,
        inDOM: document.body.contains(widget.element),
      };
    });
    
    return {
      isDestroyed: this.isDestroyed,
      interactInitialized: this.interactInitialized,
      widgetCount: this.widgets.size,
      widgets: widgetStatus,
    };
  }
}

// Export singleton instance
export const widgetManager = new WidgetManager();
