import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

/**
 * Test script to try different Google Maps layer types for 3D buildings
 */

// Test different layer types
const layerTypes = [
  'svv',  // Street View vector tiles
  'm',    // Standard roadmap
  'h',    // Roads only
  'e',    // 3D earth
  '3d',   // Possible 3D layer
  'mv',   // Vector map
  'mv1',  // Vector map version 1
];

const testParams = {
  x: 637189,
  y: 498001,
  z: 20,
  pitch: 60,
  heading: 0
};

async function downloadTile(url, outputPath) {
  console.log(`Downloading: ${url}`);
  
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        
        try {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, buffer);
          console.log(`Saved to: ${outputPath}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  const outputDir = path.resolve(process.cwd(), 'test-3d-layers');
  await fs.mkdir(outputDir, { recursive: true });
  
  const { x, y, z, pitch, heading } = testParams;
  
  for (const layer of layerTypes) {
    const subdomain = `mt${Math.floor(Math.random() * 4)}`;
    
    // Try different URL formats
    const urls = [
      // Standard format with layer type
      `https://${subdomain}.google.com/vt/lyrs=${layer}&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}`,
      
      // With 3D style
      `https://${subdomain}.google.com/vt/lyrs=${layer}&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}&style=3d`,
      
      // With 3D and altitude
      `https://${subdomain}.google.com/vt/lyrs=${layer}&x=${x}&y=${y}&z=${z}&s=Ga&heading=${heading}&pitch=${pitch}&style=3d&alt=1000`
    ];
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const outputPath = path.join(outputDir, `${layer}-${i}.png`);
      
      try {
        await downloadTile(url, outputPath);
      } catch (error) {
        console.error(`Failed to download ${url}: ${error.message}`);
      }
    }
  }
  
  console.log('Done testing layer types. Check the test-3d-layers directory.');
}

run().catch(console.error);


