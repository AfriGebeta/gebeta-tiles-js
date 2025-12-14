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
    this._lastEmittedInstruction = null;
    this._stopProvider = null;
    this._turnPassedLocation = null; // Track location when we passed a turn
    this._turnPassedStepIndex = null; // Track which step we passed
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
    this._lastEmittedInstruction = null;
    this._active = true;
    this._turnPassedLocation = null;
    this._turnPassedStepIndex = null;

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
    // Show "Continue ahead" initially, or first instruction if it's not a turn
    const firstStep = this._instructions[0] || null;
    if (firstStep && !this._isTurnInstruction(firstStep)) {
      this.emit('stepchange', { stepIndex: 0, step: firstStep });
      this._lastEmittedInstruction = firstStep;
    } else {
      const continueStep = this._createContinueInstruction();
      this.emit('stepchange', { stepIndex: null, step: continueStep });
      this._lastEmittedInstruction = continueStep;
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
    
    // Reset turn tracking
    this._turnPassedLocation = null;
    this._turnPassedStepIndex = null;
    
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

  _isTurnInstruction(step) {
    if (!step) return false;
    // Check if this is a turn instruction based on maneuver type
    // Valhalla types: 8=Continue, 7=Becomes, 22=Stay straight are NOT turns
    // Types 9-16, 18-21, 26-27 are turns
    const type = step.type;
    if (type === undefined || type === null) {
      // If no type, check icon or instruction text
      const icon = step.icon || '';
      const instruction = (step.instruction || '').toLowerCase();
      // If icon suggests a turn (not straight arrow) or instruction mentions turn
      if (icon.includes('➡️') || icon.includes('⬅️') || icon.includes('↗️') || 
          icon.includes('↖️') || icon.includes('↪️') || icon.includes('🔄') ||
          instruction.includes('turn') || instruction.includes('left') || 
          instruction.includes('right') || instruction.includes('roundabout')) {
        return true;
      }
      return false;
    }
    // Turn types: 9-16 (slight/sharp/right/left turns), 18-21 (ramps/exits), 26-27 (roundabouts)
    // Non-turn types: 0-8 (none/start/destination/continue), 22 (stay straight)
    return (type >= 9 && type <= 16) || (type >= 18 && type <= 21) || type === 26 || type === 27;
  }

  _createContinueInstruction() {
    return {
      instruction: 'Continue ahead',
      icon: '⬆️',
      type: 8, // Continue type
      coord: null,
      time: null,
      length: null
    };
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

    // Determine what instruction to show
    let instructionToShow = null;
    const isTurn = this._isTurnInstruction(nextStep);
    const TURN_APPROACH_DISTANCE = 50; // Show turn instructions when within 50m
    const TURN_PASSED_BUFFER = 10; // Keep showing turn instruction for 10m after passing it

    // Check if we're still within the buffer period after passing a turn
    let withinTurnBuffer = false;
    if (this._turnPassedLocation && this._turnPassedStepIndex === this._stepIndex) {
      const distanceSinceTurn = haversine(
        { lat: this._turnPassedLocation.lat, lng: this._turnPassedLocation.lng },
        { lat: location.lat, lng: location.lng }
      );
      if (distanceSinceTurn <= TURN_PASSED_BUFFER) {
        withinTurnBuffer = true;
        // Show the turn instruction we just passed
        instructionToShow = this._instructions[this._stepIndex] || null;
      } else {
        // Buffer period expired, clear tracking
        this._turnPassedLocation = null;
        this._turnPassedStepIndex = null;
      }
    }

    if (!withinTurnBuffer) {
      if (nextStep && isTurn) {
        if (distToNext !== null) {
          // Show turn instruction when approaching (within 50m)
          if (distToNext <= TURN_APPROACH_DISTANCE) {
            instructionToShow = nextStep;
          } else {
            // Too far from turn, show "Continue ahead"
            instructionToShow = this._createContinueInstruction();
          }
        } else {
          // No distance available, show turn instruction if it exists
          instructionToShow = nextStep;
        }
      } else if (nextStep && !isTurn) {
        // If current step is not a turn, show it (e.g., "Continue", "Becomes")
        instructionToShow = nextStep;
      } else {
        // Otherwise show "Continue ahead"
        instructionToShow = this._createContinueInstruction();
      }
    }

    // Emit stepchange if instruction changed
    const currentInstructionKey = instructionToShow ? 
      (instructionToShow.instruction || '') + (instructionToShow.type || '') : 'none';
    const lastInstructionKey = this._lastEmittedInstruction ? 
      (this._lastEmittedInstruction.instruction || '') + (this._lastEmittedInstruction.type || '') : 'none';
    
    if (currentInstructionKey !== lastInstructionKey) {
      this.emit('stepchange', { 
        stepIndex: isTurn && nextStep ? this._stepIndex : null, 
        step: instructionToShow 
      });
      this._lastEmittedInstruction = instructionToShow;
    }
    
    // Advance to next step only after we've passed the current step (within 20m)
    if (nextStep && distToNext !== null && distToNext < 20 && this._stepIndex < this._instructions.length - 1) {
      // If this was a turn, track that we just passed it
      if (isTurn) {
        this._turnPassedLocation = { lat: location.lat, lng: location.lng };
        this._turnPassedStepIndex = this._stepIndex;
      }
      this._stepIndex += 1;
      // Reset last emitted instruction so next one will be shown
      this._lastEmittedInstruction = null;
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

