class SimpleEmitter {
  constructor() {
    this._events = {};
  }

  on(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter((h) => h !== handler);
  }

  emit(event, payload) {
    if (!this._events[event]) return;
    this._events[event].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`TrackingClient listener error for event "${event}":`, err);
      }
    });
  }
}

/**
 * Browser-based location provider using navigator.geolocation.watchPosition.
 * Can be replaced with any custom provider implementing start(onLocation) -> stop().
 */
export class BrowserLocationProvider {
  constructor(options = {}) {
    this.options = options;
    this.watchId = null;
    this.lastLocation = null;
  }

  start(onLocation) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Browser geolocation is not available; please provide a custom locationProvider.');
    }

    const {
      enableHighAccuracy = true,
      maximumAgeMs = 0,
      timeoutMs = 10000,
    } = this.options;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed ?? null,
          bearing: pos.coords.heading ?? null,
          timestamp: pos.timestamp,
        };
        this.lastLocation = loc;
        onLocation(loc);
      },
      (err) => {
        // Error handled by callback
      },
      {
        enableHighAccuracy,
        maximumAge: maximumAgeMs,
        timeout: timeoutMs,
      }
    );

    return () => this.stop();
  }

  stop() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

// Tracking interval constant
const TRACKING_INTERVAL_MS = 15000; // 15 seconds

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * TrackingClient automatically authenticates, streams location updates on an interval,
 * and emits incoming location messages from the tracking server.
 */
class TrackingClient extends SimpleEmitter {
  constructor(options = {}) {
    super();
    const {
      url = 'wss://track.gebeta.app/v1/track',
      bearerToken,
      userId,
      role = 'driver',
      sendIntervalMs = TRACKING_INTERVAL_MS,
      locationProvider = null,
      autoReconnect = true,
      maxReconnectDelayMs = 15000,
    } = options;

    // Authentication happens via message payload after connection opens
    // Server should accept connection without token in query params
    this.url = url;
    this.bearerToken = bearerToken;
    this.userId = userId;
    this.role = role || 'driver';
    this.sendIntervalMs = sendIntervalMs;
    this.autoReconnect = autoReconnect;
    this.maxReconnectDelayMs = maxReconnectDelayMs;

    this._ws = null;
    this._ready = false;
    this._authenticated = false;
    this._reconnectAttempts = 0;
    this._sendTimer = null;
    this._locationProvider = locationProvider || new BrowserLocationProvider();
    this._stopLocationProvider = null;
    this._lastLocation = null;
    this._precision = null; // 'low' or 'high' from authentication response
  }

  async start() {
    await this.connect();
  }

