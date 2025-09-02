import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Simple tile cacher for slippy-map XYZ tiles.
 * - Reads config from tile-cacher-config.json at repo root
 * - Expands {z}/{x}/{y} and optional {s} in template
 * - Iterates tiles covering bbox for zoom range
 * - Downloads with basic concurrency and retries
 */

const CONFIG_PATH = path.resolve(process.cwd(), 'tile-cacher-config.json');

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  const cfg = JSON.parse(raw);
  return cfg;
}

function inferExtensionFromTemplate(urlTemplate) {
  if (!urlTemplate) return 'png';
  // Try to infer extension from pattern following {y}
  const m = urlTemplate.match(/\{y\}\.(png|jpg|jpeg|webp|pbf|avif)/i);
  if (m) return m[1].toLowerCase();
  // Fallback to common default
  return 'png';
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

function buildUrl(template, z, x, y, subdomain) {
  let url = template;
  url = url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  if (url.includes('{s}')) {
    url = url.replace('{s}', subdomain ?? '');
  }
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
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
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

  const template = cfg.urlTemplate || cfg.tileSource;
  if (!template) {
    throw new Error('Missing urlTemplate or tileSource in tile-cacher-config.json');
  }

  const outputDir = path.resolve(process.cwd(), cfg.outputDir || 'tiles');
  const minZoom = Number(cfg.minZoom ?? 0);
  const maxZoom = Number(cfg.maxZoom ?? 0);
  const bbox = cfg.bbox; // [minLon, minLat, maxLon, maxLat]
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error('bbox must be an array: [minLon, minLat, maxLon, maxLat]');
  }

  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  const subdomains = Array.isArray(cfg.subdomains) && cfg.subdomains.length > 0
    ? cfg.subdomains
    : ['a', 'b', 'c'];
  const ext = cfg.ext || inferExtensionFromTemplate(template);
  const headers = cfg.headers || {};
  const concurrency = Number(cfg.concurrency || 8);

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

    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        const sub = subdomains[(x + y) % subdomains.length] || '';
        const url = buildUrl(template, z, x, y, sub);
        const filePath = path.join(outputDir, String(z), String(x), `${y}.${ext}`);
        tasks.push({ z, x, y, url, filePath });
      }
    }
  }

  if (tasks.length === 0) {
    console.log('No tiles to download for the given bbox and zoom range.');
    return;
  }

  console.log(`Downloading ${tasks.length} tiles to ${outputDir} with concurrency=${concurrency} ...`);

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
        if (completed % 50 === 0 || completed === total) {
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




