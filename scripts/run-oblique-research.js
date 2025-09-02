#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Script to run the Google Maps 3D/Oblique view research tools
 * 
 * This script can:
 * 1. Cache tiles using the google-oblique-cacher.js script
 * 2. Start the tile server using oblique-tile-server.js
 * 3. Open the example in a browser
 */

const args = process.argv.slice(2);
const command = args[0] || 'server';

function runCommand(cmd, args, options = {}) {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  
  const proc = spawn(cmd, args, {
    stdio: 'inherit',
    ...options
  });
  
  proc.on('error', (err) => {
    console.error(`Failed to start ${cmd}: ${err.message}`);
  });
  
  return proc;
}

function startServer() {
  console.log('Starting oblique tile server...');
  const serverPath = path.join(__dirname, 'oblique-tile-server.js');
  return runCommand('node', [serverPath], { cwd: rootDir });
}

function runCacher() {
  console.log('Starting tile cacher...');
  const cacherPath = path.join(__dirname, 'google-oblique-cacher.js');
  return runCommand('node', [cacherPath], { cwd: rootDir });
}

function openBrowser() {
  const url = 'http://localhost:7070/';
  let openCommand;
  let openArgs;
  
  switch (process.platform) {
    case 'darwin':
      openCommand = 'open';
      openArgs = [url];
      break;
    case 'win32':
      openCommand = 'cmd';
      openArgs = ['/c', 'start', url];
      break;
    default:
      openCommand = 'xdg-open';
      openArgs = [url];
      break;
  }
  
  console.log(`Opening browser at ${url}`);
  return runCommand(openCommand, openArgs);
}

async function main() {
  try {
    switch (command) {
      case 'cache':
        runCacher();
        break;
      
      case 'server':
        startServer();
        // Wait 1 second before opening browser
        setTimeout(() => {
          openBrowser();
        }, 1000);
        break;
      
      case 'all':
        // Run cacher first, then server when cacher completes
        const cacherProc = runCacher();
        cacherProc.on('exit', (code) => {
          console.log(`Cacher exited with code ${code}`);
          if (code === 0) {
            startServer();
            setTimeout(() => {
              openBrowser();
            }, 1000);
          }
        });
        break;
        
      default:
        console.log(`
3D Building Height Research Tool

Usage:
  node run-oblique-research.js [command]

Commands:
  cache   - Run the tile cacher to download tiles
  server  - Start the tile server (default)
  all     - Run cacher, then server when complete
        `);
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();


