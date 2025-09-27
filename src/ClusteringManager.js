import Supercluster from 'supercluster';
import maplibregl from 'maplibre-gl';

class ClusteringManager {
  constructor(map, options = {}) {
    this.map = map;
    this.options = {
      radius: options.radius || 50,
      maxZoom: options.maxZoom || 16,
      clusterImage: options.clusterImage || null,
      clusterOnClick: options.clusterOnClick || null,
      showClusterCount: options.showClusterCount || false,
      ...options
    };
    
    this.markers = [];
    this.supercluster = new Supercluster({
      radius: this.options.radius,
      maxZoom: this.options.maxZoom,
    });
    
    this.renderedMarkers = new Map(); // Track rendered markers by ID
    this.renderedClusters = new Map(); // Track rendered clusters by ID
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Update clustering when map moves or zooms
    this.map.on('moveend', () => {
      this.updateClustering();
    });

    this.map.on('zoomend', () => {
      this.updateClustering();
    });
  }

  addMarker(marker) {
    this.markers.push(marker);
    this.updateClustering();
    return marker;
  }

  removeMarker(markerId) {
    const before = this.markers.length;
    this.markers = this.markers.filter(m => m.id !== markerId);
    const removed = before !== this.markers.length;
    this.updateClustering();
    return removed;
  }

  clearAllMarkers() {
    this.markers = [];
    this.clearRenderedElements();
  }

  clearRenderedElements() {
    // Clear all rendered markers
    this.renderedMarkers.forEach(marker => {
      if (marker && marker.remove) {
        marker.remove();
      }
    });
    this.renderedMarkers.clear();

    // Clear all rendered clusters
    this.renderedClusters.forEach(cluster => {
      if (cluster && cluster.remove) {
        cluster.remove();
      }
    });
    this.renderedClusters.clear();
  }

  updateClustering() {
    if (!this.map || this.markers.length === 0) {
      this.clearRenderedElements();
      return;
    }

    // Clear existing rendered elements
    this.clearRenderedElements();

    // Get current map bounds and zoom
    const bounds = this.map.getBounds();
    const zoom = Math.floor(this.map.getZoom());

    // Convert markers to supercluster format
    const points = this.markers.map(marker => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: marker.lngLat
      },
      properties: {
        markerId: marker.id,
        imageUrl: marker.imageUrl,
        size: marker.size,
        onClick: marker.onClick
      }
    }));

    // Load points into supercluster
    this.supercluster.load(points);

    // Get clusters for current view
    const clusters = this.supercluster.getClusters(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom
    );

    // Render clusters and individual markers
    clusters.forEach(cluster => {
      if (cluster.properties.cluster) {
        // Render cluster
        this.renderCluster(cluster);
      } else {
        // Render individual marker (only if not part of a cluster)
        this.renderIndividualMarker(cluster);
      }
    });
  }

  renderCluster(cluster) {
    const el = document.createElement('div');
    el.className = 'cluster-marker';
    
    // Use custom cluster image if provided, otherwise use default styling
    if (this.options.clusterImage) {
      el.style.cssText = `
        background-image: url('${this.options.clusterImage}');
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        width: 40px;
        height: 40px;
        cursor: pointer;
        position: relative;
      `;
      
      // Add count badge in top-right corner if enabled
      if (this.options.showClusterCount) {
        const countEl = document.createElement('div');
        countEl.style.cssText = `
          position: absolute;
          top: -5px;
          right: -5px;
          background-color: #ff4444;
          color: white;
          font-weight: bold;
          font-size: 10px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          line-height: 1;
        `;
        countEl.textContent = cluster.properties.point_count;
        el.appendChild(countEl);
      }
    } else {
      // Default cluster styling with count
      el.style.cssText = `
        background-color: #51bbd6;
        border-radius: 50%;
        color: white;
        font-weight: bold;
        text-align: center;
        line-height: 40px;
        width: 40px;
        height: 40px;
        cursor: pointer;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      `;
      el.textContent = cluster.properties.point_count;
    }

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(cluster.geometry.coordinates)
      .addTo(this.map);

    // Store reference to remove later
    this.renderedClusters.set(cluster.id, marker);

    // Add click handler
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      
      if (this.options.clusterOnClick) {
        this.options.clusterOnClick(cluster, e);
      } else {
        // Default: zoom into cluster
        const expansionZoom = this.supercluster.getClusterExpansionZoom(cluster.id);
        this.map.easeTo({
          center: cluster.geometry.coordinates,
          zoom: expansionZoom
        });
      }
    });
  }

  renderIndividualMarker(cluster) {
    const marker = this.markers.find(m => m.id === cluster.properties.markerId);
    if (!marker) return;

    const el = document.createElement('div');
    el.style.backgroundImage = `url('${marker.imageUrl}')`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.width = `${marker.size[0]}px`;
    el.style.height = `${marker.size[1]}px`;
    el.style.cursor = 'pointer';

    // Prevent bubbling to map click handlers even if no custom onClick is set
    el.addEventListener('click', (e) => { e.stopPropagation(); });
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    el.addEventListener('touchstart', (e) => { e.stopPropagation(); });

    const mapMarker = new maplibregl.Marker({ element: el })
      .setLngLat(marker.lngLat)
      .addTo(this.map);

    // Store reference to remove later
    this.renderedMarkers.set(marker.id, mapMarker);

    // Add click handler if provided
    if (marker.onClick) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        marker.onClick(marker.lngLat, mapMarker, e);
      });
    }
  }
}

export default ClusteringManager; 