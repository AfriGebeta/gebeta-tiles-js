import maplibregl from 'maplibre-gl';

class DirectionsManager {
  constructor(map, apiKey) {
    this.map = map;
    this.apiKey = apiKey;
    this.baseUrl = 'https://mapapi.gebeta.app/api/route/direction/';
    this.currentRoute = null;
    this.routeSource = null;
    this.routeLayer = null;
    this.markers = [];
    
    // Initialize route source and layer when map is ready
    if (this.map.isStyleLoaded()) {
      this._initRouteLayer();
    } else {
      this.map.once('style.load', () => {
        this._initRouteLayer();
      });
    }
  }

  _initRouteLayer() {
    if (!this.map) return;
    
    // Wait for map to be fully loaded
    if (!this.map.isStyleLoaded()) {
      this.map.once('style.load', () => this._initRouteLayer());
      return;
    }

    // Check if source already exists
    if (this.map.getSource('route')) {
      return;
    }

    try {
      // Add source for route geometry
      this.map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      // Find the last layer to add route layer at the top (so it's always visible)
      const layers = this.map.getStyle().layers;
      let beforeId = null;
      
      // Try to add after the last layer, or before the first symbol layer
      if (layers.length > 0) {
        // Add at the very top (after last layer)
        beforeId = null; // null means add at the end
      } else {
        // Fallback: find first symbol layer
        for (const layer of layers) {
          if (layer.type === 'symbol') {
            beforeId = layer.id;
            break;
          }
        }
      }

      // Add route line layer with default style
      this.map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'visibility': 'visible'
        },
        paint: {
          'line-color': '#007cbf',
          'line-width': 4,
          'line-opacity': 0.8
        }
      }, beforeId);
      
      // Ensure layer is visible
      this.map.setLayoutProperty('route', 'visibility', 'visible');
    } catch (error) {
      console.error('Error initializing route layer:', error);
    }

    // Add route arrow layer for direction indicators (only if route has data)
    // We'll add this layer only when we actually have route data to display
    // For now, skip it to avoid potential issues
  }

  /**
   * Get directions between two points
   * @param {Object} origin - {lat: number, lng: number}
   * @param {Object} destination - {lat: number, lng: number}
   * @param {Object} options - Additional options
   * @param {Array} options.waypoints - Array of waypoint objects [{lat: number, lng: number}]
   * @param {number} options.avgSpeedKmh - Average speed in km/h
   * @returns {Promise<Object>} - Directions response
   */
  async getDirections(origin, destination, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key is required for directions');
    }

    if (!origin || !destination) {
      throw new Error('Origin and destination are required');
    }

    const {
      waypoints = [],
      avgSpeedKmh = 30 // default value
    } = options;

    // Build URL parameters
    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      apiKey: this.apiKey
    });

    // Add waypoints if provided - send as array of {lat,lng} objects (no property names)
    if (waypoints.length > 0) {
      const waypointsString = `[${waypoints.map(wp => `{${wp.lat},${wp.lng}}`).join(',')}]`;
      params.append('waypoints', waypointsString);
    }

    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Directions API error: ${response.status} - ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      
      // Transform the API response to our internal format
      const transformedData = this._transformApiResponse(data, origin, destination, avgSpeedKmh);
      
      this.currentRoute = transformedData;
      return transformedData;
    } catch (error) {
      console.error('Error fetching directions:', error);
      throw error;
    }
  }

  /**
   * Transform the API response to our internal format
   * @param {Object} apiResponse - Raw API response
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @param {number} avgSpeedKmh - Average speed in km/h
   * @returns {Object} - Transformed route data
   */
  _transformApiResponse(apiResponse, origin, destination, avgSpeedKmh = 30) {
    // Extract coordinates from the direction array
    const coordinates = apiResponse.direction || [];
    // Transform coordinates to [lng, lat] format for MapLibre
    const transformedCoordinates = coordinates.map(coord => [coord[1], coord[0]]);

    // Map instructions to include coord property
    const instructions = (apiResponse.instruction || []).map(step => ({
      ...step,
      coord: [step.turning_latitude, step.turning_longitude]
    }));

    return {
      ...apiResponse,
      geometry: {
        type: 'LineString',
        coordinates: transformedCoordinates
      },
      origin: {
        lat: origin.lat,
        lng: origin.lng
      },
      destination: {
        lat: destination.lat,
        lng: destination.lng
      },
      distance: apiResponse.totalDistance ? `${(apiResponse.totalDistance / 1000).toFixed(2)} km` : null,
      duration: apiResponse.totalDistance ? this._estimateDuration(apiResponse.totalDistance, avgSpeedKmh) : null,
      instructions
    };
  }

  /**
   * Estimate travel time based on distance (assuming average speed in km/h)
   * @param {number} distanceMeters - Distance in meters
   * @param {number} avgSpeedKmh - Average speed in km/h
   * @returns {string} - Estimated duration
   */
  _estimateDuration(distanceMeters, avgSpeedKmh = 30) {
    const distanceKm = distanceMeters / 1000;
    const durationHours = distanceKm / avgSpeedKmh;
    const durationMinutes = Math.round(durationHours * 60);
    
    if (durationMinutes < 60) {
      return `${durationMinutes} min`;
    } else {
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
  }

  /**
   * Display a route on the map
   * @param {Object} routeData - Route data from getDirections
   * @param {Object} options - Display options
   * @param {boolean} options.showMarkers - Whether to show origin/destination/waypoint markers
   * @param {string} options.originIcon - Custom icon for origin marker
   * @param {string} options.destinationIcon - Custom icon for destination marker
   * @param {string} options.waypointIcon - Custom icon for waypoint markers
   * @param {boolean} options.showInstructions - Whether to show instruction step markers (default: false)
   * @param {Object} options.routeStyle - Route line styling options
   * @param {string} options.routeStyle.color - Route line color (default: '#007cbf')
   * @param {number} options.routeStyle.width - Route line width in pixels (default: 4)
   * @param {number} options.routeStyle.opacity - Route line opacity 0-1 (default: 0.8)
   * @param {string} options.routeStyle.lineJoin - Line join style: 'round', 'bevel', 'miter' (default: 'round')
   * @param {string} options.routeStyle.lineCap - Line cap style: 'round', 'butt', 'square' (default: 'round')
   */
  displayRoute(routeData, options = {}) {
    if (!this.map || !routeData) return;

    const {
      showMarkers = true,
      originIcon = null,
      destinationIcon = null,
      waypointIcon = null,
      showInstructions = false,
      routeStyle = {}
    } = options;
    
    // Default route style
    const style = {
      color: routeStyle.color || '#007cbf',
      width: routeStyle.width || 4,
      opacity: routeStyle.opacity !== undefined ? routeStyle.opacity : 0.8,
      lineJoin: routeStyle.lineJoin || 'round',
      lineCap: routeStyle.lineCap || 'round'
    };

    // Ensure route layer is initialized
    if (!this.map.getSource('route')) {
      this._initRouteLayer();
    }

    // Clear existing route
    this.clearRoute();

    // Get coordinates - handle both transformed data and raw API response
    let coordinates = [];
    if (routeData.geometry && routeData.geometry.coordinates) {
      // Already transformed data from getDirections()
      coordinates = routeData.geometry.coordinates;
    } else if (routeData.direction && Array.isArray(routeData.direction)) {
      // Raw API response - transform [lat, lng] to [lng, lat]
      coordinates = routeData.direction.map(coord => [coord[1], coord[0]]);
    } else if (routeData.path && Array.isArray(routeData.path)) {
      // Handle path format with {lat, lng} objects
      coordinates = routeData.path.map(point => [point.lng, point.lat]);
    }

    // Update route geometry if we have coordinates
    if (coordinates.length > 0 && this.map.getSource('route')) {
      try {
        this.map.getSource('route').setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        });
        
        // Ensure route layer exists
        if (!this.map.getLayer('route')) {
          this._initRouteLayer();
        }
        
        // Move route layer to the very top of the layer stack
        try {
          const layers = this.map.getStyle().layers;
          const routeLayerIndex = layers.findIndex(l => l.id === 'route');
          if (routeLayerIndex >= 0 && routeLayerIndex < layers.length - 1) {
            // Remove and re-add at the end (top of stack)
            this.map.removeLayer('route');
            this.map.addLayer({
              id: 'route',
              type: 'line',
              source: 'route',
              layout: {
                'line-join': style.lineJoin,
                'line-cap': style.lineCap,
                'visibility': 'visible'
              },
              paint: {
                'line-color': style.color,
                'line-width': style.width,
                'line-opacity': style.opacity
              }
            });
          }
        } catch (e) {
          console.warn('Could not move route layer:', e);
        }
        
        // Force layer to be visible and set properties
        this.map.setLayoutProperty('route', 'visibility', 'visible');
        this.map.setLayoutProperty('route', 'line-join', style.lineJoin);
        this.map.setLayoutProperty('route', 'line-cap', style.lineCap);
        this.map.setPaintProperty('route', 'line-color', style.color);
        this.map.setPaintProperty('route', 'line-width', style.width);
        this.map.setPaintProperty('route', 'line-opacity', style.opacity);
        
        console.log('Route displayed with', coordinates.length, 'coordinates');
      } catch (error) {
        console.error('Error setting route data:', error);
      }
    } else {
      console.warn('No valid coordinates found in routeData:', routeData);
      console.warn('Coordinates array length:', coordinates.length);
      console.warn('Route source exists:', !!this.map.getSource('route'));
    }

    // Add markers if requested
    if (showMarkers) {
      this._addRouteMarkers(routeData, {
        originIcon,
        destinationIcon,
        waypointIcon
      });
    }

    // Add instruction step markers if requested
    if (showInstructions && Array.isArray(routeData.instructions) && routeData.instructions.length > 0) {
      this._addInstructionMarkers(routeData.instructions);
    }

    // Fit map to route bounds
    this._fitMapToRoute(routeData);
  }

  /**
   * Add markers for route points (origin, destination, waypoints)
   * @param {Object} routeData - Route data
   * @param {Object} options - Marker options
   */
  _addRouteMarkers(routeData, options = {}) {
    const {
      originIcon = 'https://cdn-icons-png.flaticon.com/512/1828/1828640.png',
      destinationIcon = 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png',
      waypointIcon = 'https://cdn-icons-png.flaticon.com/512/484/484167.png'
    } = options;

    // Clear existing markers
    this._clearMarkers();

    // Add origin marker
    if (routeData.origin) {
      const originMarker = this._addMarker(
        [routeData.origin.lng, routeData.origin.lat],
        originIcon,
        'Origin',
        [25, 25]
      );
      this.markers.push(originMarker);
    }

    // Add destination marker
    if (routeData.destination) {
      const destMarker = this._addMarker(
        [routeData.destination.lng, routeData.destination.lat],
        destinationIcon,
        'Destination',
        [25, 25]
      );
      this.markers.push(destMarker);
    }

    // Add waypoint markers
    if (routeData.waypoints && routeData.waypoints.length > 0) {
      routeData.waypoints.forEach((waypoint, index) => {
        const waypointMarker = this._addMarker(
          [waypoint.lng, waypoint.lat],
          waypointIcon,
          `Waypoint ${index + 1}`,
          [20, 20]
        );
        this.markers.push(waypointMarker);
      });
    }
  }

  /**
   * Add a marker to the map
   * @param {Array} lngLat - [longitude, latitude]
   * @param {string} iconUrl - Icon URL
   * @param {string} title - Marker title
   * @param {Array} size - [width, height]
   * @returns {maplibregl.Marker} - Created marker
   */
  _addMarker(lngLat, iconUrl, title, size = [30, 30]) {
    const el = document.createElement('div');
    el.style.backgroundImage = `url('${iconUrl}')`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.width = `${size[0]}px`;
    el.style.height = `${size[1]}px`;
    el.style.cursor = 'pointer';
    el.title = title;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(this.map);

    return marker;
  }

  /**
   * Fit map view to show the entire route
   * @param {Object} routeData - Route data
   */
  _fitMapToRoute(routeData) {
    if (!this.map || !routeData.geometry) return;

    const coordinates = routeData.geometry.coordinates;
    if (coordinates.length === 0) return;

    // Create bounds object
    const bounds = new maplibregl.LngLatBounds();
    
    // Extend bounds with all route coordinates
    coordinates.forEach(coord => {
      bounds.extend(coord);
    });

    // Add padding and fit to bounds
    this.map.fitBounds(bounds, {
      padding: 50,
      duration: 1000
    });
  }

  /**
   * Clear the current route from the map
   */
  clearRoute() {
    if (!this.map) return;

    // Clear route geometry
    this.map.getSource('route').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: []
      }
    });

    // Clear markers
    this._clearMarkers();

    // Clear instruction markers
    if (this.instructionMarkers) {
      this.instructionMarkers.forEach(marker => marker.remove());
      this.instructionMarkers = [];
    }
    if (this._instructionPopup) {
      this._instructionPopup.remove();
      this._instructionPopup = null;
    }

    this.currentRoute = null;
  }

  /**
   * Clear all route markers
   */
  _clearMarkers() {
    this.markers.forEach(marker => marker.remove());
    this.markers = [];
  }

  /**
   * Get the current route data
   * @returns {Object|null} - Current route data
   */
  getCurrentRoute() {
    return this.currentRoute;
  }

  /**
   * Get route summary (distance, duration, etc.)
   * @returns {Object|null} - Route summary
   */
  getRouteSummary() {
    if (!this.currentRoute) return null;

    return {
      distance: this.currentRoute.distance,
      duration: this.currentRoute.duration,
      totalDistance: this.currentRoute.totalDistance,
      timeTaken: this.currentRoute.timetaken,
      origin: this.currentRoute.origin,
      destination: this.currentRoute.destination,
      waypoints: this.currentRoute.waypoints || []
    };
  }

  /**
   * Update route styling
   * @param {Object} style - Style options
   * @param {string} style.color - Route line color
   * @param {number} style.width - Route line width
   * @param {number} style.opacity - Route line opacity
   * @param {string} style.lineJoin - Line join style: 'round', 'bevel', 'miter'
   * @param {string} style.lineCap - Line cap style: 'round', 'butt', 'square'
   */
  updateRouteStyle(style = {}) {
    if (!this.map || !this.map.getLayer('route')) return;

    const {
      color = '#007cbf',
      width = 4,
      opacity = 0.8,
      lineJoin = 'round',
      lineCap = 'round'
    } = style;

    if (color !== undefined) {
      this.map.setPaintProperty('route', 'line-color', color);
    }
    if (width !== undefined) {
      this.map.setPaintProperty('route', 'line-width', width);
    }
    if (opacity !== undefined) {
      this.map.setPaintProperty('route', 'line-opacity', opacity);
    }
    if (lineJoin !== undefined) {
      this.map.setLayoutProperty('route', 'line-join', lineJoin);
    }
    if (lineCap !== undefined) {
      this.map.setLayoutProperty('route', 'line-cap', lineCap);
    }
  }

  /**
   * Add markers for instruction steps
   * @param {Array} instructions - Array of instruction objects
   */
  _addInstructionMarkers(instructions) {
    if (!this.map) return;
    // Remove any previous instruction markers
    if (!this.instructionMarkers) this.instructionMarkers = [];
    this.instructionMarkers.forEach(marker => marker.remove());
    this.instructionMarkers = [];

    instructions.forEach((step, idx) => {
      if (!step.coord || step.coord.length !== 2) return;
      const [lat, lng] = step.coord;
      // Create a numbered marker
      const el = document.createElement('div');
      el.style.background = '#007cbf';
      el.style.color = 'white';
      el.style.borderRadius = '50%';
      el.style.width = '28px';
      el.style.height = '28px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.fontWeight = 'bold';
      el.style.fontSize = '15px';
      el.style.border = '2px solid #fff';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
      el.innerText = (idx + 1).toString();
      el.style.cursor = 'pointer';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(this.map);

      // On click: zoom to step and show popup
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.2 });
        // Remove any existing popups
        if (this._instructionPopup) this._instructionPopup.remove();
        this._instructionPopup = new maplibregl.Popup({ offset: 18, closeButton: false })
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="font-size:14px; color:#666; width:max-content; border-radius:5%; padding:4px 8px;">
              ${step.path || ''} (~${Math.round(step.distance)}m)
            </div>`
          )
          .addTo(this.map);
      });

      this.instructionMarkers.push(marker);
    });
  }
}

export default DirectionsManager; 