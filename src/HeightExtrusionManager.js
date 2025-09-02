export default class HeightExtrusionManager {
  constructor(map, { heightServerUrl = 'http://localhost:6971', year = 2023, maxHeight = 100 } = {}) {
    this.map = map;
    this.heightServerUrl = heightServerUrl.replace(/\/$/, '');
    this.year = year;
    this.maxHeight = maxHeight;
    this._geoSourceId = 'gebeta-height-extrusions-src';
    this._layerId = 'gebeta-height-extrusions';
  }

  async init(buildingsSourceId = 'openmaptiles', buildingsLayer = 'building') {
    if (!this.map) return;

    // Create a dedicated GeoJSON source for extrusions
    if (!this.map.getSource(this._geoSourceId)) {
      this.map.addSource(this._geoSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!this.map.getLayer(this._layerId)) {
      this.map.addLayer({
        id: this._layerId,
        type: 'fill-extrusion',
        source: this._geoSourceId,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'height'],
            0, '#d9d9d9',
            10, '#c6dbef',
            30, '#9ecae1',
            60, '#6baed6',
            100, '#3182bd'
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
          'fill-extrusion-opacity': 0.85
        }
      }); // on top
    }

    const debounced = this._debounce(() => this._buildGeojsonFromBuildings(buildingsLayer), 500);
    // Only trigger on moveend to avoid polling while dragging/zooming; remove sourcedata spam
    this.map.on('moveend', debounced);

    await this._buildGeojsonFromBuildings(buildingsLayer);
  }

  async _buildGeojsonFromBuildings(buildingsLayer) {
    if (!this.map || this.map.getZoom() < 14) return;
    const features = this.map.queryRenderedFeatures({ layers: [buildingsLayer] });
    if (!features || features.length === 0) return;

    // Limit to avoid huge batches
    const limit = Math.min(features.length, 800);
    const selected = features.slice(0, limit);

    // Sample height at centroid with small concurrency limit and memoized cache
    const concurrency = 10;
    let idx = 0;
    const results = [];
    const run = async () => {
      while (idx < selected.length) {
        const i = idx++;
        const f = selected[i];
        const centroid = this._approxCentroid(f.geometry);
        let height = 0;
        if (centroid) {
          try { height = this._clampHeight(await this._sampleHeightMemo(centroid[0], centroid[1])); } catch (_) {}
        }
        results[i] = { geometry: f.geometry, height };
      }
    };
    await Promise.all(Array.from({ length: concurrency }, run));

    const fc = {
      type: 'FeatureCollection',
      features: results.filter(Boolean).map((r) => ({ type: 'Feature', properties: { height: r.height }, geometry: r.geometry }))
    };
    const src = this.map.getSource(this._geoSourceId);
    if (src && src.setData) src.setData(fc);
  }

  async _sampleHeightAtLonLat(lon, lat) {
    const url = `${this.heightServerUrl}/sample?lon=${lon}&lat=${lat}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('height fetch failed');
    const json = await res.json();
    return Number(json.height) || 0;
  }

  async _sampleHeightMemo(lon, lat) {
    if (!this._heightCache) this._heightCache = new Map();
    // Round to ~1 meter at equator (~1e-5 deg) to reduce duplicate requests
    const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
    const existing = this._heightCache.get(key);
    if (existing && existing.status === 'done') return existing.value;
    if (existing && existing.status === 'pending') return existing.promise;
    const promise = this._sampleHeightAtLonLat(lon, lat).then((v) => {
      this._heightCache.set(key, { status: 'done', value: v });
      return v;
    }).catch((e) => {
      this._heightCache.delete(key);
      return 0;
    });
    this._heightCache.set(key, { status: 'pending', promise });
    return promise;
  }

  _approxCentroid(geometry) {
    if (!geometry) return null;
    const type = geometry.type;
    const coords = geometry.coordinates;
    if (type === 'Polygon') {
      return this._ringCentroid(coords[0]);
    }
    if (type === 'MultiPolygon') {
      return this._ringCentroid(coords[0][0]);
    }
    if (type === 'Point') return coords;
    return null;
  }

  _ringCentroid(ring) {
    if (!ring || ring.length === 0) return null;
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
  }

  _clampHeight(h) { return Math.max(0, Math.min(this.maxHeight, h || 0)); }

  _findTopSymbolLayerId() {
    const layers = this.map.getStyle().layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].type === 'symbol') return layers[i].id;
    }
    return null;
  }

  _debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
}
