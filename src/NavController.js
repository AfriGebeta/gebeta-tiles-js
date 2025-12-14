import maplibregl from 'maplibre-gl';
import { BrowserLocationProvider } from './TrackingClient.js';

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
      try { handler(payload); } catch (err) { console.error(err); }
    });
  }
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bearing(from, to) {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) *
      Math.cos(toRad(to.lat)) *
      Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function interpolate(a, b, t) {
  return {
    lng: a.lng + (b.lng - a.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t,
  };
}

function pointToLngLat(pt) {
  return { lng: pt[0], lat: pt[1] };
}

function lngLatToArr(ll) {
  return [ll.lng, ll.lat];
}

function nearestPointOnSegment(p, a, b) {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { t: 0, point: { lng: ax, lat: ay } };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, point: interpolate(a, b, t) };
}

function nearestOnLine(point, line) {
  let best = { distance: Infinity, point: line[0], index: 0, t: 0, along: 0 };
  let traveled = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = pointToLngLat(line[i]);
    const b = pointToLngLat(line[i + 1]);
    const proj = nearestPointOnSegment(point, a, b);
    const segLen = haversine(a, b);
    const projDist = haversine(point, proj.point);
    const along = traveled + segLen * proj.t;
    if (projDist < best.distance) {
      best = { distance: projDist, point: proj.point, index: i, t: proj.t, along };
    }
    traveled += segLen;
  }
  return best;
}

class NavController extends SimpleEmitter {
  constructor(map, directionsManager, options = {}) {
    super();
    this.map = map;
    this.directionsManager = directionsManager;
    this.options = {
      offRouteThresholdMeters: 40,
      arriveThresholdMeters: 25,
      autoReroute: false,
      rerouteFn: null,
      ...options,
    };

    this.route = null;
    this._totalDistance = 0;
    this._stepIndex = 0;
    this._lastEmittedStepIndex = null;
    this._stopProvider = null;
    this._trackingClient = null;
    this._useRemoteFeed = false;
    this._active = false;
    this._instructions = [];
    this._locationMarker = null;
    this._savedCameraState = null;
  }

  start(route, opts = {}) {
    if (!route) throw new Error('NavController.start requires a route');
    this.stop();
    this.route = route;
    this._instructions = Array.isArray(route.instructions) ? route.instructions : [];
    this._totalDistance = this._computeTotalDistance(route);
    this._stepIndex = 0;
    this._lastEmittedStepIndex = null;
    this._active = true;

    // Save current camera state
    this._savedCameraState = {
      center: this.map.getCenter(),
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    };

    // Create location marker
    this._createLocationMarker();

    this._trackingClient = opts.trackingClient || null;
    this._useRemoteFeed = !!opts.useRemoteFeed;
    const locationProvider =
      opts.locationProvider ||
      (this._useRemoteFeed
        ? null
        : new BrowserLocationProvider({ enableHighAccuracy: true }));

    if (this._useRemoteFeed && this._trackingClient) {
      const unsub = this._trackingClient.on('location', (loc) => {
        if (!loc) return;
        const fixed = {
          lat: loc.lat ?? loc.payload?.lat,
          lng: loc.lng ?? loc.payload?.lng,
          speed: loc.speed ?? loc.payload?.speed,
          bearing: loc.bearing ?? loc.payload?.bearing,
          timestamp: loc.timestamp ?? loc.payload?.timestamp,
        };
        this._handleLocation(fixed);
      });
      this._stopProvider = () => unsub();
    } else if (locationProvider) {
      const locationCallback = (loc) => {
        // Ensure route is ready before handling location
        if (this.route?.geometry?.coordinates && this._active) {
          this._handleLocation(loc);
        } else {
          // If route isn't ready yet, try again after a short delay
          setTimeout(() => {
            if (this.route?.geometry?.coordinates && this._active && loc) {
              this._handleLocation(loc);
            }
          }, 200);
        }
      };
      
      const maybeStop = locationProvider.start(locationCallback);
      if (typeof maybeStop === 'function') {
        this._stopProvider = maybeStop;
      } else if (locationProvider.stop) {
        this._stopProvider = () => locationProvider.stop();
      }
      
      // If location provider has a lastKnownLocation, manually trigger callback after route is ready
      // This ensures we get an initial location update even if the provider called the callback before route was ready
      if (locationProvider.lastKnownLocation) {
        setTimeout(() => {
          if (this.route?.geometry?.coordinates && this._active) {
            locationCallback(locationProvider.lastKnownLocation);
          }
        }, 300);
      }
    }

    // Emit the first instruction immediately when starting
    if (this._instructions.length > 0) {
      this._lastEmittedStepIndex = 0;
      this.emit('stepchange', { stepIndex: 0, step: this._instructions[0] });
    }
    
    this.emit('start', { route, totalDistance: this._totalDistance });
  }

  stop() {
    this._active = false;
    if (this._stopProvider) {
      this._stopProvider();
      this._stopProvider = null;
    }
    
    // Remove location marker
    if (this._locationMarker) {
      this._locationMarker.remove();
      this._locationMarker = null;
    }
    
    // Restore camera state
    if (this._savedCameraState) {
      this.map.easeTo({
        center: this._savedCameraState.center,
        zoom: this._savedCameraState.zoom,
        bearing: this._savedCameraState.bearing,
        pitch: this._savedCameraState.pitch,
        duration: 1000,
      });
      this._savedCameraState = null;
    }
    
    this.emit('stop');
  }

