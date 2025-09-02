import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

/**
 * Google Maps Static API 3D Building Downloader
 * 
 * This script uses the Google Maps Static API to download 3D building views
 * at specific locations, angles, and pitches.
 */

// Configuration
const config = {
  outputDir: 'google-3d-buildings',
  apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  locations: [
    // New York City - Empire State Building area
    { lat: 40.7484, lng: -73.9857, name: 'empire_state' },
    // Chicago - Willis Tower area
    { lat: 41.8789, lng: -87.6359, name: 'willis_tower' },
    // San Francisco - Downtown
    { lat: 37.7897, lng: -122.4000, name: 'sf_downtown' },
    // Addis Ababa - Central area
    { lat: 8.9806, lng: 38.7578, name: 'addis_ababa' }
  ],
  headings: [0, 90, 180, 270], // North, East, South, West
  pitches: [45, 60],           // Angles from horizontal
  zoom: 18,                    // Zoom level
  size: '640x640',             // Image size
  mapType: 'satellite',        // satellite, roadmap, terrain, hybrid
  format: 'png',               // png, jpg, etc.
  headers: {
    'Referer': 'https://www.google.com/maps/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
};

// Create output directory
async function createOutputDir() {
  await fs.mkdir(config.outputDir, { recursive: true });
}

// Download an image from a URL
async function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: config.headers }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        
        try {
          await fs.writeFile(outputPath, buffer);
          console.log(`Downloaded: ${outputPath}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

// Build Google Maps Static API URL
function buildStaticMapUrl(location, heading, pitch) {
  // Base URL for Google Maps Static API
  let url = 'https://maps.googleapis.com/maps/api/staticmap?';
  
  // Add parameters
  url += `center=${location.lat},${location.lng}`;
  url += `&zoom=${config.zoom}`;
  url += `&size=${config.size}`;
  url += `&maptype=${config.mapType}`;
  url += `&format=${config.format}`;
  
  // Add 3D view parameters
  url += `&heading=${heading}`;
  url += `&pitch=${pitch}`;
  
  // Add API key if available
  if (config.apiKey) {
    url += `&key=${config.apiKey}`;
  }
  
  return url;
}

// Main function
async function run() {
  try {
    await createOutputDir();
    
    for (const location of config.locations) {
      const locationDir = path.join(config.outputDir, location.name);
      await fs.mkdir(locationDir, { recursive: true });
      
      for (const heading of config.headings) {
        for (const pitch of config.pitches) {
          const url = buildStaticMapUrl(location, heading, pitch);
          const fileName = `${location.name}_h${heading}_p${pitch}.png`;
          const outputPath = path.join(locationDir, fileName);
          
          console.log(`Downloading: ${location.name} at heading=${heading}°, pitch=${pitch}°`);
          console.log(`URL: ${url}`);
          
          try {
            await downloadImage(url, outputPath);
          } catch (error) {
            console.error(`Failed to download ${fileName}: ${error.message}`);
          }
          
          // Add a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
  }
}

run();


