import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const PORT = 6969;

function main() {
  console.log(`Google Map Oblique View Cache service is running at :${PORT}`);
  http.createServer(handler).listen(PORT, () => {
    console.log(`Server started successfully on port ${PORT}`);
  }).on('error', (err) => {
    console.error(`Failed to start server: ${err.message}`);
  });
}

function handler(req, res) {
  try {
    const { layer, z, x, y, pitch, heading, err } = getParams(req);

    if (err) {
      console.warn(`Invalid request parameters: ${err.message}`);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(err.message);
      return;
    }
    console.log(`Tile requested: layer=${layer}, z=${z}, x=${x}, y=${y}, pitch=${pitch}, heading=${heading}`);

    const dirPath = `./cache/${layer}/${z}/${x}/`;
    const filePath = `./cache/${layer}/${z}/${x}/${y}.png`;

    if (fs.existsSync(filePath)) {
      console.log(`Cache HIT: Serving tile from ${filePath}`);
      serveCachedTile(res, filePath);
    } else {
      console.log(`Cache MISS: Fetching tile from Google Maps`);
      fetchAndCacheTile(res, layer, z, x, y, pitch, heading, dirPath, filePath);
    }
  } catch (error) {
    console.error(`Unexpected error in handler: ${error}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
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

function fetchAndCacheTile(res, layer, z, x, y, pitch, heading, dirPath, filePath) {
  // Force layer to 'm' (roadmap) if not specified, and add style=3d to enable 3D buildings
  const actualLayer = 'm';
  
  // Style parameter for 3D buildings in roadmap view
  const style = "&style=3d&apistyle=s.t:3|p.v:on,s.t:6|p.v:on|p.s:-100,s.t:2|p.v:on|p.s:-100,s.t:1|p.v:on|p.s:-100,s.t:5|p.v:on|p.s:-100,s.t:4|p.v:on|p.s:-100";
  
  // The options with pitch, heading, and 3D style parameters
  const options = {
    hostname: `${randomSubDomain()}.google.com`,
    path: `/vt/lyrs=${actualLayer}&x=${x}&y=${y}&z=${z}&src=api&hl=en-GB&pitch=${pitch}&heading=${heading}${style}`,
    method: 'GET',
    headers: {
      'Referer': 'https://www.google.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  };

  // Use https instead of http for Google Maps requests
  console.log("request url: ", `https://${options.hostname}${options.path}`);
  https.get(options, (response) => {
    if (response.statusCode !== 200) {
      console.log("----------------------------------");
      console.warn(`Failed to fetch tile from Google Maps: ${response.statusCode}`, response.statusMessage, response.statusCode);
      console.log("----------------------------------");
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

    const layer = queries.get('l') || '';
    const zoomString = queries.get('z') || '';
    const xString = queries.get('x') || '';
    const yString = queries.get('y') || '';
    // Added pitch and heading parameters with defaults
    const pitchString = queries.get('pitch') || '75';
    const headingString = queries.get('heading') || '0';

    if (layer.length !== 1 || zoomString.length === 0 || xString.length === 0 || yString.length === 0) {
      return { layer: '', z: 0, x: 0, y: 0, pitch: 75, heading: 0, err: new Error('Parameters are not valid') };
    }

    const z = parseInt(zoomString, 10);
    const x = parseInt(xString, 10);
    const y = parseInt(yString, 10);
    const pitch = parseInt(pitchString, 10);
    const heading = parseInt(headingString, 10);

    if (isNaN(z) || isNaN(x) || isNaN(y) || isNaN(pitch) || isNaN(heading)) {
      return { layer: '', z: 0, x: 0, y: 0, pitch: 75, heading: 0, err: new Error('Parameters are not valid') };
    }

    return { layer, z, x, y, pitch, heading, err: null };
  } catch (error) {
    console.error(`Error parsing request parameters: ${error}`);
    return { layer: '', z: 0, x: 0, y: 0, pitch: 75, heading: 0, err: new Error('Failed to parse request parameters') };
  }
}

function randomSubDomain() {
  return `mt${Math.floor(Math.random() * 4)}`;
}

main();