  _computeTotalDistance(route) {
    if (!route?.geometry?.coordinates) return 0;
    let dist = 0;
    const coords = route.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      dist += haversine(pointToLngLat(coords[i]), pointToLngLat(coords[i + 1]));
    }
    return dist;
  }

  _createLocationMarker() {
    if (!this.map) return;
    
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '20px';
    el.style.height = '20px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = '#0c7bdc';
    el.style.border = '3px solid #fff';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    el.style.zIndex = '1000';
    
    // Add arrow pointing in direction of travel
    const arrow = document.createElement('div');
    arrow.style.width = '0';
    arrow.style.height = '0';
    arrow.style.borderLeft = '4px solid transparent';
    arrow.style.borderRight = '4px solid transparent';
    arrow.style.borderBottom = '8px solid #0c7bdc';
    arrow.style.position = 'absolute';
    arrow.style.top = '-8px';
    arrow.style.left = '50%';
    arrow.style.transform = 'translateX(-50%)';
    el.appendChild(arrow);
    
    this._locationMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([0, 0])
      .addTo(this.map);
  }

  _updateLocationMarker(location, bearing) {
    if (!this._locationMarker || !location) return;
    
    this._locationMarker.setLngLat([location.lng, location.lat]);
    
    // Rotate marker based on bearing
    if (bearing !== null && bearing !== undefined) {
      const markerEl = this._locationMarker.getElement();
      if (markerEl) {
        markerEl.style.transform = `rotate(${bearing}deg)`;
      }
    }
  }

  _updateCamera(location, bearing) {
    if (!this.map || !location) return;
    
    const bearingValue = bearing !== null && bearing !== undefined ? bearing : 0;
    
    // Update camera to follow location with navigation view
    this.map.easeTo({
      center: [location.lng, location.lat],
      zoom: 18,
      bearing: bearingValue,
      pitch: 60, // Tilt the camera for 3D navigation view
      duration: 1000,
    });
  }

  _handleLocation(location) {
    if (!this._active || !location || !this.route?.geometry?.coordinates) return;
    const coords = this.route.geometry.coordinates;
    const snapped = nearestOnLine(location, coords);
    const remainingDistance = Math.max(this._totalDistance - snapped.along, 0);
    const nextStep = this._instructions[this._stepIndex] || null;
    let distToNext = null;
    
    if (nextStep) {
      // Get the coordinate for the next step
      let stepLat, stepLng;
      if (nextStep.coord && Array.isArray(nextStep.coord)) {
        // coord is [lng, lat] format (from Valhalla/MapLibre)
        stepLng = nextStep.coord[0];
        stepLat = nextStep.coord[1];
      } else if (nextStep.turning_latitude && nextStep.turning_longitude) {
        // Legacy format: separate lat/lng properties
        stepLat = nextStep.turning_latitude;
        stepLng = nextStep.turning_longitude;
      } else {
        // Fallback: use the snapped point on route
        distToNext = null;
      }
      
      if (stepLat && stepLng) {
        distToNext = haversine(
          { lat: location.lat, lng: location.lng },
          { lat: stepLat, lng: stepLng }
        );
      }
    }

    // Emit the current step if it hasn't been emitted yet
    const currentStep = this._instructions[this._stepIndex] || null;
    if (currentStep && this._lastEmittedStepIndex !== this._stepIndex) {
      this.emit('stepchange', { stepIndex: this._stepIndex, step: currentStep });
      this._lastEmittedStepIndex = this._stepIndex;
    }
    
    // Advance to next step only after we've passed the current step (within 20m)
    if (nextStep && distToNext !== null && distToNext < 20 && this._stepIndex < this._instructions.length - 1) {
      this._stepIndex += 1;
      // The stepchange will be emitted on the next location update
    }

    const offRoute = snapped.distance > this.options.offRouteThresholdMeters;
    if (offRoute) {
      this.emit('offroute', { location, snapped });
      if (this.options.autoReroute && typeof this.options.rerouteFn === 'function') {
        this.options.rerouteFn(location);
      }
    }

    if (remainingDistance < this.options.arriveThresholdMeters) {
      this.emit('arrive', { location });
    }

    // Update location marker and camera
    const bearing = location.bearing ?? null;
    this._updateLocationMarker(location, bearing);
    this._updateCamera(location, bearing);

    this.emit('progress', {
      location,
      snappedPoint: snapped.point,
      distanceFromRoute: snapped.distance,
      remainingDistance,
      remainingDuration: this._estimateDuration(remainingDistance),
      currentStep: this._instructions[this._stepIndex] || null,
      nextStep: this._instructions[this._stepIndex + 1] || null,
      totalDistance: this._totalDistance,
      bearing: bearing,
      speed: location.speed ?? null,
    });
  }

  _estimateDuration(distanceMeters, avgSpeedKmh = 30) {
    const hours = distanceMeters / 1000 / avgSpeedKmh;
    return Math.round(hours * 60); // minutes
  }
}

export default NavController;

