// Minimal XYZ height tile server from a single GeoTIFF (ESM)
// Endpoints:
//  - /tiles/{z}/{x}/{y}.png    → grayscale PNG (meters)
//  - /tiles/{z}/{x}/{y}.json   → {min,max,mean,valid}
//  - /sample?lon=..&lat=..     → {height}

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

const PORT = process.env.PORT || 6971;
const TIFF_PATH = process.env.HEIGHT_TIFF || path.resolve(process.cwd(), 'addis_building_height_2023.tif');
// Optional corrections after reprojection
const LON_SCALE = Number(process.env.LON_SCALE || 1);
const LAT_SCALE = Number(process.env.LAT_SCALE || 1);
const LON_OFFSET = Number(process.env.LON_OFFSET || 0);
const LAT_OFFSET = Number(process.env.LAT_OFFSET || 0);
// Source CRS for the GeoTIFF map coordinates (x,y)
const SRC_PROJ = process.env.SRC_PROJ || '';
const SRC_EPSG = process.env.SRC_EPSG || '';

function tile2long(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function xyzToBBoxWgs84(x, y, z) {
  const minLon = tile2long(x, z);
  const maxLon = tile2long(x + 1, z);
  const maxLat = tile2lat(y, z);
  const minLat = tile2lat(y + 1, z);
  return [minLon, minLat, maxLon, maxLat];
}

function bboxIntersects(a, b) {
  return !(a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]);
}

let tiff, image, width, height, bbox4326, tiePoint, pixelScale, noDataValue, toWgs84, fromWgs84;
let samplesPerPixel = 1, selectedBand = 0;