  async connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(this.url);
      } catch (err) {
        console.error('[TrackingClient] Failed to create WebSocket:', err);
        reject(err);
        return;
      }

      this._ws.addEventListener('open', () => {
        this._ready = true;
        this._authenticated = false;
        this.emit('open');
        this._authenticate();
        resolve();
      });

      this._ws.addEventListener('message', (event) => {
        this._handleMessage(event);
      });

      this._ws.addEventListener('close', (event) => {
        const closeInfo = {
          code: event.code,
          reason: event.reason || '(no reason provided)',
          wasClean: event.wasClean,
          codeMeaning: this._getCloseCodeMeaning(event.code)
        };
        
        const wasReady = this._ready;
        this._ready = false;
        this._authenticated = false;
        this.emit('close', closeInfo);
        this._cleanupTimers();
        if (this._stopLocationProvider) {
          this._stopLocationProvider();
          this._stopLocationProvider = null;
        }
        if (this.autoReconnect && wasReady) {
          this._scheduleReconnect();
        }
      });

      this._ws.addEventListener('error', (err) => {
        const errorDetails = {
          type: err.type,
          target: err.target?.url,
          readyState: this._ws?.readyState,
          readyStateText: this._getReadyStateText(this._ws?.readyState),
          url: this.url,
          timestamp: new Date().toISOString()
        };
        
        if (this._ws?.readyState === WebSocket.CLOSED) {
          const errorMsg = `WebSocket connection failed. URL: ${this.url}`;
          reject(new Error(errorMsg));
        }
        
        this.emit('error', { ...err, details: errorDetails });
      });
    });
  }

  disconnect() {
    this.autoReconnect = false;
    this._cleanupTimers();
    if (this._stopLocationProvider) {
      this._stopLocationProvider();
      this._stopLocationProvider = null;
    }
    if (this._ws) {
      try {
        this._ws.close();
      } catch (_) {}
    }
  }

  setUserId(userId) {
    this.userId = userId;
    if (this._ready) {
      this._authenticate();
    }
  }

  setBearerToken(bearerToken) {
    this.bearerToken = bearerToken;
    // Reconnect with new token
    if (this._ws) {
      this.disconnect();
      this.connect();
    }
  }

  getPrecision() {
    return this._precision;
  }

  setSendInterval(ms) {
    this.sendIntervalMs = ms;
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = setInterval(() => this._flushLatestLocation(), this.sendIntervalMs);
    }
  }

  _authenticate() {
    if (!this._ready || !this.userId || !this.bearerToken) {
      return;
    }
    
    const authMessage = {
      action: 'authenticate',
      payload: {
        user_id: this.userId,
        role: this.role || 'driver',
        token: this.bearerToken,
      },
    };
    this._send(authMessage);
  }

  _handleMessage(event) {
    let parsed = null;
    try {
      parsed = JSON.parse(event.data);
    } catch (err) {
      console.warn('[TrackingClient] Failed to parse message:', event.data, err);
      return;
    }

    const { action, type, payload } = parsed;

    // Handle authentication success - server can send either action or type
    if (action === 'authenticated' || action === 'auth_success' || type === 'auth_ok') {
      this._authenticated = true;
      this._reconnectAttempts = 0;
      const authPayload = payload || {};
      this.emit('authenticated', authPayload);
      this._startLocationStreaming();
      return;
    }

    if (action === 'ping') {
      this._send({ action: 'pong' });
      return;
    }

    if (action === 'location' || action === 'client_location' || action === 'driver_location') {
      this.emit('location', payload || parsed);
      return;
    }

    // Handle error messages
    if (type === 'error' || action === 'error') {
      console.error('[TrackingClient] Server error:', payload || parsed);
      this.emit('error', { type: 'server_error', payload: payload || parsed });
      return;
    }
    
    this.emit('message', parsed);
  }

  _startLocationStreaming() {
    if (!this._authenticated) return;
    if (!this._locationProvider) {
      return;
    }

    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }

    if (!this._stopLocationProvider) {
      try {
        const maybeStop = this._locationProvider.start((location) => {
          this._lastLocation = this._decorateLocation(location);
          this.emit('local_location', this._lastLocation);
        });
        if (typeof maybeStop === 'function') {
          this._stopLocationProvider = maybeStop;
        } else if (this._locationProvider.stop) {
          this._stopLocationProvider = () => this._locationProvider.stop();
        }
      } catch (err) {
        console.error('[TrackingClient] Failed to start location provider', err);
        this.emit('error', err);
        return;
      }
    }

    // Start the timer after a small delay to ensure location provider callback has been called
    // The location provider's start() method should immediately call the callback with lastKnownLocation
    // Use setTimeout to ensure location callback has been processed first
    setTimeout(() => {
      this._sendTimer = setInterval(() => this._flushLatestLocation(), this.sendIntervalMs);
      // Also try to send immediately if we have a location
      if (this._lastLocation) {
        this._flushLatestLocation();
      }
    }, 100);
  }

  _decorateLocation(location) {
    return {
      lat: location.lat,
      lng: location.lng,
      speed: location.speed ?? null,
      bearing: location.bearing ?? null,
      timestamp: location.timestamp ?? Date.now(),
    };
  }

  _flushLatestLocation() {
    if (!this._ready || !this._authenticated || !this._lastLocation) {
      return;
    }

    // Ensure timestamp is always a valid number
    const timestamp = this._lastLocation.timestamp || Date.now();

    const message = {
      action: 'driver_location',
      id: this.userId,
      payload: {
        lat: this._lastLocation.lat,
        lng: this._lastLocation.lng,
        timestamp: timestamp,
      },
    };

    this._send(message);
    this.emit('sent', { location: this._lastLocation });
  }

  _send(message) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      const messageStr = JSON.stringify(message);
      this._ws.send(messageStr);
    } catch (err) {
      console.error('[TrackingClient] Failed to send message:', err, message);
    }
  }

  _scheduleReconnect() {
    if (!this.autoReconnect) return;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), this.maxReconnectDelayMs);
    this._reconnectAttempts++;
    this.emit('reconnecting', { delay });
    wait(delay).then(() => this.connect());
  }

  _cleanupTimers() {
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }
  }

  _getReadyStateText(state) {
    const states = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED'
    };
    return states[state] || `UNKNOWN(${state})`;
  }

  _getCloseCodeMeaning(code) {
    const meanings = {
      1000: 'Normal closure',
      1001: 'Going away',
      1002: 'Protocol error',
      1003: 'Unsupported data',
      1004: 'Reserved',
      1005: 'No status code',
      1006: 'Abnormal closure (connection closed without proper handshake)',
      1007: 'Invalid frame payload data',
      1008: 'Policy violation',
      1009: 'Message too big',
      1010: 'Mandatory extension',
      1011: 'Internal server error',
      1012: 'Service restart',
      1013: 'Try again later',
      1014: 'Bad gateway',
      1015: 'TLS handshake failure'
    };
    return meanings[code] || `Unknown code (${code})`;
  }
}

