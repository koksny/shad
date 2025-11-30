/**
 * SHAD - Simple Home Assistant Dashboard
 * Camera Manager Service
 * 
 * Handles HLS camera streams with proper resource management
 * to prevent memory leaks and performance degradation.
 */

import { calculateGridLayout, clamp } from '../utils/helpers.js';

/**
 * @typedef {Object} CameraData
 * @property {Hls|null} hls - HLS.js instance
 * @property {HTMLVideoElement|null} element - Video element
 * @property {number|null} retryTimeout - Retry timeout ID
 * @property {number} retryCount - Number of retry attempts
 * @property {boolean} isDestroyed - Whether camera has been destroyed
 * @property {Function[]} eventCleanups - Event listener cleanup functions
 * @property {number} lastPlaybackTime - Last known playback time for stall detection
 * @property {number} lastCheckTime - Timestamp of last health check
 * @property {number} stallCount - Number of consecutive stalls detected
 */

export class CameraManager {
  constructor() {
    /** @type {Map<number, CameraData>} */
    this.cameras = new Map();
    this.gridElement = null;
    this.config = {
      columns: 1,
      rows: 1,
      numCameras: 1,
    };
    this.cameraConfigs = [];
    this.isPageVisible = true;
    this.visibilityHandler = null;
    this.isHDMode = false;  // HD mode = powerful device, no staggering needed
    
    // Health monitoring
    this.healthCheckInterval = null;
    this.HEALTH_CHECK_INTERVAL_MS = 5000;  // Check every 5 seconds
    this.STALL_THRESHOLD_MS = 10000;       // Consider stalled if no progress for 10s
    this.MAX_STALL_COUNT = 2;              // Auto-recover after 2 consecutive stall detections (10 seconds)
    
    // Sequential loading for low-power kiosk devices (non-HD mode only)
    // Wait for each camera to start playing before initializing the next
    this.SEQUENTIAL_TIMEOUT_MS = 15000;    // Max wait time per camera before moving to next
    this.initQueue = [];                    // Queue of cameras waiting to be initialized
    this.isInitializing = false;            // Whether sequential init is in progress
    
    // HLS.js configuration optimized for LIVE streaming (no caching)
    this.hlsConfig = {
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,              // Enable for live feeds
      backBufferLength: 0,               // Don't keep back buffer (live only)
      maxBufferLength: 10,               // Reduced - live doesn't need much buffer
      maxMaxBufferLength: 15,
      maxBufferSize: 3 * 1000 * 1000,    // 3MB max buffer
      maxBufferHole: 0.5,
      liveSyncDurationCount: 2,          // Stay closer to live edge
      liveMaxLatencyDurationCount: 4,    // Max 4 segments behind
      liveDurationInfinity: true,
      liveBackBufferLength: 0,           // No back buffer for live
      progressive: false,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 3,
      levelLoadingRetryDelay: 1000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 3,
      fragLoadingRetryDelay: 1000,
      enableWebVTT: false,
      enableCEA708Captions: false,
      stretchShortVideoTrack: false,
      capLevelToPlayerSize: true,
      capLevelOnFPSDrop: true,
      startLevel: -1,
      abrEwmaDefaultEstimate: 500000,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
    };
    
    // Retry configuration with exponential backoff
    this.maxRetryDelay = 120000;  // 2 minutes max
    this.baseRetryDelay = 3000;   // 3 seconds base
    this.maxRetryAttempts = 10;   // Max retries before long pause
    
    // Set up page visibility handling
    this.setupVisibilityHandling();
  }