async function loadTiff() {
  const buf = fs.readFileSync(TIFF_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  tiff = await fromArrayBuffer(ab);
  image = await tiff.getImage();
  width = image.getWidth();
  height = image.getHeight();
  samplesPerPixel = image.getSamplesPerPixel ? image.getSamplesPerPixel() : 1;
  const bboxGb = image.getBoundingBox();
  const fileDirectory = image.fileDirectory || {};
  tiePoint = fileDirectory.ModelTiepoint || null;
  pixelScale = fileDirectory.ModelPixelScale || null;
  noDataValue = image.getGDALNoData();

  // Compute source-space bbox (map units)
  let srcBBox;
  if (tiePoint && pixelScale) {
    const i = tiePoint[0];
    const j = tiePoint[1];
    const x0 = tiePoint[3];
    const y0 = tiePoint[4];
    const resX = pixelScale[0];
    const resY = pixelScale[1];
    const ulX = x0;
    const ulY = y0;
    const lrX = x0 + resX * (width - 1);
    const lrY = y0 - resY * (height - 1);
    const minX = Math.min(ulX, lrX);
    const maxX = Math.max(ulX, lrX);
    const minY = Math.min(ulY, lrY);
    const maxY = Math.max(ulY, lrY);
    srcBBox = [minX, minY, maxX, maxY];
  } else {
    srcBBox = bboxGb;
  }

  // Build projection transforms
  let srcCrs = 'EPSG:32638'; // sensible fallback for Addis (UTM zone 38N)
  if (SRC_PROJ) srcCrs = SRC_PROJ;
  else if (SRC_EPSG) srcCrs = SRC_EPSG;

  const baseToWgs = (pt) => proj4(srcCrs, 'EPSG:4326', pt);
  const baseFromWgs = (pt) => proj4('EPSG:4326', srcCrs, pt);
  const applyOffsets = (lonLat) => [lonLat[0] * LON_SCALE + LON_OFFSET, lonLat[1] * LAT_SCALE + LAT_OFFSET];
  const removeOffsets = (lonLat) => [(lonLat[0] - LON_OFFSET) / LON_SCALE, (lonLat[1] - LAT_OFFSET) / LAT_SCALE];

  toWgs84 = (pt) => applyOffsets(baseToWgs(pt));
  fromWgs84 = (lonLat) => baseFromWgs(removeOffsets(lonLat));

  const bl = toWgs84([srcBBox[0], srcBBox[1]]);
  const tr = toWgs84([srcBBox[2], srcBBox[3]]);
  bbox4326 = [bl[0], bl[1], tr[0], tr[1]];

  // Determine which band to read
  const envBand = process.env.HEIGHT_BAND;
  if (envBand != null && envBand !== '') {
    const b = Number(envBand);
    if (Number.isFinite(b) && b >= 0 && b < samplesPerPixel) selectedBand = b;
  } else if (samplesPerPixel > 1) {
    const cx0 = Math.max(0, Math.floor(width * 0.4));
    const cy0 = Math.max(0, Math.floor(height * 0.4));
    const cx1 = Math.min(width, Math.ceil(width * 0.6));
    const cy1 = Math.min(height, Math.ceil(height * 0.6));
    const window = [cx0, cy0, cx1, cy1];
    let bestBand = 0, bestMean = -Infinity;
    for (let b = 0; b < samplesPerPixel; b++) {
      try {
        const s = await image.readRasters({ window, samples: [b], interleave: true });
        let sum = 0, count = 0;
        for (let i2 = 0; i2 < s.length; i2++) {
          const v = s[i2];
          if (v == null || Number.isNaN(v)) continue;
          if (noDataValue != null && v === Number(noDataValue)) continue;
          sum += v; count++;
        }
        const mean = count ? sum / count : -Infinity;
        if (mean > bestMean) { bestMean = mean; bestBand = b; }
      } catch (_) {}
    }
    selectedBand = bestBand;
  } else {
    selectedBand = 0;
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function lonLatToPixel(lon, lat) {
  if (tiePoint && pixelScale) {
    const i = tiePoint[0];
    const j = tiePoint[1];
    const x0 = tiePoint[3];
    const y0 = tiePoint[4];
    const resX = pixelScale[0];
    const resY = pixelScale[1];
    const src = fromWgs84([lon, lat]);
    const mapX = src[0];
    const mapY = src[1];
    const px = (mapX - x0) / resX + i;
    const py = (y0 - mapY) / resY + j;
    return [px, py];
  }
  const [minLon, minLat, maxLon, maxLat] = bbox4326 || [0,0,0,0];
  const x = (lon - minLon) / (maxLon - minLon) * (width - 1);
  const y = (maxLat - lat) / (maxLat - minLat) * (height - 1);
  return [x, y];
}

function pixelToLonLat(px, py) {
  const [minLon, minLat, maxLon, maxLat] = bbox4326 || [0,0,0,0];
  const lon = minLon + (px / (width - 1)) * (maxLon - minLon);
  const lat = maxLat - (py / (height - 1)) * (maxLat - minLat);
  return [lon, lat];
}

function ringCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}
function approxCentroid(geometry) {
  if (!geometry) return null;
  const type = geometry.type;
  const coords = geometry.coordinates;
  if (type === 'Polygon') return ringCentroid(coords[0]);
  if (type === 'MultiPolygon') return ringCentroid(coords[0][0]);
  if (type === 'Point') return coords;
  return null;
}

async function readWindow(lonMin, latMin, lonMax, latMax) {
  // Convert bounds to pixel window and read raster
  let [x0, y0] = lonLatToPixel(lonMin, latMax);
  let [x1, y1] = lonLatToPixel(lonMax, latMin);
  x0 = Math.floor(clamp(Math.min(x0, x1), 0, width - 1));
  x1 = Math.ceil(clamp(Math.max(x0, x1), 0, width));
  y0 = Math.floor(clamp(Math.min(y0, y1), 0, height - 1));
  y1 = Math.ceil(clamp(Math.max(y0, y1), 0, height));

  if (x1 <= x0 || y1 <= y0) {
    return { data: null, w: 0, h: 0, x0, y0 };
  }

  const w = x1 - x0;
  const h = y1 - y0;
  const window = [x0, y0, x1, y1];
  const samples = await image.readRasters({ window, samples: [selectedBand], interleave: true });
  return { data: samples, w, h, x0, y0 };
}

async function readPoint(lon, lat) {
  // Sample a small 3x3 window around the target pixel and average valid values
  let [px, py] = lonLatToPixel(lon, lat);
  px = Math.round(px);
  py = Math.round(py);
  const x0 = clamp(px - 1, 0, width - 1);
  const y0 = clamp(py - 1, 0, height - 1);
  const x1 = clamp(px + 2, 0, width); // exclusive
  const y1 = clamp(py + 2, 0, height); // exclusive
  if (x1 <= x0 || y1 <= y0) return 0;
  const window = [x0, y0, x1, y1];
  const samples = await image.readRasters({ window, samples: [selectedBand], interleave: true });
  if (!samples || samples.length === 0) return 0;
  let sum = 0, count = 0;
  const noData = noDataValue != null ? Number(noDataValue) : null;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v == null || Number.isNaN(v)) continue;
    if (noData != null && v === noData) continue;
    sum += v; count++;
  }
  if (!count) return 0;
  return sum / count;
}

