import maplibregl from 'maplibre-gl';
import './style.css';

class GebetaMaps {
  constructor({ apiKey }) {
    this.apiKey = apiKey;
    this.map = null;
    this.fencePoints = [];
    this.fenceLayerId = 'fence-polygon';
  }

  init({ container, center, zoom }) {
    this.map = new maplibregl.Map({
      container,
      style: `https://tiles.gebeta.app/styles/osm-bright/style.json?key=${this.apiKey}`,
      center,
      zoom,
    });
    return this.map;
  }

  addNavigationControls() {
    if (this.map) {
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    }
  }

  addFencePoint(lngLat) {
    this.fencePoints.push(lngLat);
    this._updateFenceLayer();
  }

  clearFence() {
    this.fencePoints = [];
    this._updateFenceLayer();
  }

  _updateFenceLayer() {
    if (!this.map) return;
    // Remove existing layer/source if present
    if (this.map.getLayer(this.fenceLayerId)) {
      this.map.removeLayer(this.fenceLayerId);
    }
    if (this.map.getSource(this.fenceLayerId)) {
      this.map.removeSource(this.fenceLayerId);
    }
    if (this.fencePoints.length < 3) return;
    this.map.addSource(this.fenceLayerId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[...this.fencePoints, this.fencePoints[0]]],
        },
      },
    });
    this.map.addLayer({
      id: this.fenceLayerId,
      type: 'fill',
      source: this.fenceLayerId,
      paint: {
        'fill-color': '#088',
        'fill-opacity': 0.3,
      },
    });
  }

  on(event, handler) {
    if (this.map) {
      this.map.on(event, handler);
    }
  }
}

export default GebetaMaps; 