  /**
   * Set up page visibility change handling to pause/resume streams
   */
  setupVisibilityHandling() {
    this.visibilityHandler = () => {
      this.isPageVisible = !document.hidden;
      if (this.isPageVisible) {
        this.resumeAllStreams();
        this.startHealthMonitor();
      } else {
        this.pauseAllStreams();
        this.stopHealthMonitor();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Start the health monitor that detects frozen/stalled feeds
   */
  startHealthMonitor() {
    this.stopHealthMonitor();
    
    console.log('[CameraManager] Starting health monitor (checking every 5s)');
    
    // Run first check after a short delay
    setTimeout(() => this.checkAllCameraHealth(), 2000);
    
    this.healthCheckInterval = setInterval(() => {
      this.checkAllCameraHealth();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the health monitor
   */
  stopHealthMonitor() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[CameraManager] Health monitor stopped');
    }
  }

  /**
   * Check health of all cameras and recover stalled ones
   */
  checkAllCameraHealth() {
    if (!this.isPageVisible) return;
    
    const now = Date.now();
    
    this.cameras.forEach((cameraData, index) => {
      if (cameraData.isDestroyed) return;
      
      const camera = this.cameraConfigs[index];
      if (!camera?.url) return;
      
      const element = cameraData.element;
      if (!element) return;
      
      // Skip if there's already a retry scheduled or sequential init in progress
      if (cameraData.retryTimeout || this.isInitializing) return;
      
      const currentTime = element.currentTime;
      const lastTime = cameraData.lastPlaybackTime || 0;
      const lastCheck = cameraData.lastCheckTime || now;
      const timeSinceLastCheck = now - lastCheck;
      
      // Update tracking
      cameraData.lastCheckTime = now;
      
      // Check various failure conditions
      const hasProgressed = Math.abs(currentTime - lastTime) > 0.1;
      const isPlaying = !element.paused && !element.ended;
      const hasEnoughData = element.readyState >= 2;
      const hasHls = !!cameraData.hls;
      
      // Detect problems:
      // 1. Video is playing but currentTime not advancing (stalled playback)
      // 2. Video has no HLS instance (it died)
      // 3. Video is in error state
      // 4. readyState stuck at low value for too long
      
      let needsRecovery = false;
      let reason = '';
      
      // Check if HLS instance is gone (major failure)
      if (!hasHls && camera.url.endsWith('.m3u8')) {
        needsRecovery = true;
        reason = 'HLS instance missing';
      }
      // Check for video element error
      else if (element.error) {
        needsRecovery = true;
        reason = `Video error: ${element.error.code}`;
      }
      // Check for stalled playback (should be playing but isn't advancing)
      else if (isPlaying && hasEnoughData && !hasProgressed && timeSinceLastCheck >= this.HEALTH_CHECK_INTERVAL_MS - 500) {
        cameraData.stallCount = (cameraData.stallCount || 0) + 1;
        console.warn(`[CameraManager] Camera ${index + 1} stall detected (${cameraData.stallCount}/${this.MAX_STALL_COUNT}), currentTime: ${currentTime.toFixed(2)}, readyState: ${element.readyState}`);
        
        if (cameraData.stallCount >= this.MAX_STALL_COUNT) {
          needsRecovery = true;
          reason = 'Stalled playback';
        }
      }
      // Check for stuck in loading state (readyState low for too long)
      else if (!hasEnoughData && hasHls && timeSinceLastCheck >= this.HEALTH_CHECK_INTERVAL_MS - 500) {
        cameraData.stallCount = (cameraData.stallCount || 0) + 1;
        console.warn(`[CameraManager] Camera ${index + 1} loading stall (${cameraData.stallCount}/${this.MAX_STALL_COUNT}), readyState: ${element.readyState}`);
        
        if (cameraData.stallCount >= this.MAX_STALL_COUNT) {
          needsRecovery = true;
          reason = 'Stuck loading';
        }
      }
      // Check if paused unexpectedly (should be autoplaying but is paused)
      else if (!isPlaying && hasHls) {
        cameraData.stallCount = (cameraData.stallCount || 0) + 1;
        console.warn(`[CameraManager] Camera ${index + 1} is paused unexpectedly (${cameraData.stallCount}/${this.MAX_STALL_COUNT})`);
        
        if (cameraData.stallCount >= this.MAX_STALL_COUNT) {
          needsRecovery = true;
          reason = 'Unexpectedly paused';
        } else {
          // First try to just resume
          element.play().catch((err) => {
            console.warn(`[CameraManager] Camera ${index + 1} failed to resume: ${err.message}`);
          });
        }
      }
      else if (hasProgressed) {
        // Video is progressing normally - reset stall count
        cameraData.stallCount = 0;
      }
      
      if (needsRecovery) {
        console.log(`[CameraManager] Camera ${index + 1} needs recovery: ${reason}`);
        this.recoverCamera(index, camera);
      }
      
      cameraData.lastPlaybackTime = currentTime;
    });
  }

  /**
   * Recover a stalled camera by fully reinitializing the stream
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   */
  recoverCamera(index, camera) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;
    
    console.log(`[CameraManager] Recovering camera ${index + 1} - full reset`);
    
    // Reset stall tracking
    cameraData.stallCount = 0;
    cameraData.lastPlaybackTime = 0;
    cameraData.lastCheckTime = 0;
    cameraData.retryCount = 0;
    
    // Full cleanup of HLS
    this.cleanupHls(cameraData);
    
    // Reset video element completely
    const element = cameraData.element;
    if (element) {
      try {
        element.pause();
        element.removeAttribute('src');
        element.load(); // Reset the element
      } catch (e) { /* ignore */ }
    }
    
    // Small delay before reinitializing
    setTimeout(() => {
      if (!cameraData.isDestroyed && this.isPageVisible) {
        console.log(`[CameraManager] Reinitializing camera ${index + 1}`);
        this.initializeStream(index, camera);
      }
    }, 1000);
  }

  /**
   * Pause all camera streams when page is hidden
   */
  pauseAllStreams() {
    console.log('[CameraManager] Pausing all streams...');
    
    // Stop health monitoring while paused
    this.stopHealthMonitor();
    
    this.cameras.forEach((cameraData, index) => {
      if (cameraData.isDestroyed) return;
      
      // Clear any pending retries
      if (cameraData.retryTimeout) {
        clearTimeout(cameraData.retryTimeout);
        cameraData.retryTimeout = null;
      }
      
      // Stop HLS loading but don't destroy (saves memory while preserving state)
      if (cameraData.hls) {
        try {
          cameraData.hls.stopLoad();
        } catch (e) { /* ignore */ }
      }
      
      // Pause video element
      if (cameraData.element && !cameraData.element.paused) {
        try {
          cameraData.element.pause();
        } catch (e) { /* ignore */ }
      }
    });
  }

  /**
   * Resume all camera streams when page becomes visible
   */
  resumeAllStreams() {
    console.log('[CameraManager] Resuming all streams...');
    
    // Collect cameras that need to be resumed
    const camerasToResume = [];
    
    this.cameras.forEach((cameraData, index) => {
      if (cameraData.isDestroyed) return;
      
      const camera = this.cameraConfigs[index];
      if (!camera?.url) return;
      
      // Reset tracking
      cameraData.stallCount = 0;
      cameraData.lastPlaybackTime = 0;
      cameraData.lastCheckTime = 0;
      cameraData.retryCount = 0;
      
      // Full cleanup to get fresh feed
      this.cleanupHls(cameraData);
      if (cameraData.element) {
        try {
          cameraData.element.pause();
          cameraData.element.removeAttribute('src');
          cameraData.element.load();
        } catch (e) { /* ignore */ }
      }
      
      camerasToResume.push({ index, camera });
    });
    
    // HD mode: init all cameras immediately
    // Kiosk mode: sequential initialization
    if (this.isHDMode) {
      camerasToResume.forEach(({ index, camera }) => {
        console.log(`[CameraManager] Reinitializing camera ${index + 1} after visibility change`);
        this.initializeStream(index, camera);
      });
      // Start health monitor after a short delay
      setTimeout(() => {
        if (this.isPageVisible && !this.healthCheckInterval) {
          this.startHealthMonitor();
        }
      }, 1000);
    } else {
      // Sequential init for kiosk mode
      this.sequentialInit(camerasToResume);
    }
  }

  /**
   * Initialize the camera manager with grid element
   * @param {HTMLElement} gridElement - The camera grid container
   */
  init(gridElement) {
    this.gridElement = gridElement;
  }

  /**
   * Set HD mode (HD devices don't need staggered loading)
   * @param {boolean} isHD - Whether running in HD mode (dashboard=0)
   */
  setHDMode(isHD) {
    this.isHDMode = isHD;
    console.log(`[CameraManager] HD mode: ${isHD ? 'enabled (no staggering)' : 'disabled (staggered loading)'}`);
  }

  /**
   * Update camera configurations
   * @param {Array<{url: string, name: string}>} cameras - Camera configurations
   * @param {{columns: number, rows: number, numCameras: number}} gridConfig - Grid configuration
   */
  updateConfig(cameras, gridConfig) {
    this.cameraConfigs = cameras || [];
    this.config = {
      columns: gridConfig?.columns || 1,
      rows: gridConfig?.rows || 1,
      numCameras: clamp(gridConfig?.numCameras || 1, 1, 18),
    };
  }

  /**
   * Set up the camera grid with current configuration
   */
  setupGrid() {
    if (!this.gridElement) {
      console.error('Camera grid element not initialized');
      return;
    }

    // Clean up existing cameras before setting up new ones
    this.destroyAllCameras();

    const { columns, rows, numCameras } = this.config;

    // Update grid CSS
    this.gridElement.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    this.gridElement.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    // Create camera elements (without initializing streams yet)
    const totalCells = columns * rows;
    const camerasToInit = [];
    
    for (let i = 0; i < totalCells && i < numCameras; i++) {
      const camera = this.cameraConfigs[i];
      if (!camera) continue;

      this.createCameraElement(i, camera, false); // Don't init stream yet
      if (camera.url) {
        camerasToInit.push({ index: i, camera });
      }
    }
    
    // Stagger stream initialization on kiosk devices (non-HD mode)
    // HD devices are powerful enough to init all cameras at once
    if (this.isHDMode) {
      // HD mode: init all cameras immediately
      camerasToInit.forEach(({ index, camera }) => {
        this.initializeStream(index, camera);
      });
      // Start health monitor immediately
      if (this.isPageVisible) {
        this.startHealthMonitor();
      }
    } else {
      // Kiosk mode: sequential initialization - wait for each camera to play
      this.sequentialInit(camerasToInit);
    }
  }

  /**
   * Initialize camera streams sequentially (for kiosk mode)
   * Waits for each camera to start playing before initializing the next
   * @param {Array<{index: number, camera: Object}>} cameras - Cameras to initialize
   */
  sequentialInit(cameras) {
    if (cameras.length === 0) {
      console.log('[CameraManager] Sequential init complete');
      this.isInitializing = false;
      if (this.isPageVisible && !this.healthCheckInterval) {
        this.startHealthMonitor();
      }
      return;
    }
    
    this.isInitializing = true;
    this.initQueue = [...cameras];
    this.initNextCamera();
  }

  /**
   * Initialize the next camera in the queue
   */
  initNextCamera() {
    if (this.initQueue.length === 0) {
      console.log('[CameraManager] All cameras initialized');
      this.isInitializing = false;
      if (this.isPageVisible && !this.healthCheckInterval) {
        this.startHealthMonitor();
      }
      return;
    }
    
    const { index, camera } = this.initQueue.shift();
    const cameraData = this.cameras.get(index);
    
    if (!cameraData || cameraData.isDestroyed || !this.isPageVisible) {
      // Skip this camera and move to next
      this.initNextCamera();
      return;
    }
    
    console.log(`[CameraManager] Sequential init: Camera ${index + 1} (${this.initQueue.length} remaining)`);
    
    const element = cameraData.element;
    let resolved = false;
    let timeoutId = null;
    
    // Handler for when camera starts playing
    const onPlaying = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      element.removeEventListener('playing', onPlaying);
      console.log(`[CameraManager] Camera ${index + 1} started playing, initializing next...`);
      // Small delay to let it stabilize before starting next
      setTimeout(() => this.initNextCamera(), 500);
    };
    
    // Handler for timeout - move to next camera even if this one didn't start
    const onTimeout = () => {
      if (resolved) return;
      resolved = true;
      element.removeEventListener('playing', onPlaying);
      console.log(`[CameraManager] Camera ${index + 1} timeout, moving to next...`);
      this.initNextCamera();
    };
    
    // Listen for playing event
    element.addEventListener('playing', onPlaying);
    
    // Set timeout in case camera doesn't start
    timeoutId = setTimeout(onTimeout, this.SEQUENTIAL_TIMEOUT_MS);
    
    // Store timeout for cleanup
    cameraData.initTimeout = timeoutId;
    
    // Initialize this camera
    this.initializeStream(index, camera);
  }

  /**
   * Create a single camera element
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   * @param {boolean} [initStream=true] - Whether to initialize stream immediately
   */
  createCameraElement(index, camera, initStream = true) {
    const element = document.createElement('video');
    element.classList.add('camera-feed');
    element.dataset.cameraIndex = String(index);
    element.setAttribute(
      'data-placeholder',
      `${camera.name || `Camera ${index + 1}`}\n${camera.url ? 'Loading...' : 'No feed configured'}`
    );

    /** @type {CameraData} */
    const cameraData = {
      hls: null,
      element,
      retryTimeout: null,
      retryCount: 0,
      isDestroyed: false,
      eventCleanups: [],
      lastPlaybackTime: 0,
      lastCheckTime: 0,
      stallCount: 0,
    };
    
    this.cameras.set(index, cameraData);

    // Add video element event listeners for error recovery
    const onStalled = () => {
      if (cameraData.isDestroyed) return;
      console.warn(`[CameraManager] Camera ${index + 1} video stalled event`);
      cameraData.stallCount++;
    };
    
    const onError = () => {
      if (cameraData.isDestroyed) return;
      console.error(`[CameraManager] Camera ${index + 1} video error event`);
      const cam = this.cameraConfigs[index];
      if (cam?.url) {
        this.scheduleRetry(index, cam);
      }
    };
    
    const onWaiting = () => {
      if (cameraData.isDestroyed) return;
      // Reset stall count when video starts waiting (buffering)
      // It will be incremented by health check if it doesn't recover
    };
    
    const onPlaying = () => {
      if (cameraData.isDestroyed) return;
      // Reset stall tracking when playback resumes
      cameraData.stallCount = 0;
      cameraData.lastPlaybackTime = element.currentTime;
      cameraData.lastCheckTime = Date.now();
    };
    
    element.addEventListener('stalled', onStalled);
    element.addEventListener('error', onError);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('playing', onPlaying);
    
    // Store cleanup for video element listeners
    cameraData.videoEventCleanups = [
      () => element.removeEventListener('stalled', onStalled),
      () => element.removeEventListener('error', onError),
      () => element.removeEventListener('waiting', onWaiting),
      () => element.removeEventListener('playing', onPlaying),
    ];

    if (camera.url && initStream) {
      element.setAttribute('autoplay', '');
      element.setAttribute('muted', '');
      element.setAttribute('playsinline', '');
      element.setAttribute('preload', 'metadata');

      this.initializeStream(index, camera);
    } else if (camera.url) {
      // Just set attributes, stream will be initialized later (staggered)
      element.setAttribute('autoplay', '');
      element.setAttribute('muted', '');
      element.setAttribute('playsinline', '');
      element.setAttribute('preload', 'none');
    }

    this.gridElement.appendChild(element);
  }

  /**
   * Initialize video stream for a camera
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   */
  initializeStream(index, camera) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;

    // Don't initialize if page is not visible
    if (!this.isPageVisible) {
      return;
    }

    const { element } = cameraData;

    // Handle RTSP streams directly (browser support varies)
    if (camera.url.startsWith('rtsp://')) {
      element.src = camera.url;
      element.play().catch((err) => {
        console.warn(`Camera ${index + 1} RTSP playback failed:`, err);
      });
      return;
    }

    // Handle HLS streams
    if (camera.url.endsWith('.m3u8')) {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        this.initHlsStream(index, camera);
      } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = camera.url;
        element.play().catch((err) => {
          console.warn(`Camera ${index + 1} native HLS playback failed:`, err);
          this.scheduleRetry(index, camera);
        });
      } else {
        console.warn('HLS not supported in this browser');
        this.setPlaceholder(index, 'HLS not supported');
      }
      return;
    }