/**
 * HttpTrackingClient uses HTTP POST requests for low-precision tracking.
 * Sends location updates every 15 seconds to the tracking API.
 */
class HttpTrackingClient extends SimpleEmitter {
  constructor(options = {}) {
    super();
    const {
      url = 'https://track.gebeta.app/v1/driver/location',
      bearerToken,
      userId,
      role = 'driver',
      sendIntervalMs = TRACKING_INTERVAL_MS,
      locationProvider = null,
    } = options;

    this.url = url;
    this.bearerToken = bearerToken;
    this.userId = userId;
    this.role = role || 'driver';
    this.sendIntervalMs = sendIntervalMs;
    this._locationProvider = locationProvider || new BrowserLocationProvider();
    this._stopLocationProvider = null;
    this._sendTimer = null;
    this._lastLocation = null;
    this._authenticated = false;
    this._precision = 'low'; // HTTP tracking is always low precision
  }

  async start() {
    // For HTTP tracking, we don't need to authenticate separately
    // Authentication happens via Bearer token in headers
    this._authenticated = true;
    this.emit('authenticated', { precision: 'low' });
    this._startLocationStreaming();
  }

  disconnect() {
    this._cleanupTimers();
    if (this._stopLocationProvider) {
      this._stopLocationProvider();
      this._stopLocationProvider = null;
    }
    this._authenticated = false;
    this.emit('close', {});
  }

  setUserId(userId) {
    this.userId = userId;
  }

  setBearerToken(bearerToken) {
    this.bearerToken = bearerToken;
  }

  setSendInterval(ms) {
    this.sendIntervalMs = ms;
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = setInterval(() => this._flushLatestLocation(), this.sendIntervalMs);
    }
  }

  getPrecision() {
    return this._precision;
  }

  _startLocationStreaming() {
    if (!this._authenticated) return;
    if (!this._locationProvider) {
      return;
    }

    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }

    if (!this._stopLocationProvider) {
      try {
        const maybeStop = this._locationProvider.start((location) => {
          this._lastLocation = this._decorateLocation(location);
          this.emit('local_location', this._lastLocation);
        });
        if (typeof maybeStop === 'function') {
          this._stopLocationProvider = maybeStop;
        } else if (this._locationProvider.stop) {
          this._stopLocationProvider = () => this._locationProvider.stop();
        }
      } catch (err) {
        console.error('[HttpTrackingClient] Failed to start location provider', err);
        this.emit('error', err);
        return;
      }
    }

    // Start the timer after a small delay to ensure location provider callback has been called
    setTimeout(() => {
      this._sendTimer = setInterval(() => this._flushLatestLocation(), this.sendIntervalMs);
      // Also try to send immediately if we have a location
      if (this._lastLocation) {
        this._flushLatestLocation();
      }
    }, 100);
  }

  _decorateLocation(location) {
    return {
      lat: location.lat,
      lng: location.lng,
      speed: location.speed ?? null,
      bearing: location.bearing ?? null,
      timestamp: location.timestamp ?? Date.now(),
    };
  }

  async _flushLatestLocation() {
    if (!this._authenticated || !this._lastLocation || !this.bearerToken || !this.userId) {
      return;
    }

    // Validate required fields - ensure they are valid numbers
    const lat = typeof this._lastLocation.lat === 'number' ? this._lastLocation.lat : null;
    const lng = typeof this._lastLocation.lng === 'number' ? this._lastLocation.lng : null;
    const timestamp = typeof this._lastLocation.timestamp === 'number' 
      ? this._lastLocation.timestamp 
      : Date.now();

    // Ensure lat, lng, and timestamp are valid before sending
    if (lat == null || isNaN(lat) || lng == null || isNaN(lng) || timestamp == null || isNaN(timestamp)) {
      console.warn('[HttpTrackingClient] Skipping location update - missing or invalid required fields:', {
        lat,
        lng,
        timestamp,
        hasLocation: !!this._lastLocation,
        locationData: this._lastLocation
      });
      return;
    }

    try {
      // Convert timestamp to seconds (Unix timestamp) if it's in milliseconds
      const time_stamp = Math.floor(timestamp / 1000);

      // Format matches server expectation: action, id, payload with time_stamp
      const message = {
        action: 'driver_location',
        id: this.userId,
        payload: {
          lat: lat,
          lng: lng,
          time_stamp: time_stamp,
        }
      };

      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.bearerToken}`,
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[HttpTrackingClient] Failed to send location:', response.status, errorText);
        this.emit('error', { 
          type: 'http_error', 
          status: response.status, 
          message: errorText 
        });
        return;
      }

      this.emit('sent', { location: this._lastLocation });
    } catch (err) {
      console.error('[HttpTrackingClient] Failed to send location:', err);
      this.emit('error', { type: 'network_error', error: err });
    }
  }

  _cleanupTimers() {
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }
  }
}

export default TrackingClient;
export { HttpTrackingClient };

