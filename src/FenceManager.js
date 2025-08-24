import maplibregl from 'maplibre-gl';

class FenceManager {
  constructor(map, clusteringEnabled = false, defaultColor = '#ff0000') {
    this.map = map;
    this.clusteringEnabled = clusteringEnabled;
    this.defaultColor = defaultColor;
    
    // Current fence state
    this.fencePoints = [];
    this.fenceMarkerList = [];
    this.isDrawingFence = false;
    this.currentFenceColor = this.defaultColor;
    
    // Overlay for current fence
    this.currentFenceOverlayHtml = null;
    this.currentFenceOverlayOptions = {};
    this.currentFenceOverlayMarker = null;
    this.currentFencePersistent = false;
    
    // Controls whether proximity to the first point should auto-close the fence
    this.disableProximityClosure = false;
    
    // Multiple fences support
    this.fences = [];
    this.currentFenceId = 0;
    
    // Source and layer IDs
    this.fenceSourceId = 'fence';
    this.fenceLayerId = 'fence-fill';
    this.dynamicPolylineSourceId = 'dynamic-fence';
    this.dynamicPolylineLayerId = 'dynamic-fence-line';
    
    // Event listeners
    this.eventListeners = {
      'fenceCompleted': []
    };
  }
  
  // Add event listener
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }
  
  // Remove event listener
  off(event, callback) {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
  }
  
  // Trigger event
  trigger(event, data) {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error('Error in event listener:', e);
      }
    });
  }

  addFencePoint(lngLat, customImage = null, onClick = null, addImageMarkerCallback, color = null, options = null) {
    if (!this.map) throw new Error("Map not initialized.");

    // Set the color for this fence if provided
    if (color) {
      this.currentFenceColor = color;
    }

    // If we have a completed fence, start a new fence regardless of click location
    // This allows beginning a new fence anywhere on the map after completing one
    if (this.isFenceCompleted()) {
      this.startNewFence();
    }

    // If clicking on the first point, close the fence (unless disabled via flag/options)
    const suppressAutoClose = (options && options.suppressAutoClose) || this.disableProximityClosure;
    const isOnFirstPoint = this.isDrawingFence && this.isClickOnFirstFencePoint(lngLat);
    
    if (!suppressAutoClose && isOnFirstPoint) {
      // Add the first point as a new point to close the fence
      // Use the exact same coordinate format as the first point
      this.fencePoints.push([this.fencePoints[0][0], this.fencePoints[0][1]]);
      
      this.closeFence();
      return;
    }

    this.fencePoints.push(lngLat);

    // If options specify an overlay for this fence and we don't yet have one queued, set it
    if (options && options.overlayHtml && !this.currentFenceOverlayHtml) {
      this.currentFenceOverlayHtml = options.overlayHtml;
      this.currentFenceOverlayOptions = options.overlayOptions || {};
    }
    // If options specify persistence for this fence
    if (options && typeof options.persistent === 'boolean') {
      this.currentFencePersistent = options.persistent;
    }
    
    const markerImage = customImage || 'https://cdn-icons-png.flaticon.com/512/484/484167.png';
    // Wrap user click to allow closing when first marker is clicked
    const userOnClick = onClick;
    const wrappedOnClick = (clickLngLat, marker, event) => {
      const isOnFirstPoint = !this.clusteringEnabled && this.isDrawingFence && this.isClickOnFirstFencePoint(clickLngLat);
      
      if (isOnFirstPoint) {
        // Append first point and close
        this.fencePoints.push([this.fencePoints[0][0], this.fencePoints[0][1]]);
        this.closeFence();
        return;
      }
      if (typeof userOnClick === 'function') {
        try { userOnClick(clickLngLat, marker, event); } catch (_) {}
      }
    };
    const markerResult = addImageMarkerCallback(lngLat, markerImage, [30, 30], wrappedOnClick);
    
    // Store fence markers separately (only for non-clustered markers)
    if (!this.clusteringEnabled) {
      const markerInstance = markerResult && markerResult.marker ? markerResult.marker : markerResult;
      if (markerInstance) this.fenceMarkerList.push(markerInstance);
    }

    if (this.fencePoints.length >= 3) {
      this.drawFence();
    }

    // Start drawing mode if this is the first point
    if (this.fencePoints.length === 1) {
      this.startFenceDrawing();
    }
  }

  startFenceDrawing() {
    if (!this.map) return;

    this.isDrawingFence = true;

    // Add dynamic polyline source and layer
    this.map.addSource(this.dynamicPolylineSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      }
    });

    this.map.addLayer({
      id: this.dynamicPolylineLayerId,
      type: 'line',
      source: this.dynamicPolylineSourceId,
      paint: {
        'line-color': this.currentFenceColor,
        'line-width': 2,
        'line-dasharray': [2, 2]
      }
    });

    // Add mouse move listener
    this.map.on('mousemove', this.updateDynamicPolyline);
  }

  updateDynamicPolyline = (e) => {
    if (!this.isDrawingFence || this.fencePoints.length === 0) return;

    const currentPoint = [e.lngLat.lng, e.lngLat.lat];
    const coordinates = [...this.fencePoints, currentPoint];

    this.map.getSource(this.dynamicPolylineSourceId).setData({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates
      }
    });
  }

  stopFenceDrawing() {
    if (!this.map) return;

    this.isDrawingFence = false;

    // Remove dynamic polyline
    if (this.map.getLayer(this.dynamicPolylineLayerId)) {
      this.map.removeLayer(this.dynamicPolylineLayerId);
    }
    if (this.map.getSource(this.dynamicPolylineSourceId)) {
      this.map.removeSource(this.dynamicPolylineSourceId);
    }

    // Remove mouse move listener
    this.map.off('mousemove', this.updateDynamicPolyline);
  }

  closeFence() {
    if (this.fencePoints.length < 3) return;

    // Check if first and last points are the same
    const firstPoint = this.fencePoints[0];
    const lastPoint = this.fencePoints[this.fencePoints.length - 1];
    
    console.debug('CloseFence - First point:', firstPoint, 'Last point:', lastPoint);
    console.debug('CloseFence - First point lng:', firstPoint[0], 'lat:', firstPoint[1]);
    console.debug('CloseFence - Last point lng:', lastPoint[0], 'lat:', lastPoint[1]);
    
    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
      console.debug('First and last points do not match. Appending first point to close fence.');
      this.fencePoints.push([firstPoint[0], firstPoint[1]]);
      console.debug('CloseFence - After appending, last point:', this.fencePoints[this.fencePoints.length - 1]);
    } else {
      console.debug('First and last points already match.');
    }

    this.drawFence();
    this.stopFenceDrawing();
    
    console.debug('Fence closed with', this.fencePoints.length, 'points');

    // If an overlay was set for the current fence, place it now
    if (this.currentFenceOverlayHtml) {
      this._placeOverlayForCurrentFence();
    }

    // If this fence is marked persistent, store it immediately so the next click starts fresh
    if (this.currentFencePersistent) {
      this.storeCurrentFence();
    }
    
    // Ensure we trigger a proper fence completion state
    this.isDrawingFence = false;
    
    // Trigger the fenceCompleted event
    this.trigger('fenceCompleted', {
      points: [...this.fencePoints],
      color: this.currentFenceColor,
      persistent: this.currentFencePersistent
    });
  }

  startNewFence() {
    // Store the current completed fence
    if (this.isFenceCompleted()) {
      const pointsToStore = (() => {
        const fp = this.fencePoints;
        if (fp.length < 3) return [...fp];
        const f = fp[0];
        const l = fp[fp.length - 1];
        const isClosed = f[0] === l[0] && f[1] === l[1];
        return isClosed ? [...fp] : [...fp, [f[0], f[1]]];
      })();

      // Before starting a new fence, clear all non-persistent previous fences
      this.clearNonPersistentFences();

      // Store current fence only if marked persistent; otherwise it will be cleared
      if (this.currentFencePersistent) {
        const completedFence = {
          id: this.currentFenceId++,
          points: pointsToStore,
          markers: [...this.fenceMarkerList],
          color: this.currentFenceColor,
          sourceId: `${this.fenceSourceId}-${this.currentFenceId}`,
          layerId: `${this.fenceLayerId}-${this.currentFenceId}`,
          overlayHtml: this.currentFenceOverlayHtml,
          overlayOptions: { ...this.currentFenceOverlayOptions },
          overlayMarker: this.currentFenceOverlayMarker || null,
          persistent: true
        };
        this.fences.push(completedFence);
      } else {
        // Not persistent: remove current fence markers and overlay from the map
        if (!this.clusteringEnabled) {
          this.fenceMarkerList.forEach(marker => marker && marker.remove && marker.remove());
        }
        if (this.currentFenceOverlayMarker) {
          this.currentFenceOverlayMarker.remove();
          this.currentFenceOverlayMarker = null;
        }
      }
      
      // Clear current fence state but keep the stored fence visible
      this.fencePoints = [];
      this.fenceMarkerList = [];
      this.currentFenceColor = this.defaultColor; // Reset to default color
      this.stopFenceDrawing();

      // Remove the transient current-fence source/layer to avoid duplicates
      if (this.map.getSource(this.fenceSourceId)) {
        if (this.map.getLayer(this.fenceLayerId)) this.map.removeLayer(this.fenceLayerId);
        this.map.removeSource(this.fenceSourceId);
      }

      // Reset current overlay state so the next fence can define its own overlay
      if (this.currentFenceOverlayMarker) {
        this.currentFenceOverlayMarker.remove();
        this.currentFenceOverlayMarker = null;
      }
      this.currentFenceOverlayHtml = null;
      this.currentFenceOverlayOptions = {};
      this.currentFencePersistent = false;
      
      // Redraw all fences to ensure they're all visible
      this.drawAllFences();
      
      console.debug(`Start new fence. Persistent fences count: ${this.fences.length}`);
    }
  }

  clearFence() {
    if (!this.map) return;

    // Remove current fence markers (only for non-clustered markers)
    if (!this.clusteringEnabled) {
      this.fenceMarkerList.forEach(marker => marker && marker.remove && marker.remove());
    }
    this.fenceMarkerList = [];

    // Only remove current fence source/layer if it exists
    if (this.map.getSource(this.fenceSourceId)) {
      if (this.map.getLayer(this.fenceLayerId)) this.map.removeLayer(this.fenceLayerId);
      this.map.removeSource(this.fenceSourceId);
    }

    // Stop drawing mode and remove dynamic polyline
    this.stopFenceDrawing();

    // Remove current fence overlay marker and state
    if (this.currentFenceOverlayMarker) {
      this.currentFenceOverlayMarker.remove();
      this.currentFenceOverlayMarker = null;
    }
    this.currentFenceOverlayHtml = null;
    this.currentFenceOverlayOptions = {};

    // Finally reset points
    this.fencePoints = [];
  }

  clearAllFences() {
    if (!this.map) return;

    // Clear current fence
    this.clearFence();

    // Clear all stored fences
    this.fences.forEach(fence => {
      if (this.map.getSource(fence.sourceId)) {
        this.map.removeLayer(fence.layerId);
        this.map.removeSource(fence.sourceId);
      }
      
      // Remove fence markers
      if (!this.clusteringEnabled) {
        fence.markers.forEach(marker => marker.remove());
      }

      // Remove overlay marker
      if (fence.overlayMarker) {
        fence.overlayMarker.remove();
        fence.overlayMarker = null;
      }
    });

    this.fences = [];
    this.currentFenceId = 0;
    
    console.debug('All fences cleared');
  }

  // Remove all non-persistent stored fences (layers, sources, markers, overlays)
  clearNonPersistentFences() {
    if (!this.map) return;

    const remaining = [];
    this.fences.forEach(fence => {
      if (fence.persistent) {
        remaining.push(fence);
        return;
      }
      if (this.map.getSource(fence.sourceId)) {
        if (this.map.getLayer(fence.layerId)) this.map.removeLayer(fence.layerId);
        this.map.removeSource(fence.sourceId);
      }
      if (!this.clusteringEnabled && Array.isArray(fence.markers)) {
        fence.markers.forEach(marker => marker && marker.remove && marker.remove());
      }
      if (fence.overlayMarker) {
        fence.overlayMarker.remove();
        fence.overlayMarker = null;
      }
    });
    this.fences = remaining;
  }

  drawFence() {
    if (this.fencePoints.length < 3) return;
    
    // Check if the last point is already the same as the first point
    const firstPoint = this.fencePoints[0];
    const lastPoint = this.fencePoints[this.fencePoints.length - 1];
    const isAlreadyClosed = firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1];
    
    // Create polygon - only add first point again if not already closed
    const polygon = isAlreadyClosed ? [this.fencePoints] : [[...this.fencePoints, this.fencePoints[0]]];

    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: polygon,
      },
    };

    if (this.map.getSource(this.fenceSourceId)) {
      this.map.getSource(this.fenceSourceId).setData(geojson);
    } else {
      this.map.addSource(this.fenceSourceId, {
        type: 'geojson',
        data: geojson,
      });

      this.map.addLayer({
        id: this.fenceLayerId,
        type: 'fill',
        source: this.fenceSourceId,
        layout: {},
        paint: {
          'fill-color': this.currentFenceColor,
          'fill-opacity': 0.3,
        },
      });
    }
  }

  drawAllFences() {
    // Draw all stored fences
    this.fences.forEach(fence => {
      this.drawStoredFence(fence);
    });
    
    // Draw current fence if it has enough points
    if (this.fencePoints.length >= 3) {
      this.drawFence();
    }
  }

  drawStoredFence(fence) {
    if (fence.points.length < 3) return;
    
    // Check if the last point is already the same as the first point
    const firstPoint = fence.points[0];
    const lastPoint = fence.points[fence.points.length - 1];
    const isAlreadyClosed = firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1];
    
    // Create polygon - only add first point again if not already closed
    const polygon = isAlreadyClosed ? [fence.points] : [[...fence.points, fence.points[0]]];
    
    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: polygon,
      },
    };

    if (this.map.getSource(fence.sourceId)) {
      this.map.getSource(fence.sourceId).setData(geojson);
    } else {
      this.map.addSource(fence.sourceId, {
        type: 'geojson',
        data: geojson,
      });

      this.map.addLayer({
        id: fence.layerId,
        type: 'fill',
        source: fence.sourceId,
        layout: {},
        paint: {
          'fill-color': fence.color || this.defaultColor,
          'fill-opacity': 0.3,
        },
      });
    }

    // Ensure overlay is placed for stored fence if it has one
    if (fence.overlayHtml && !fence.overlayMarker) {
      fence.overlayMarker = this._createOverlayMarkerForPoints(
        fence.points,
        fence.overlayHtml,
        fence.overlayOptions || {}
      );
    }
  }

  isFenceCompleted() {
    // Fence is completed if we have 3 or more points and are not currently drawing
    return this.fencePoints.length >= 3 && !this.isDrawingFence;
  }

  isPointInsideFence(lngLat) {
    if (this.fencePoints.length < 3) return false;

    // Simple point-in-polygon test using ray casting algorithm
    const x = lngLat[0];
    const y = lngLat[1];
    let inside = false;

    for (let i = 0, j = this.fencePoints.length - 1; i < this.fencePoints.length; j = i++) {
      const xi = this.fencePoints[i][0];
      const yi = this.fencePoints[i][1];
      const xj = this.fencePoints[j][0];
      const yj = this.fencePoints[j][1];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  isClickOnExistingFencePoint(lngLat) {
    // Check if click is near any existing fence point
    for (let i = 0; i < this.fencePoints.length; i++) {
      const point = this.fencePoints[i];
      const distance = this.calculateDistance(lngLat, point);
      if (distance < 0.0005) { // Roughly 20 pixels at zoom level 15
        return true;
      }
    }
    return false;
  }

  isClickOnFirstFencePoint(lngLat) {
    // Check if click is specifically on the first fence point
    if (this.fencePoints.length === 0) return false;
    const firstPoint = this.fencePoints[0];
    const distance = this.calculateDistance(lngLat, firstPoint);
    return distance < 0.0005; // Roughly 20 pixels at zoom level 15
  }

  calculateDistance(point1, point2) {
    const dx = point1[0] - point2[0];
    const dy = point1[1] - point2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  getFencePoints() {
    return this.fencePoints;
  }

  getFencePointsWithClosure() {
    // Return fence points with guaranteed first and last point matching
    if (this.fencePoints.length < 3) return this.fencePoints;
    
    const points = [...this.fencePoints];
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    
    // Ensure the last point matches the first point
    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
      points[points.length - 1] = [firstPoint[0], firstPoint[1]];
    }
    
    return points;
  }

  getFences() {
    return this.fences;
  }

  // Expose markers for current fence and stored fences
  getCurrentFenceMarkers() {
    return [...this.fenceMarkerList];
  }

  getAllMarkers() {
    const markers = [...this.fenceMarkerList];
    this.fences.forEach(f => {
      if (Array.isArray(f.markers)) {
        f.markers.forEach(m => markers.push(m));
      }
    });
    return markers;
  }

  // Public API: set an HTML overlay for the current fence. If the fence is already completed,
  // the overlay will be placed immediately; otherwise it will be placed on fence close.
  setFenceOverlay(overlayHtml, options = {}) {
    this.currentFenceOverlayHtml = overlayHtml;
    this.currentFenceOverlayOptions = options || {};

    // If fence is already completed, (re)place overlay now
    if (this.isFenceCompleted()) {
      // Remove existing marker if any
      if (this.currentFenceOverlayMarker) {
        this.currentFenceOverlayMarker.remove();
        this.currentFenceOverlayMarker = null;
      }
      this._placeOverlayForCurrentFence();
    }
  }

  // Public API: store the current fence as a completed fence without requiring a click outside.
  // Ensures the polygon is closed, stores it, resets current state, and redraws all fences.
  storeCurrentFence() {
    if (this.fencePoints.length < 3) return null;

    // Prepare a closed copy of points without mutating existing vertices
    const fp = this.fencePoints;
    const firstPoint = fp[0];
    const lastPoint = fp[fp.length - 1];
    const isClosed = firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1];
    const pointsToStore = isClosed ? [...fp] : [...fp, [firstPoint[0], firstPoint[1]]];

    // Stop drawing if still active and draw final polygon
    this.drawFence();
    this.stopFenceDrawing();

    // Remove the transient current-fence source/layer to avoid duplicates
    if (this.map.getSource(this.fenceSourceId)) {
      if (this.map.getLayer(this.fenceLayerId)) this.map.removeLayer(this.fenceLayerId);
      this.map.removeSource(this.fenceSourceId);
    }

    const completedFence = {
      id: this.currentFenceId++,
      points: pointsToStore,
      markers: [...this.fenceMarkerList],
      color: this.currentFenceColor,
      sourceId: `${this.fenceSourceId}-${this.currentFenceId}`,
      layerId: `${this.fenceLayerId}-${this.currentFenceId}`,
      overlayHtml: this.currentFenceOverlayHtml,
      overlayOptions: { ...this.currentFenceOverlayOptions },
      overlayMarker: this.currentFenceOverlayMarker || null,
      persistent: !!this.currentFencePersistent
    };

    this.fences.push(completedFence);

    // Reset current state for next fence
    this.fencePoints = [];
    this.fenceMarkerList = [];
    this.currentFenceColor = this.defaultColor;
    if (this.currentFenceOverlayMarker) {
      this.currentFenceOverlayMarker = null;
    }
    this.currentFenceOverlayHtml = null;
    this.currentFenceOverlayOptions = {};
    this.currentFencePersistent = false;

    // Redraw everything and ensure overlay marker is placed for the stored fence
    this.drawAllFences();

    return completedFence;
  }

  // Internal: place overlay for current fence
  _placeOverlayForCurrentFence() {
    if (this.fencePoints.length < 3 || !this.currentFenceOverlayHtml) return;
    this.currentFenceOverlayMarker = this._createOverlayMarkerForPoints(
      this.fencePoints,
      this.currentFenceOverlayHtml,
      this.currentFenceOverlayOptions
    );
  }

  _createOverlayMarkerForPoints(points, overlayHtml, options = {}) {
    const centroid = this._computePolygonCentroid(points);
    let element;
    if (typeof overlayHtml === 'string') {
      element = document.createElement('div');
      element.innerHTML = overlayHtml;
      // If string contains multiple nodes, wrap in a div
      if (element.childNodes.length === 1 && element.firstChild instanceof HTMLElement) {
        element = element.firstChild;
      }
    } else if (overlayHtml instanceof HTMLElement) {
      element = overlayHtml;
    } else {
      throw new Error('overlayHtml must be a string or HTMLElement');
    }

    const markerOptions = {};
    if (options.anchor) markerOptions.anchor = options.anchor;
    if (options.offset) markerOptions.offset = options.offset;

    const marker = new maplibregl.Marker({ element, ...markerOptions })
      .setLngLat(centroid)
      .addTo(this.map);
    return marker;
  }

  _computePolygonCentroid(points) {
    if (!points || points.length === 0) return [0, 0];
    const isClosed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
    const pts = isClosed ? points : [...points, points[0]];
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[i + 1][0];
      const yj = pts[i + 1][1];
      const f = xi * yj - xj * yi;
      twiceArea += f;
      x += (xi + xj) * f;
      y += (yi + yj) * f;
    }
    if (twiceArea === 0) {
      // Fallback to average of points (excluding duplicated last)
      const count = pts.length - 1;
      const sum = pts.slice(0, -1).reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
      return [sum[0] / count, sum[1] / count];
    }
    const area = twiceArea * 0.5;
    return [x / (6 * area), y / (6 * area)];
  }
}

export default FenceManager; 