    // Default: try direct source
    element.src = camera.url;
    element.play().catch((err) => {
      console.warn(`Camera ${index + 1} playback failed:`, err);
      this.scheduleRetry(index, camera);
    });
  }

  /**
   * Initialize HLS.js stream with proper event handling
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   */
  initHlsStream(index, camera) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;

    // Clean up existing HLS instance
    this.cleanupHls(cameraData);

    const { element } = cameraData;
    const hls = new Hls(this.hlsConfig);
    cameraData.hls = hls;

    // Event handlers with destruction check
    const onMediaAttached = () => {
      if (cameraData.isDestroyed) return;
      element.play()
        .then(() => {
          cameraData.retryCount = 0;
          this.setPlaceholder(index, '');
        })
        .catch((err) => {
          if (!cameraData.isDestroyed) {
            console.warn(`Camera ${index + 1} autoplay failed:`, err);
          }
        });
    };

    const onManifestParsed = (event, data) => {
      if (cameraData.isDestroyed) return;
      console.log(`Camera ${index + 1} manifest parsed, ${data.levels.length} quality levels`);
      
      // Jump to live edge after manifest is parsed
      if (hls.liveSyncPosition) {
        element.currentTime = hls.liveSyncPosition;
      }
    };

    const onError = (event, data) => {
      if (cameraData.isDestroyed) return;
      this.handleHlsError(index, camera, data);
    };

    const onFragBuffered = () => {
      if (!cameraData.isDestroyed && cameraData.retryCount > 0) {
        cameraData.retryCount = 0;
      }
    };
    
    // Handle level loaded to jump to live edge
    const onLevelLoaded = (event, data) => {
      if (cameraData.isDestroyed) return;
      
      // Jump to live edge when level is loaded
      if (data.details.live && hls.liveSyncPosition) {
        const currentTime = element.currentTime;
        const liveEdge = hls.liveSyncPosition;
        
        // If we're more than 5 seconds behind live edge, jump forward
        if (liveEdge - currentTime > 5) {
          console.log(`[CameraManager] Camera ${index + 1} jumping to live edge (was ${(liveEdge - currentTime).toFixed(1)}s behind)`);
          element.currentTime = liveEdge;
        }
      }
    };

    // Attach event listeners
    hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
    hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    hls.on(Hls.Events.ERROR, onError);
    hls.on(Hls.Events.FRAG_BUFFERED, onFragBuffered);
    hls.on(Hls.Events.LEVEL_LOADED, onLevelLoaded);

    // Store cleanup functions
    cameraData.eventCleanups = [
      () => hls.off(Hls.Events.MEDIA_ATTACHED, onMediaAttached),
      () => hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed),
      () => hls.off(Hls.Events.ERROR, onError),
      () => hls.off(Hls.Events.FRAG_BUFFERED, onFragBuffered),
      () => hls.off(Hls.Events.LEVEL_LOADED, onLevelLoaded),
    ];

    try {
      // Add cache-busting parameter to URL to prevent stale manifest
      const cacheBustUrl = this.addCacheBuster(camera.url);
      hls.loadSource(cacheBustUrl);
      hls.attachMedia(element);
    } catch (error) {
      console.error(`Error initializing camera ${index + 1}:`, error);
      this.setPlaceholder(index, 'Error initializing feed');
      this.scheduleRetry(index, camera);
    }
  }

  /**
   * Add cache-busting parameter to URL
   * @param {string} url - Original URL
   * @returns {string} URL with cache buster
   */
  addCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_cb=${Date.now()}`;
  }

  /**
   * Clean up HLS instance and event listeners
   * @param {CameraData} cameraData - Camera data object
   */
  cleanupHls(cameraData) {
    if (cameraData.eventCleanups) {
      cameraData.eventCleanups.forEach(cleanup => {
        try { cleanup(); } catch (e) { /* ignore */ }
      });
      cameraData.eventCleanups = [];
    }

    if (cameraData.hls) {
      try {
        cameraData.hls.stopLoad();
        cameraData.hls.detachMedia();
        cameraData.hls.destroy();
      } catch (e) {
        console.warn('Error during HLS cleanup:', e);
      }
      cameraData.hls = null;
    }
  }

  /**
   * Handle HLS.js errors with smart recovery
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   * @param {Object} data - Error data from HLS.js
   */
  handleHlsError(index, camera, data) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;

    const { hls } = cameraData;

    if (data.fatal) {
      console.error(`Camera ${index + 1} fatal error:`, data.type, data.details);

      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          if (hls && cameraData.retryCount < 3) {
            hls.startLoad();
            cameraData.retryCount++;
          } else {
            this.cleanupHls(cameraData);
            this.setPlaceholder(index, 'Network error');
            this.scheduleRetry(index, camera);
          }
          break;

        case Hls.ErrorTypes.MEDIA_ERROR:
          if (hls) {
            try {
              hls.recoverMediaError();
            } catch (e) {
              this.cleanupHls(cameraData);
              this.setPlaceholder(index, 'Media error');
              this.scheduleRetry(index, camera);
            }
          }
          break;

        default:
          this.cleanupHls(cameraData);
          this.setPlaceholder(index, 'Stream error');
          this.scheduleRetry(index, camera);
          break;
      }
    }
  }

  /**
   * Schedule a retry for a failed camera with exponential backoff
   * @param {number} index - Camera index
   * @param {{url: string, name: string}} camera - Camera configuration
   */
  scheduleRetry(index, camera) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;

    // Clear any existing retry timeout
    if (cameraData.retryTimeout) {
      clearTimeout(cameraData.retryTimeout);
      cameraData.retryTimeout = null;
    }

    // Check if we've exceeded max retries
    if (cameraData.retryCount >= this.maxRetryAttempts) {
      console.log(`Camera ${index + 1} max retries reached, will retry in 5 minutes`);
      cameraData.retryCount = 0;
      cameraData.retryTimeout = setTimeout(() => {
        if (!cameraData.isDestroyed && camera.url && this.isPageVisible) {
          this.initializeStream(index, camera);
        }
      }, 300000);
      return;
    }

    // Calculate retry delay with exponential backoff and jitter
    const baseDelay = this.baseRetryDelay * Math.pow(1.5, cameraData.retryCount);
    const jitter = Math.random() * 1000;
    const retryDelay = Math.min(baseDelay + jitter, this.maxRetryDelay);

    cameraData.retryCount++;

    console.log(`Camera ${index + 1} retry ${cameraData.retryCount}/${this.maxRetryAttempts} in ${(retryDelay / 1000).toFixed(1)}s`);

    cameraData.retryTimeout = setTimeout(() => {
      cameraData.retryTimeout = null;
      if (!cameraData.isDestroyed && camera.url && this.isPageVisible) {
        this.initializeStream(index, camera);
      }
    }, retryDelay);
  }

  /**
   * Set placeholder text for a camera
   * @param {number} index - Camera index
   * @param {string} message - Placeholder message
   */
  setPlaceholder(index, message) {
    const cameraData = this.cameras.get(index);
    if (!cameraData || cameraData.isDestroyed) return;

    const camera = this.cameraConfigs[index];
    const name = camera?.name || `Camera ${index + 1}`;
    const placeholder = message ? `${name}\n${message}` : name;
    cameraData.element.setAttribute('data-placeholder', placeholder);
  }

  /**
   * Apply settings for a specific camera
   * @param {number} index - Camera index
   */
  applySettings(index) {
    const camera = this.cameraConfigs[index];
    if (!camera) return;

    this.destroyCamera(index);
    
    const cameraData = this.cameras.get(index);
    if (cameraData?.element && this.gridElement.contains(cameraData.element)) {
      cameraData.isDestroyed = false;
      cameraData.retryCount = 0;
      if (camera.url) {
        this.initializeStream(index, camera);
      }
    } else {
      this.setupGrid();
    }
  }

  /**
   * Destroy a single camera's resources
   * @param {number} index - Camera index
   */
  destroyCamera(index) {
    const cameraData = this.cameras.get(index);
    if (!cameraData) return;

    cameraData.isDestroyed = true;

    if (cameraData.retryTimeout) {
      clearTimeout(cameraData.retryTimeout);
      cameraData.retryTimeout = null;
    }
    
    if (cameraData.initTimeout) {
      clearTimeout(cameraData.initTimeout);
      cameraData.initTimeout = null;
    }

    this.cleanupHls(cameraData);
    
    // Clean up video element event listeners
    if (cameraData.videoEventCleanups) {
      cameraData.videoEventCleanups.forEach(cleanup => {
        try { cleanup(); } catch (e) { /* ignore */ }
      });
      cameraData.videoEventCleanups = [];
    }

    if (cameraData.element) {
      try {
        cameraData.element.pause();
        cameraData.element.src = '';
        cameraData.element.removeAttribute('src');
        cameraData.element.load();
      } catch (e) {
        console.warn(`Error cleaning video element for camera ${index + 1}:`, e);
      }
    }

    cameraData.retryCount = 0;
    cameraData.stallCount = 0;
    cameraData.lastPlaybackTime = 0;
    cameraData.lastCheckTime = 0;
  }

  /**
   * Destroy all cameras and clean up resources
   */
  destroyAllCameras() {
    // Clear init queue
    this.initQueue = [];
    this.isInitializing = false;
    
    this.cameras.forEach((_, index) => {
      this.destroyCamera(index);
    });

    if (this.gridElement) {
      this.gridElement.innerHTML = '';
    }

    this.cameras.clear();
  }

  /**
   * Full cleanup including visibility handler and health monitor
   */
  destroy() {
    this.stopHealthMonitor();
    this.destroyAllCameras();
    
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    
    console.log('[CameraManager] Destroyed');
  }

  /**
   * Generate settings HTML for cameras
   * @returns {string} HTML string for camera settings
   */
  generateSettingsHTML() {
    return this.cameraConfigs
      .slice(0, this.config.numCameras)
      .map((camera, index) => `
        <div class="setting-item">
          <h4>Camera ${index + 1}</h4>
          <label>Stream URL:</label>
          <input type="text" class="camera-url" data-index="${index}"
            value="${this.escapeHtml(camera.url || '')}" placeholder="http://example.com/stream.m3u8">
          <label>Camera Name:</label>
          <input type="text" class="camera-name" data-index="${index}"
            value="${this.escapeHtml(camera.name || `Camera ${index + 1}`)}" placeholder="Camera Name">
          <button class="apply-button camera-apply-btn" data-index="${index}">Apply</button>
        </div>
      `)
      .join('');
  }

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Update grid layout based on number of cameras
   * @param {number} numCameras - Number of cameras
   */
  updateGridLayout(numCameras) {
    numCameras = clamp(numCameras, 1, 18);
    const { columns, rows } = calculateGridLayout(numCameras);

    while (this.cameraConfigs.length < numCameras) {
      this.cameraConfigs.push({
        url: '',
        name: `Camera ${this.cameraConfigs.length + 1}`,
      });
    }

    this.config = { columns, rows, numCameras };
  }

  /**
   * Get camera health status for debugging
   * @returns {Object} Health status object
   */
  getHealthStatus() {
    const cameras = [];
    this.cameras.forEach((cameraData, index) => {
      const camera = this.cameraConfigs[index];
      const element = cameraData.element;
      cameras.push({
        index,
        name: camera?.name || `Camera ${index + 1}`,
        hasUrl: !!camera?.url,
        isPlaying: element && !element.paused,
        isPaused: element?.paused,
        currentTime: element?.currentTime?.toFixed(2),
        readyState: element?.readyState,
        videoError: element?.error?.code || null,
        hasHls: !!cameraData.hls,
        hlsUrl: cameraData.hls?.url || null,
        retryCount: cameraData.retryCount,
        stallCount: cameraData.stallCount,
        lastPlaybackTime: cameraData.lastPlaybackTime?.toFixed(2),
        isDestroyed: cameraData.isDestroyed,
        hasPendingRetry: !!cameraData.retryTimeout,
      });
    });
    return {
      isPageVisible: this.isPageVisible,
      isHDMode: this.isHDMode,
      healthMonitorActive: !!this.healthCheckInterval,
      isInitializing: this.isInitializing,
      initQueueLength: this.initQueue?.length || 0,
      cameras,
    };
  }

  /**
   * Force recovery of a specific camera (for debugging)
   * @param {number} index - Camera index (0-based)
   */
  forceRecover(index) {
    const camera = this.cameraConfigs[index];
    if (camera) {
      console.log(`[CameraManager] Force recovering camera ${index + 1}`);
      this.recoverCamera(index, camera);
    } else {
      console.error(`[CameraManager] Camera ${index + 1} not found`);
    }
  }

  /**
   * Force recovery of all cameras (for debugging)
   */
  forceRecoverAll() {
    console.log('[CameraManager] Force recovering all cameras');
    this.cameras.forEach((cameraData, index) => {
      const camera = this.cameraConfigs[index];
      if (camera?.url && !cameraData.isDestroyed) {
        this.recoverCamera(index, camera);
      }
    });
  }
}

// Export singleton instance
export const cameraManager = new CameraManager();
