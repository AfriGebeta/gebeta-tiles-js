import maplibregl from 'maplibre-gl';
import ClusteringManager from './ClusteringManager.js';
import './style.css';

class GebetaMaps {
  constructor({ apiKey, clustering = {} }) {
    if (!apiKey) {
      console.error("An API key is required for Gebeta Maps.");
    }
    this.apiKey = apiKey;
    this.map = null;
    this.fencePoints = [];
    this.fenceSourceId = 'fence';
    this.fenceLayerId = 'fence-fill';
    this.markerList = [];
    this.fenceMarkerList = [];
    
    // Multiple fences support
    this.fences = []; // Array to store completed fences
    this.currentFenceId = 0;
    
    // Clustering configuration
    this.clustering = {
      enabled: clustering.enabled || false,
      ...clustering
    };
    
    // Clustering manager
    this.clusteringManager = null;

    // Fence drawing state
    this.isDrawingFence = false;
    this.dynamicPolyline = null;
    this.dynamicPolylineSourceId = 'dynamic-fence';
    this.dynamicPolylineLayerId = 'dynamic-fence-line';
  }

  init(options) {
    const styleUrl = `https://tiles.gebeta.app/styles/standard/style.json`;

    this.map = new maplibregl.Map({
      ...options,
      style: styleUrl,
      attributionControl: false,
      transformRequest: (url, resourceType) => {
        // Only add the Authorization header for requests to tiles.gebeta.app
        if (url.startsWith('https://tiles.gebeta.app')) {
          return {
            url,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          };
        }
        return { url };
      },
    });

    this.addGebetaLogo();
    this.addCustomAttribution();

    // Initialize clustering after map loads
    if (this.clustering.enabled) {
      this.map.on('load', () => {
        this.initClustering();
      });
    }

    return this.map;
  }

  initClustering() {
    if (!this.map) return;

    this.clusteringManager = new ClusteringManager(this.map, this.clustering);
  }

  on(event, handler) {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.on(event, handler);
  }

  addNavigationControls(position = 'top-right') {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.addControl(new maplibregl.NavigationControl(), position);
  }

