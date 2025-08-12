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
    
    // Multiple fences support
    this.fences = [];
    this.currentFenceId = 0;
    
    // Source and layer IDs
    this.fenceSourceId = 'fence';
    this.fenceLayerId = 'fence-fill';
    this.dynamicPolylineSourceId = 'dynamic-fence';
    this.dynamicPolylineLayerId = 'dynamic-fence-line';
  }

  addFencePoint(lngLat, customImage = null, onClick = null, addImageMarkerCallback, color = null) {
    if (!this.map) throw new Error("Map not initialized.");

    // Set the color for this fence if provided
    if (color) {
      this.currentFenceColor = color;
    }

    // If we have a completed fence and click is outside, start a new fence
    if (this.isFenceCompleted() && !this.isPointInsideFence(lngLat)) {
      this.startNewFence();
    }

    // If clicking on the first point, close the fence
    if (this.isDrawingFence && this.isClickOnFirstFencePoint(lngLat)) {
      // Add the first point as a new point to close the fence
      // Use the exact same coordinate format as the first point
      this.fencePoints.push([this.fencePoints[0][0], this.fencePoints[0][1]]);
      
      this.closeFence();
      return;
    }

    this.fencePoints.push(lngLat);
    
    const markerImage = customImage || 'https://cdn-icons-png.flaticon.com/512/484/484167.png';
    const marker = addImageMarkerCallback(lngLat, markerImage, [30, 30], onClick);
    
    // Store fence markers separately (only for non-clustered markers)
    if (!this.clusteringEnabled) {
      this.fenceMarkerList.push(marker);
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
      console.debug('First and last points do not match. Setting last point to match first point.');
      this.fencePoints[this.fencePoints.length - 1] = [firstPoint[0], firstPoint[1]];
      console.debug('CloseFence - After setting, last point:', this.fencePoints[this.fencePoints.length - 1]);
    } else {
      console.debug('First and last points already match.');
    }

    this.drawFence();
    this.stopFenceDrawing();
    
    console.debug('Fence closed with', this.fencePoints.length, 'points');
  }

  startNewFence() {
    // Store the current completed fence
    if (this.isFenceCompleted()) {
      const completedFence = {
        id: this.currentFenceId++,
        points: [...this.fencePoints],
        markers: [...this.fenceMarkerList],
        color: this.currentFenceColor,
        sourceId: `${this.fenceSourceId}-${this.currentFenceId}`,
        layerId: `${this.fenceLayerId}-${this.currentFenceId}`
      };
      
      this.fences.push(completedFence);
      
      // Clear current fence state but keep the stored fence visible
      this.fencePoints = [];
      this.fenceMarkerList = [];
      this.currentFenceColor = this.defaultColor; // Reset to default color
      this.stopFenceDrawing();
      
      // Redraw all fences to ensure they're all visible
      this.drawAllFences();
      
      console.debug(`Fence ${completedFence.id} stored. Total fences: ${this.fences.length}`);
    }
  }

  clearFence() {
    if (!this.map) return;

    this.fencePoints = [];
    this.fenceMarkerList = [];

    // Only remove current fence source/layer if it exists
    if (this.map.getSource(this.fenceSourceId)) {
      this.map.removeLayer(this.fenceLayerId);
      this.map.removeSource(this.fenceSourceId);
    }

    // Clear current fence markers (only for non-clustered markers)
    if (!this.clusteringEnabled) {
      this.fenceMarkerList.forEach(marker => marker.remove());
      this.fenceMarkerList = [];
    }

    // Stop drawing mode and remove dynamic polyline
    this.stopFenceDrawing();
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
    });

    this.fences = [];
    this.currentFenceId = 0;
    
    console.debug('All fences cleared');
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
}

export default FenceManager; 