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
      companyId,
      clientId,
      role = 'driver', // Default to 'driver' since we use 'driver_location' action
      sendIntervalMs = 5000,
      locationProvider = null,
      autoReconnect = true,
      maxReconnectDelayMs = 15000,
    } = options;

    this.url = url;
    this.companyId = companyId;
    this.clientId = clientId;
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

      this._ws.addEventListener('message', (event) => this._handleMessage(event));

      this._ws.addEventListener('close', () => {
        const wasReady = this._ready;
        this._ready = false;
        this._authenticated = false;
        this.emit('close');
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
        this.emit('error', err);
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

  setClientId(clientId) {
    this.clientId = clientId;
    if (this._ready) {
      this._authenticate();
    }
  }

  setCompanyId(companyId) {
    this.companyId = companyId;
    if (this._ready) {
      this._authenticate();
    }
  }

  setSendInterval(ms) {
    this.sendIntervalMs = ms;
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = setInterval(() => this._flushLatestLocation(), this.sendIntervalMs);
    }
  }

  _authenticate() {
    if (!this._ready || !this.companyId || !this.clientId) {
      return;
    }
    const authMessage = {
      action: 'authenticate',
      payload: {
        company_id: this.companyId,
        user_id: this.clientId,
        role: this.role || 'client',
      },
    };
    this._send(authMessage);
  }

  _handleMessage(event) {
    let parsed = null;
    try {
      parsed = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    const { action, type, payload } = parsed;

    // Handle authentication success - server can send either action or type
    if (action === 'authenticated' || action === 'auth_success' || type === 'auth_ok') {
      this._authenticated = true;
      this._reconnectAttempts = 0;
      this.emit('authenticated', payload || {});
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
    if (type === 'error') {
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

    // Use 'driver_location' action as per the API spec (even though role is 'client')
    const message = {
      action: 'driver_location',
      id: this.clientId,
      payload: {
        lat: this._lastLocation.lat,
        lng: this._lastLocation.lng,
        speed: this._lastLocation.speed,
        bearing: this._lastLocation.bearing,
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
      console.error('[TrackingClient] Failed to send message', err);
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
}

export default TrackingClient;