  addImageMarker(lngLat, imageUrl, size = [30, 30], onClick = null) {
    if (!this.map) throw new Error("Map not initialized.");

    // If clustering is enabled, add to clustering manager
    if (this.clustering.enabled && this.clusteringManager) {
      const markerId = `marker_${Date.now()}_${Math.random()}`;
      const marker = {
        id: markerId,
        lngLat: lngLat,
        imageUrl,
        size,
        onClick
      };
      
      this.clusteringManager.addMarker(marker);
      return marker;
    }

    // Traditional marker approach (non-clustered)
    const el = document.createElement('div');
    el.style.backgroundImage = `url('${imageUrl}')`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.width = `${size[0]}px`;
    el.style.height = `${size[1]}px`;
    el.style.cursor = 'pointer';

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(this.map);

    // Add click handler if provided
    if (onClick) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(lngLat, marker, e);
      });
    }

    this.markerList.push(marker);
    return marker;
  }

  addFencePoint(lngLat, customImage = null, onClick = null) {
    if (!this.map) throw new Error("Map not initialized.");

    // If we have a completed fence and click is outside, start a new fence
    if (this.isFenceCompleted() && !this.isPointInsideFence(lngLat)) {
      // Start a new fence instead of clearing the old one
      this.startNewFence();
    }

    // If clicking on an existing point, close the fence and do not add a new point
    if (this.isDrawingFence && this.isClickOnExistingFencePoint(lngLat)) {
      this.closeFence();
      return;
    }

    this.fencePoints.push(lngLat);
    
    const markerImage = customImage || 'https://cdn-icons-png.flaticon.com/512/484/484167.png';
    const marker = this.addImageMarker(lngLat, markerImage, [30, 30], onClick);
    
    // Store fence markers separately (only for non-clustered markers)
    if (!this.clustering.enabled) {
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
        'line-color': '#ff0000',
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

  checkFencePointClick(lngLat) {
    if (this.fencePoints.length < 2) return false;

    // Check if click is near any existing fence point (except the last one)
    for (let i = 0; i < this.fencePoints.length - 1; i++) {
      const point = this.fencePoints[i];
      const distance = this.calculateDistance(lngLat, point);
      
      // If click is within 20 pixels of an existing point, close the fence
      if (distance < 0.0005) { // Roughly 20 pixels at zoom level 15
        this.closeFence();
        return true;
      }
    }
    return false;
  }

  calculateDistance(point1, point2) {
    const dx = point1[0] - point2[0];
    const dy = point1[1] - point2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  closeFence() {
    if (this.fencePoints.length < 3) return;

    this.drawFence();
    this.stopFenceDrawing();
    
    console.log('Fence closed with', this.fencePoints.length, 'points');
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

  isFenceCompleted() {
    // Fence is completed if we have 3 or more points and are not currently drawing
    return this.fencePoints.length >= 3 && !this.isDrawingFence;
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

  clearFence() {
    if (!this.map) return;

    this.fencePoints = [];

    // Only remove current fence source/layer if it exists
    if (this.map.getSource(this.fenceSourceId)) {
      this.map.removeLayer(this.fenceLayerId);
      this.map.removeSource(this.fenceSourceId);
    }

    // Clear current fence markers (only for non-clustered markers)
    if (!this.clustering.enabled) {
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
      if (!this.clustering.enabled) {
        fence.markers.forEach(marker => marker.remove());
      }
    });

    this.fences = [];
    this.currentFenceId = 0;
    
    console.log('All fences cleared');
  }

  clearAllMarkers() {
    if (!this.map) return;

    // Clear fence markers (only for non-clustered markers)
    if (!this.clustering.enabled) {
      this.fenceMarkerList.forEach(marker => marker.remove());
      this.fenceMarkerList = [];
    }

    // Clear custom markers (only for non-clustered markers)
    this.markerList.forEach(marker => marker.remove());
    this.markerList = [];

    // Clear clustered markers
    if (this.clustering.enabled && this.clusteringManager) {
      this.clusteringManager.clearAllMarkers();
    }
  }

  drawFence() {
    if (this.fencePoints.length < 3) return;
    // Always close the polygon by connecting last point to first
    const polygon = [[...this.fencePoints, this.fencePoints[0]]];

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
          'fill-color': '#ff0000',
          'fill-opacity': 0.3,
        },
      });
    }
  }

  addGebetaLogo() {
    if (!this.map) return;
    const logoContainer = document.createElement('div');
    logoContainer.className = 'maplibregl-ctrl-bottom-left';
    logoContainer.innerHTML = `
      <div class="maplibregl-ctrl" style="margin: 0 0 10px 10px;">
        <a href="https://gebetamaps.com/" target="_blank">
          <img src="https://tiles.gebeta.app/static/glogo.svg" alt="Gebeta Maps Logo" style="height: 30px; border-radius: 4px;"/>
        </a>
      </div>`;
    this.map.getContainer().appendChild(logoContainer);
  }

  addCustomAttribution() {
    if (!this.map) return;
    this.map.addControl(new maplibregl.AttributionControl({
      customAttribution: '<a href="https://gebetamaps.com/" target="_blank">© Gebeta Maps</a>',
    }));
  }

  startNewFence() {
    // Store the current completed fence
    if (this.isFenceCompleted()) {
      const completedFence = {
        id: this.currentFenceId++,
        points: [...this.fencePoints],
        markers: [...this.fenceMarkerList],
        sourceId: `${this.fenceSourceId}-${this.currentFenceId}`,
        layerId: `${this.fenceLayerId}-${this.currentFenceId}`
      };
      
      this.fences.push(completedFence);
      
      // Clear current fence state but keep the stored fence visible
      this.fencePoints = [];
      this.fenceMarkerList = [];
      this.stopFenceDrawing();
      
      // Redraw all fences to ensure they're all visible
      this.drawAllFences();
      
      console.log(`Fence ${completedFence.id} stored. Total fences: ${this.fences.length}`);
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
    
    const polygon = [[...fence.points, fence.points[0]]];
    
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
          'fill-color': '#ff0000',
          'fill-opacity': 0.3,
        },
      });
    }
  }
}

export default GebetaMaps; 