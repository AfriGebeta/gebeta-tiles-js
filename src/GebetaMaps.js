import maplibregl from 'maplibre-gl';
import ClusteringManager from './ClusteringManager.js';
import FenceManager from './FenceManager.js';
import DirectionsManager from './DirectionsManager.js';
import GeocodingManager from './GeocodingManager.js';
import './style.css';

class GebetaMaps {
  constructor({ apiKey, clustering = {} }) {
    if (!apiKey) {
      console.error("An API key is required for Gebeta Maps.");
    }
    this.apiKey = apiKey;
    this.map = null;
    this.markerList = [];
    
    // Clustering configuration
    this.clustering = {
      enabled: clustering.enabled || false,
      ...clustering
    };
    
    // Clustering manager
    this.clusteringManager = null;

    // Fence manager
    this.fenceManager = null;

    // Directions manager
    this.directionsManager = null;

    this.geocodingManager = new GeocodingManager(apiKey);
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

    // Initialize managers after map loads
    this.map.on('load', () => {
      // Initialize clustering if enabled
      if (this.clustering.enabled) {
        this.initClustering();
      }
      
      // Initialize fence manager
      this.initFenceManager();

      // Initialize directions manager
      this.initDirectionsManager();
    });

    return this.map;
  }

  initClustering() {
    if (!this.map) return;
    this.clusteringManager = new ClusteringManager(this.map, this.clustering);
  }

  initFenceManager(defaultColor = '#ff0000') {
    if (!this.map) return;
    this.fenceManager = new FenceManager(this.map, this.clustering.enabled, defaultColor);
  }

  setFenceDefaultColor(color) {
    if (!this.fenceManager) return;
    this.fenceManager.defaultColor = color;
    this.fenceManager.currentFenceColor = color;
  }

  initDirectionsManager() {
    if (!this.map) return;
    this.directionsManager = new DirectionsManager(this.map, this.apiKey);
  }

  on(event, handler) {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.on(event, handler);
  }

  addNavigationControls(position = 'top-right') {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.addControl(new maplibregl.NavigationControl(), position);
  }

  addImageMarker(lngLat, imageUrl, size = [30, 30], onClick = null, zIndex = 10, popupHtml = null) {
    if (!this.map) throw new Error("Map not initialized.");

    // If clustering is enabled, add to clustering manager
    if (this.clustering.enabled && this.clusteringManager) {
      const markerId = `marker_${Date.now()}_${Math.random()}`;
      const marker = {
        id: markerId,
        lngLat: lngLat,
        imageUrl,
        size,
        onClick,
        zIndex,
        popupHtml
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
    el.style.zIndex = zIndex;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(this.map);

    let popup = null;
    if (popupHtml) {
      popup = new maplibregl.Popup({ offset: 18 })
        .setHTML(popupHtml);
      marker.setPopup(popup);
    }

    // Add click handler if provided
    if (onClick) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(lngLat, marker, e);
      });
    }

    this.markerList.push(marker);
    return { marker, popup };
  }

  addFencePoint(lngLat, customImage = null, onClick = null, color = null) {
    if (!this.fenceManager) {
      console.warn("Fence manager not initialized. Fence functionality may not work properly.");
      return;
    }
    
    this.fenceManager.addFencePoint(lngLat, customImage, onClick, this.addImageMarker.bind(this), color);
  }

  clearFence() {
    if (!this.fenceManager) return;
    this.fenceManager.clearFence();
  }

  clearAllFences() {
    if (!this.fenceManager) return;
    this.fenceManager.clearAllFences();
  }

  isFenceCompleted() {
    if (!this.fenceManager) return false;
    return this.fenceManager.isFenceCompleted();
  }

  isPointInsideFence(lngLat) {
    if (!this.fenceManager) return false;
    return this.fenceManager.isPointInsideFence(lngLat);
  }

  getFencePoints() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFencePoints();
  }

  getFencePointsWithClosure() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFencePointsWithClosure();
  }

  getFences() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFences();
  }

  // Directions API methods
  async getDirections(origin, destination, options = {}) {
    if (!this.directionsManager) {
      throw new Error("Directions manager not initialized. Call init() first.");
    }
    return await this.directionsManager.getDirections(origin, destination, options);
  }

  displayRoute(routeData, options = {}) {
    if (!this.directionsManager) {
      console.warn("Directions manager not initialized. Route display may not work properly.");
      return;
    }
    this.directionsManager.displayRoute(routeData, options);
  }

  clearRoute() {
    if (!this.directionsManager) return;
    this.directionsManager.clearRoute();
  }

  getCurrentRoute() {
    if (!this.directionsManager) return null;
    return this.directionsManager.getCurrentRoute();
  }

  getRouteSummary() {
    if (!this.directionsManager) return null;
    return this.directionsManager.getRouteSummary();
  }

  updateRouteStyle(style = {}) {
    if (!this.directionsManager) return;
    this.directionsManager.updateRouteStyle(style);
  }

  clearAllMarkers() {
    if (!this.map) return;

    // Clear custom markers (only for non-clustered markers)
    this.markerList.forEach(marker => marker.remove());
    this.markerList = [];

    // Clear clustered markers
    if (this.clustering.enabled && this.clusteringManager) {
      this.clusteringManager.clearAllMarkers();
    }

    // Clear fences
    if (this.fenceManager) {
      this.fenceManager.clearAllFences();
    }

    // Clear route
    if (this.directionsManager) {
      this.directionsManager.clearRoute();
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

  async geocode(name) {
    if (!this.geocodingManager) throw new Error('Geocoding manager not initialized');
    return await this.geocodingManager.geocode(name);
  }

  async reverseGeocode(lat, lon) {
    if (!this.geocodingManager) throw new Error('Geocoding manager not initialized');
    return await this.geocodingManager.reverseGeocode(lat, lon);
  }
}

export default GebetaMaps; 