function resampleTo256(data, w, h, lonMin, latMin, lonMax, latMax) {
  // Nearest-neighbor resample into 256x256 tile
  const out = new Float32Array(256 * 256);
  for (let ty = 0; ty < 256; ty++) {
    for (let tx = 0; tx < 256; tx++) {
      const fx = tx / 255 * (w - 1);
      const fy = ty / 255 * (h - 1);
      const sx = Math.round(fx);
      const sy = Math.round(fy);
      const v = data[sy * w + sx];
      out[ty * 256 + tx] = v;
    }
  }
  return out;
}

function stats(arr, noData) {
  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null || Number.isNaN(v)) continue;
    if (noData != null && v === noData) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    count++;
  }
  return { min: count ? min : null, max: count ? max : null, mean: count ? sum / count : null, count };
}

function encodeGrayscalePng(arr) {
  // Map heights (meters) to 0..255 for visualization; keep 0..100m by default
  // You can adjust scale via env VAR HEIGHT_MAX
  const heightMax = Number(process.env.HEIGHT_MAX || 100);
  const png = new PNG({ width: 256, height: 256, colorType: 6 });
  for (let i = 0; i < 256 * 256; i++) {
    const v = arr[i];
    let g = 0;
    if (v != null && !Number.isNaN(v)) {
      g = Math.max(0, Math.min(255, Math.round((v / heightMax) * 255)));
    }
    const o = i * 4;
    png.data[o] = g;
    png.data[o + 1] = g;
    png.data[o + 2] = g;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

function parseXYZ(urlPath) {
  // /tiles/{z}/{x}/{y}.(png|json)
  const m = urlPath.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.(png|json)$/);
  if (!m) return null;
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), fmt: m[4] };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!image) await loadTiff();

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS
    const baseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        tiff: path.basename(TIFF_PATH),
        width,
        height,
        samplesPerPixel,
        selectedBand,
        bbox4326
      }));
      return;
    }

    if (url.pathname === '/heights/centroid' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 5e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const geo = JSON.parse(body);
          const features = (geo && geo.features) ? geo.features : [];
          const outFeatures = [];
          for (const f of features) {
            const c = approxCentroid(f.geometry);
            let h = null;
            let covered = false;
            if (c) {
              const lon = c[0];
              const lat = c[1];
              const [minLon, minLat, maxLon, maxLat] = bbox4326 || [0,0,0,0];
              covered = lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
              if (covered) {
                try { h = await readPoint(lon, lat); } catch (_) { h = null; }
              }
            }
            outFeatures.push({
              type: 'Feature',
              properties: { ...(f.properties || {}), height: (h != null ? Number(h) : null), covered },
              geometry: f.geometry
            });
          }
          const out = { type: 'FeatureCollection', features: outFeatures };
          res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        } catch (e) {
          res.writeHead(400, { ...baseHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid GeoJSON' }));
        }
      });
      return;
    }

    if (url.pathname === '/sample') {
      const lon = Number(url.searchParams.get('lon'));
      const lat = Number(url.searchParams.get('lat'));
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        const [minLon, minLat, maxLon, maxLat] = bbox4326;
        const covered = lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
        const v = covered ? await readPoint(lon, lat) : null;
        res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' });
        res.end(JSON.stringify({ lon, lat, height: v, covered }));
        return;
      } else {
        res.writeHead(400, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'lon,lat required' }));
        return;
      }
    }

    const xyz = parseXYZ(url.pathname);
    if (!xyz) {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const { x, y, z, fmt } = xyz;
    const [minLon, minLat, maxLon, maxLat] = xyzToBBoxWgs84(x, y, z);
    const coveredTile = bboxIntersects([minLon, minLat, maxLon, maxLat], bbox4326);

    if (!coveredTile) {
      if (fmt === 'json') {
        res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' });
        res.end(JSON.stringify({ z, x, y, covered: false }));
      } else {
        res.writeHead(204, baseHeaders);
        res.end();
      }
      return;
    }

    const { data, w, h } = await readWindow(minLon, minLat, maxLon, maxLat);
    if (!data) {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    const arr = resampleTo256(data, w, h, minLon, minLat, maxLon, maxLat);
    const s = stats(arr, noDataValue);

    if (fmt === 'json') {
      res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' });
      res.end(JSON.stringify({ z, x, y, covered: true, min: s.min, max: s.max, mean: s.mean, valid: s.count }));
      return;
    }

    const png = encodeGrayscalePng(arr);
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
    res.end(png);
  } catch (err) {
    console.error('Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Height tile server running on :${PORT}`);
  console.log(`Using TIFF: ${TIFF_PATH}`);
  console.log('Examples:');
  console.log(`  http://localhost:${PORT}/tiles/18/159294/124505.png`);
  console.log(`  http://localhost:${PORT}/tiles/18/159294/124505.json`);
});


