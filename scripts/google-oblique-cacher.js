import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

/**
 * Google Maps 3D/Oblique View Tile Cacher
 * - Supports 45-degree oblique view for 3D building information
 * - Reads config from google-oblique-config.json
 * - Expands {z}/{x}/{y} and optional {s} in template
 * - Adds pitch and heading parameters for oblique view
 * - Downloads with basic concurrency and retries
 */

const CONFIG_PATH = path.resolve(process.cwd(), 'google-oblique-config.json');

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read config: ${error.message}`);
    console.log('Creating default config file...');
    const defaultConfig = {
      outputDir: "google-oblique-tiles",
      minZoom: 18,
      maxZoom: 20,
      pitch: 45,
      heading: 0,
      apiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      headers: {
        "Referer": "https://www.google.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      bbox: [
        38.72049893131413,
        8.980036135181733,
        38.78679407450473,
        8.994278667400199
      ],
      concurrency: 4,
      mapType: "satellite"
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
}

function lonLatToTileXY(longitude, latitude, zoom) {
  const latRad = (latitude * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomSubDomain() {
  return `mt${Math.floor(Math.random() * 4)}`;
}

function buildGoogleObliqueUrl(z, x, y, cfg) {
  // Google Maps API URL for 3D view
  const subdomain = randomSubDomain();
  
  // Add pitch and heading parameters for oblique view
  const pitch = cfg.pitch || 45; // Default 45 degrees
  const heading = cfg.heading || 0; // Default north (0 degrees)
  
  // For 3D buildings, we'll try different approaches based on mapType
  
  // If using Earth view (which has better 3D buildings)
  if (cfg.mapType === 'earth') {
    // Google Earth tiles use a different endpoint and parameters
    // This is based on the actual requests Google Earth makes
    const url = `https://khmdb.google.com/kh?v=928&hl=en&x=${x}&y=${y}&z=${z}&s=Gal&angle=${pitch}&heading=${heading}`;
    console.log(`Requesting Earth 3D tile: z=${z}, x=${x}, y=${y}, heading=${heading}°, pitch=${pitch}°`);
    return url;
  }
  
  // For standard Google Maps views
  let layerType;
  if (cfg.mapType === '3d') {
    layerType = 'svv'; // Street View vector tiles
  } else if (cfg.mapType === 'satellite') {
    layerType = 's';
  } else if (cfg.mapType === 'hybrid') {
    layerType = 'y';
  } else {
    layerType = 'm'; // Default to roadmap
  }
  
  // Build URL with the correct parameters for 3D view
  const url = `https://${subdomain}.google.com/vt/lyrs=${layerType}&hl=en&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}&style=3d`;
  
  console.log(`Requesting Maps 3D tile: z=${z}, x=${x}, y=${y}, heading=${heading}°, pitch=${pitch}°, layer=${layerType}`);
  return url;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      // Use native https module for HTTPS URLs
      if (url.startsWith('https://')) {
        const buf = await new Promise((resolve, reject) => {
          https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
        });
        return buf;
      } else {
        // Use fetch for other URLs
        const res = await fetch(url, options);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return buf;
      }
    } catch (err) {
      lastError = err;
      const delayMs = 300 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

async function run() {
  const cfg = await readConfig();

  const outputDir = path.resolve(process.cwd(), cfg.outputDir || 'google-oblique-tiles');
  const minZoom = Number(cfg.minZoom ?? 18); // Default to higher zoom for 3D buildings
  const maxZoom = Number(cfg.maxZoom ?? 20);
  const bbox = cfg.bbox; // [minLon, minLat, maxLon, maxLat]
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error('bbox must be an array: [minLon, minLat, maxLon, maxLat]');
  }

  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  const headers = cfg.headers || {
    'Referer': 'https://www.google.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };
  const concurrency = Number(cfg.concurrency || 4);
  const ext = 'png';

  // Build tasks
  const tasks = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const n = 2 ** z;
    const { x: xMin0 } = lonLatToTileXY(minLon, minLat, z);
    const { x: xMax0 } = lonLatToTileXY(maxLon, maxLat, z);
    const { y: ySouth0 } = lonLatToTileXY(minLon, minLat, z);
    const { y: yNorth0 } = lonLatToTileXY(minLon, maxLat, z);

    const xMin = clamp(Math.min(xMin0, xMax0), 0, n - 1);
    const xMax = clamp(Math.max(xMin0, xMax0), 0, n - 1);
    const yMin = clamp(Math.min(yNorth0, ySouth0), 0, n - 1); // north
    const yMax = clamp(Math.max(yNorth0, ySouth0), 0, n - 1); // south

    // For each heading direction (optional)
    const headings = cfg.headings || [0]; // Default to North only
    const pitches = cfg.pitches || [45]; // Default to 45 degrees
    
    for (const heading of headings) {
      for (const pitch of pitches) {
        for (let x = xMin; x <= xMax; x += 1) {
          for (let y = yMin; y <= yMax; y += 1) {
            // Create URL with oblique parameters
            const url = buildGoogleObliqueUrl(z, x, y, { ...cfg, heading, pitch });
            
            // Add heading and pitch to file path
            let dirPath;
            if (headings.length > 1 && pitches.length > 1) {
              dirPath = path.join(outputDir, `h${heading}`, `p${pitch}`, String(z), String(x));
            } else if (headings.length > 1) {
              dirPath = path.join(outputDir, `h${heading}`, String(z), String(x));
            } else if (pitches.length > 1) {
              dirPath = path.join(outputDir, `p${pitch}`, String(z), String(x));
            } else {
              dirPath = path.join(outputDir, String(z), String(x));
            }
            
            const fileName = `${y}.${ext}`;
            const filePath = path.join(dirPath, fileName);
            tasks.push({ z, x, y, url, filePath, heading, pitch });
          }
        }
      }
    }
  }

  if (tasks.length === 0) {
    console.log('No tiles to download for the given bbox and zoom range.');
    return;
  }

  console.log(`Downloading ${tasks.length} oblique view tiles to ${outputDir} with concurrency=${concurrency} ...`);
  console.log(`Using pitch=${cfg.pitch}° and heading(s)=${cfg.headings || [0]}°`);

  let completed = 0;
  const total = tasks.length;

  const worker = async () => {
    for (;;) {
      const next = tasks.pop();
      if (!next) return;
      const { url, filePath } = next;
      try {
        if (await fileExists(filePath)) {
          completed += 1;
          continue;
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const buf = await fetchWithRetry(url, { headers }, 3);
        await fs.writeFile(filePath, buf);
        completed += 1;
        if (completed % 10 === 0 || completed === total) {
          console.log(`Progress: ${completed}/${total}`);
        }
      } catch (err) {
        completed += 1;
        console.warn(`Failed: ${url} -> ${filePath}: ${err.message}`);
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
