import maplibregl from 'maplibre-gl';
import './style.css';

class GebetaMaps {
  constructor({ apiKey }) {
    if (!apiKey) {
      console.error("An API key is required for Gebeta Maps.");
    }
    this.apiKey = apiKey;
    this.map = null;
    this.fencePoints = [];
    this.fenceSourceId = 'fence';
    this.fenceLayerId = 'fence-fill';
    this.markerList = [];
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

    return this.map;
  }

  on(event, handler) {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.on(event, handler);
  }

  addNavigationControls(position = 'top-right') {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.addControl(new maplibregl.NavigationControl(), position);
  }

  addImageMarker(lngLat, imageUrl, size = [30, 30]) {
    if (!this.map) throw new Error("Map not initialized.");

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

    this.markerList.push(marker);
  }

  addFencePoint(lngLat) {
    if (!this.map) throw new Error("Map not initialized.");

    this.fencePoints.push(lngLat);
    this.addImageMarker(lngLat, 'https://cdn-icons-png.flaticon.com/512/484/484167.png');

    if (this.fencePoints.length >= 3) {
      this.drawFence();
    }
  }

  clearFence() {
    if (!this.map) return;

    this.fencePoints = [];

    if (this.map.getSource(this.fenceSourceId)) {
      this.map.removeLayer(this.fenceLayerId);
      this.map.removeSource(this.fenceSourceId);
    }

    this.markerList.forEach(marker => marker.remove());
    this.markerList = [];
  }

  drawFence() {
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
}

export default GebetaMaps; 