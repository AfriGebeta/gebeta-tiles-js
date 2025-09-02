import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

// Configuration
const PORT = 6970;
const CACHE_DIR = './oblique-cache';
const DEFAULT_PITCH = 45;
const DEFAULT_HEADING = 0;
const DEFAULT_ZOOM = 19;

function main() {
  console.log(`Google Maps Oblique View Tile Cacher running at :${PORT}`);
  
  // Create cache directory if it doesn't exist
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  http.createServer(handler).listen(PORT, () => {
    console.log(`Server started successfully on port ${PORT}`);
    console.log(`Access at http://localhost:${PORT}/`);
    console.log(`Example: http://localhost:${PORT}/?z=${DEFAULT_ZOOM}&x=318583&y=249001&pitch=${DEFAULT_PITCH}&heading=${DEFAULT_HEADING}`);
  }).on('error', (err) => {
    console.error(`Failed to start server: ${err.message}`);
  });
}

function handler(req, res) {
  try {
    // Handle root path with a simple HTML interface
    if (req.url === '/' || req.url === '/index.html') {
      serveHtmlInterface(res);
      return;
    }
    
    const params = getParams(req);
    
    if (params.err) {
      console.warn(`Invalid request parameters: ${params.err.message}`);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(params.err.message);
      return;
    }
    
    const { z, x, y, pitch, heading } = params;
    console.log(`Tile requested: z=${z}, x=${x}, y=${y}, pitch=${pitch}°, heading=${heading}°`);
    
    const dirPath = path.join(CACHE_DIR, `p${pitch}`, `h${heading}`, String(z), String(x));
    const filePath = path.join(dirPath, `${y}.png`);
    
    if (fs.existsSync(filePath)) {
      console.log(`Cache HIT: Serving tile from ${filePath}`);
      serveCachedTile(res, filePath);
    } else {
      console.log(`Cache MISS: Fetching tile from Google Maps`);
      fetchAndCacheTile(res, z, x, y, pitch, heading, dirPath, filePath);
    }
  } catch (error) {
    console.error(`Unexpected error in handler: ${error}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

function serveHtmlInterface(res) {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Google Maps Oblique View Tile Cacher</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
      #map { width: 100%; height: 80vh; }
      .controls { padding: 10px; background: #f8f8f8; }
      h1 { margin: 0; padding: 10px; background: #4285f4; color: white; }
    </style>
  </head>
  <body>
    <h1>Google Maps Oblique View Tile Cacher</h1>
    <div class="controls">
      <label>Zoom: <span id="zoomValue">${DEFAULT_ZOOM}</span></label>
      <label>Pitch: ${DEFAULT_PITCH}°</label>
      <label>Heading: ${DEFAULT_HEADING}°</label>
    </div>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      // Center on Addis Ababa
      const map = L.map('map').setView([8.9806, 38.7578], ${DEFAULT_ZOOM});
      
      // OSM base layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      
      // Oblique view layer
      const obliqueLayer = L.tileLayer('http://localhost:${PORT}/?z={z}&x={x}&y={y}&pitch=${DEFAULT_PITCH}&heading=${DEFAULT_HEADING}', {
        maxZoom: 21,
        tileSize: 256
      });
      
      // Layer control
      const baseLayers = {
        "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        "Oblique View": obliqueLayer
      };
      
      L.control.layers(baseLayers).addTo(map);
      
      // Update zoom display
      map.on('zoomend', function() {
        document.getElementById('zoomValue').textContent = map.getZoom();
      });
    </script>
  </body>
  </html>
  `;
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function serveCachedTile(res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': stat.size.toString(),
      'X-Cache': 'HIT',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error(`Error serving cached tile: ${error}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to serve cached tile');
  }
}

function fetchAndCacheTile(res, z, x, y, pitch, heading, dirPath, filePath) {
  // Use the svv layer type for 3D buildings
  const layerType = 'svv'; 
  
  // Subdomain for load balancing
  const subdomain = randomSubDomain();
  
  // Build URL for Google Maps 3D tiles
  const url = `https://${subdomain}.google.com/vt/lyrs=${layerType}&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}&style=3d`;
  
  console.log(`Requesting: ${url}`);
  
  // Use https for HTTPS URLs
  https.get(url, {
    headers: {
      'Referer': 'https://www.google.com/maps/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  }, (response) => {
    if (response.statusCode !== 200) {
      console.warn(`Failed to fetch tile from Google Maps: ${response.statusCode}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to fetch tile from Google Maps');
      return;
    }

    res.writeHead(200, {
      'Content-Type': response.headers['content-type'] || 'image/png',
      'Content-Length': response.headers['content-length'] || '',
      'X-Cache': 'MISS',
    });

    const body = [];
    response.on('data', (chunk) => body.push(chunk));
    response.on('end', () => {
      const buffer = Buffer.concat(body);
      res.end(buffer);

      try {
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(filePath, buffer);
        console.log(`Tile cached successfully: ${filePath}`);
      } catch (error) {
        console.error(`Failed to cache tile: ${error}`);
      }
    });
  }).on('error', (error) => {
    console.error(`Error fetching tile from Google Maps: ${error}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to fetch tile from Google Maps');
  });
}

function getParams(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queries = url.searchParams;

    const zoomString = queries.get('z') || String(DEFAULT_ZOOM);
    const xString = queries.get('x') || '';
    const yString = queries.get('y') || '';
    const pitchString = queries.get('pitch') || String(DEFAULT_PITCH);
    const headingString = queries.get('heading') || String(DEFAULT_HEADING);

    if (zoomString.length === 0 || xString.length === 0 || yString.length === 0) {
      return { z: 0, x: 0, y: 0, pitch: 0, heading: 0, err: new Error('Required parameters missing') };
    }

    const z = parseInt(zoomString, 10);
    const x = parseInt(xString, 10);
    const y = parseInt(yString, 10);
    const pitch = parseInt(pitchString, 10);
    const heading = parseInt(headingString, 10);

    if (isNaN(z) || isNaN(x) || isNaN(y) || isNaN(pitch) || isNaN(heading)) {
      return { z: 0, x: 0, y: 0, pitch: 0, heading: 0, err: new Error('Parameters are not valid numbers') };
    }

    return { z, x, y, pitch, heading, err: null };
  } catch (error) {
    console.error(`Error parsing request parameters: ${error}`);
    return { z: 0, x: 0, y: 0, pitch: 0, heading: 0, err: new Error('Failed to parse request parameters') };
  }
}

function randomSubDomain() {
  return `mt${Math.floor(Math.random() * 4)}`;
}

main();

