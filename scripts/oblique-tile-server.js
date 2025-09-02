import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 7070;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILES_DIR = path.resolve(__dirname, '..', 'google-oblique-tiles');
const CONFIG_PATH = path.resolve(__dirname, '..', 'google-oblique-config.json');

// Load config
let config;
try {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(configData);
} catch (err) {
  console.error(`Error loading config: ${err.message}`);
  config = {
    pitch: 45,
    headings: [0, 90, 180, 270],
    mapType: 'satellite',
    headers: {
      'Referer': 'https://www.google.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  };
}

function randomSubDomain() {
  return `mt${Math.floor(Math.random() * 4)}`;
}

function buildGoogleObliqueUrl(z, x, y, options = {}) {
  const subdomain = randomSubDomain();
  
  // Add pitch and heading parameters
  const pitch = options.pitch || config.pitch || 45;
  const heading = options.heading || 0;
  
  // For 3D buildings, we'll try different approaches based on mapType
  const mapType = options.mapType || config.mapType || 'earth';
  
  // If using Earth view (which has better 3D buildings)
  if (mapType === 'earth') {
    // Google Earth tiles use a different endpoint and parameters
    // This is based on the actual requests Google Earth makes
    return `https://khmdb.google.com/kh?v=928&hl=en&x=${x}&y=${y}&z=${z}&s=Gal&angle=${pitch}&heading=${heading}`;
  }
  
  // For standard Google Maps views
  let layerType;
  if (mapType === '3d') {
    layerType = 'svv'; // Street View vector tiles
  } else if (mapType === 'satellite') {
    layerType = 's';
  } else if (mapType === 'hybrid') {
    layerType = 'y';
  } else {
    layerType = 'm'; // Default to roadmap
  }
  
  // Build URL with the correct parameters for 3D view
  return `https://${subdomain}.google.com/vt/lyrs=${layerType}&hl=en&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}&style=3d`;
}

function parseUrl(url) {
  // Parse URLs with heading and pitch: /h90/p45/18/123456/78910.png
  const fullRegex = /\/h(\d+)\/p(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
  const fullMatch = url.match(fullRegex);
  
  if (fullMatch) {
    return {
      heading: parseInt(fullMatch[1], 10),
      pitch: parseInt(fullMatch[2], 10),
      z: parseInt(fullMatch[3], 10),
      x: parseInt(fullMatch[4], 10),
      y: parseInt(fullMatch[5], 10)
    };
  }
  
  // Parse URLs with heading only: /h90/18/123456/78910.png
  const headingRegex = /\/h(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
  const headingMatch = url.match(headingRegex);
  
  if (headingMatch) {
    return {
      heading: parseInt(headingMatch[1], 10),
      pitch: 45, // Default pitch
      z: parseInt(headingMatch[2], 10),
      x: parseInt(headingMatch[3], 10),
      y: parseInt(headingMatch[4], 10)
    };
  }
  
  // Parse URLs with pitch only: /p45/18/123456/78910.png
  const pitchRegex = /\/p(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
  const pitchMatch = url.match(pitchRegex);
  
  if (pitchMatch) {
    return {
      heading: 0, // Default heading
      pitch: parseInt(pitchMatch[1], 10),
      z: parseInt(pitchMatch[2], 10),
      x: parseInt(pitchMatch[3], 10),
      y: parseInt(pitchMatch[4], 10)
    };
  }
  
  // Try standard format /18/123456/78910.png (default heading 0, pitch 45)
  const standardRegex = /\/(\d+)\/(\d+)\/(\d+)\.png$/;
  const standardMatch = url.match(standardRegex);
  
  if (standardMatch) {
    return {
      heading: 0,
      pitch: 45,
      z: parseInt(standardMatch[1], 10),
      x: parseInt(standardMatch[2], 10),
      y: parseInt(standardMatch[3], 10)
    };
  }
  
  return null;
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

function fetchAndCacheTile(res, z, x, y, heading, pitch, dirPath, filePath) {
  const url = buildGoogleObliqueUrl(z, x, y, { heading, pitch });
  
  const options = {
    headers: config.headers || {
      'Referer': 'https://www.google.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  };

  console.log(`Fetching: ${url}`);
  
  // Use https for https URLs
  const httpModule = url.startsWith('https://') ? https : http;
  
  httpModule.get(url, options, (response) => {
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

// Create HTTP server
const server = http.createServer((req, res) => {
  try {
    // Serve HTML files
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, '..', 'examples', 'oblique-view.html');
      fs.readFile(htmlPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
      return;
    }
    
    // Handle tile requests
    const tileInfo = parseUrl(req.url);
    
    if (tileInfo) {
      const { heading, pitch, z, x, y } = tileInfo;
      
      // Determine file path based on heading and pitch
      let dirPath;
      if (heading !== 0 && pitch !== 45) {
        dirPath = path.join(TILES_DIR, `h${heading}`, `p${pitch}`, String(z), String(x));
      } else if (heading !== 0) {
        dirPath = path.join(TILES_DIR, `h${heading}`, String(z), String(x));
      } else if (pitch !== 45) {
        dirPath = path.join(TILES_DIR, `p${pitch}`, String(z), String(x));
      } else {
        dirPath = path.join(TILES_DIR, String(z), String(x));
      }
      
      const filePath = path.join(dirPath, `${y}.png`);
      
      // Check if tile exists in cache
      if (fs.existsSync(filePath)) {
        console.log(`Cache HIT: ${filePath}`);
        serveCachedTile(res, filePath);
      } else {
        console.log(`Cache MISS: Fetching tile z=${z}, x=${x}, y=${y}, heading=${heading}, pitch=${pitch}`);
        fetchAndCacheTile(res, z, x, y, heading, pitch, dirPath, filePath);
      }
      return;
    }
    
    // Handle other static files
    const staticFilePath = path.join(__dirname, '..', req.url);
    if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
      const ext = path.extname(staticFilePath);
      let contentType = 'text/plain';
      
      switch (ext) {
        case '.html': contentType = 'text/html'; break;
        case '.css': contentType = 'text/css'; break;
        case '.js': contentType = 'application/javascript'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': case '.jpeg': contentType = 'image/jpeg'; break;
      }
      
      const fileStream = fs.createReadStream(staticFilePath);
      res.writeHead(200, { 'Content-Type': contentType });
      fileStream.pipe(res);
      return;
    }
    
    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    
  } catch (error) {
    console.error(`Server error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Oblique tile server running at http://localhost:${PORT}/`);
  console.log(`View the demo at http://localhost:${PORT}/`);
});
