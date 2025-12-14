# Gebeta Maps Library

A JavaScript mapping library that provides an easy-to-use interface for creating interactive maps with advanced features like marker clustering, fence drawing, and custom markers.

## Features

- **Marker Clustering**: Automatic clustering of nearby markers with configurable radius and zoom levels
- **Fence Drawing**: Interactive polygon drawing with dynamic preview and multi-fence support
- **Custom Markers**: Support for custom marker images and click handlers
- **Navigation & Tracking**: Turn-by-turn navigation with automatic GPS tracking and WebSocket location updates
- **Turn-by-Turn Instructions**: Detailed navigation instructions with icons from Valhalla routing API
- **Style Selector**: Built-in style selector with popup menu to switch between standard vector, satellite, and terrain views
- **Custom Map Styles**: Support for custom style URLs and inline style JSON objects
- **API Key Authentication**: Secure tile access with Bearer token authentication
- **Modular Architecture**: Clean separation of concerns with dedicated managers for clustering and fence functionality

## Quick Start

### Installation

Include the library from the CDN:

```html
<link rel="stylesheet" href="https://tiles.gebeta.app/static/gebeta-maps-lib.css" />
<script type="module" src="https://tiles.gebeta.app/static/gebeta-maps.umd.js"></script>
```

### Basic Usage

```javascript
const gebetaMap = new GebetaMaps({ 
    apiKey: "YOUR_API_KEY" 
});

const map = gebetaMap.init({
    container: 'map',
    center: [38.7685, 9.0161],
    zoom: 15
});
```

## Examples

### Core Features - Fence Drawing
[examples/core.html](examples/core.html)

Demonstrates the core fence drawing functionality:
- Interactive polygon drawing with dynamic preview
- Multi-fence support with automatic storage
- Click-to-close fence functionality
- Point-in-polygon detection for starting new fences
- Custom color support and default color configuration

### Advanced Fence Styling
[examples/fence-styling.html](examples/fence-styling.html)

Showcases comprehensive fence styling capabilities:
- **Fill Styling**: Custom fill colors and opacity
- **Line Styling**: Width, opacity, dash patterns, line caps, and joins
- **Border Styling**: Separate border colors, widths, and opacity
- **Style Presets**: Quick application of predefined styles (Bold, Subtle, Neon, Vintage, Minimal)
- **Real-time Updates**: Live preview of style changes while drawing
- **Style Inheritance**: New fences automatically inherit current style settings

### Custom Markers
[examples/markers.html](examples/markers.html)

Shows custom marker capabilities:
- Custom marker images and sizes
- Click handlers for markers
- Different marker types and interactions

### Marker Clustering
[examples/clustering.html](examples/clustering.html)

Demonstrates advanced clustering features:
- Automatic marker clustering with configurable radius
- Custom cluster images and click handlers
- Real-time clustering settings adjustment
- Cluster count badge toggles

### Custom Map Styles
[examples/custom-style.html](examples/custom-style.html)

Shows how to use custom map styles and the style selector:
- Switching between standard vector, satellite, and terrain views using the built-in style selector
- Using custom style URLs (enter a URL string directly)
- Loading and applying styles exported from the Playground (paste JSON)
- Style selector popup menu with preview images for each style

## API Reference

### Constructor Options

```javascript
const gebetaMap = new GebetaMaps({
    apiKey: "YOUR_API_KEY",
    clustering: {
        enabled: false,
        radius: 50,
        maxZoom: 16,
        clusterImage: null,
        showClusterCount: false,
        clusterOnClick: (cluster, event) => {}
    }
});

// Initialize fence manager with custom default color
gebetaMap.initFenceManager('#ff6600'); // Orange default color
```

### Core Methods

#### Map Initialization
- `init(options)` - Initialize the map
- `on(event, handler)` - Add event listeners to the map
- `addNavigationControls(position)` - Add zoom/pan controls (can also be enabled via `init()` options)

**Navigation Controls (Zoom +/- buttons)**

You can enable the MapLibre zoom controls (+/- buttons) in two ways:

**Option 1: Enable via `init()` options (recommended)**

```javascript
const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 12,
  navigationControl: true,  // Enable zoom controls
  navigationControlPosition: 'top-right'  // Optional: position (default: 'top-right')
});
```

**Option 2: Add manually after initialization**

```javascript
const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 12
});

map.on('load', () => {
  gebetaMap.addNavigationControls('top-right');  // Position: 'top-right', 'top-left', 'bottom-right', 'bottom-left'
});
```

##### Custom Map Styles

By default, Gebeta Maps uses the standard vector style:

```text
https://tiles.gebeta.app/styles/standard/style.json
```

You can override this and provide your own **style URL** or full **style JSON** when calling `init`.

**Using a custom style URL**

```javascript
const gebetaMap = new GebetaMaps({
  apiKey: 'YOUR_API_KEY',
});

const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 13,

  // Custom style URL (vector or raster)
  styleUrl: 'https://tiles.gebeta.app/styles/raster/raster.json'
});
```

The raster style above (`https://tiles.gebeta.app/styles/raster/raster.json`) is a **satellite with labels** style that combines raster imagery with vector labels. See the JSON at [`https://tiles.gebeta.app/styles/raster/raster.json`](https://tiles.gebeta.app/styles/raster/raster.json).

**Using a full style JSON object**

You can also pass a full MapLibre style JSON object directly:

```javascript
import customStyle from './my-custom-style.json';

const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 13,

  // Inline style JSON
  style: customStyle
});
```

Only one of `style` or `styleUrl` should be provided; if both are present, `style` takes precedence. If neither is provided, the SDK falls back to the default Gebeta standard style.

**Designing styles with the Playground**

You can visually design and export custom styles using the Gebeta Maps Playground:

- Playground: [`https://playground.tiles.gebeta.app/`](https://playground.tiles.gebeta.app/)

From there you can:
- Tweak colors for background, roads, buildings, parks, and water
- Export the generated style JSON
- Use the exported JSON with the `style` option shown above

##### Style Selector Control

The SDK includes a built-in style selector that allows users to switch between standard vector, satellite, and terrain views. When enabled, a small rounded button appears at the bottom-right of the map. Clicking it opens a popup menu with all three style options.

**Basic usage:**

```javascript
const gebetaMap = new GebetaMaps({
  apiKey: 'YOUR_API_KEY',
});

const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 12,
  satelliteToggle: true  // Enable the style selector (kept for backward compatibility)
});
```

The style selector provides access to three map styles:
- **Standard view**: `https://tiles.gebeta.app/styles/standard/style.json` - Vector map with labels
- **Satellite view**: `https://tiles.gebeta.app/styles/raster/raster.json` - Satellite imagery with labels
- **Terrain view**: `https://tiles.gebeta.app/styles/standard/terrain/terrain.json` - Vector map with terrain/elevation

**Customizing style selector options:**

You can customize the style URLs and button images:

```javascript
const map = gebetaMap.init({
  container: 'map',
  center: [38.7685, 9.0161],
  zoom: 12,
  satelliteToggle: true,
  satelliteToggleOptions: {
    standardStyleUrl: 'https://tiles.gebeta.app/styles/standard/style.json',
    satelliteStyleUrl: 'https://tiles.gebeta.app/styles/raster/raster.json',
    terrainStyleUrl: 'https://tiles.gebeta.app/styles/standard/terrain/terrain.json',
    standardImageUrl: 'https://tiles.gebeta.app/static/standard.jpg',
    satelliteImageUrl: 'https://tiles.gebeta.app/static/satellite.jpg',
    terrainImageUrl: 'https://tiles.gebeta.app/static/terrain.jpg'
  }
});
```

The selector button displays a preview image of the currently active style. Clicking it opens a popup menu showing all available styles with preview images. Selecting a style instantly switches the map view.

#### Markers
- `addImageMarker(lngLat, imageUrl, size, onClick, zIndex, popupHtml, options)` - Add a custom marker. Optionally attach a popup with HTML content. You may pass `options.id` to set a custom marker ID. Returns `{ marker, popup, id }`.
- `removeMarker(markerId)` - Remove a specific marker by its ID. Returns `true` if successful, `false` if marker not found.
- `clearAllMarkers()` - Remove all markers from the map

#### Fence Drawing
- `addFencePoint(lngLat, customImage, onClick, color, options)` - Add a point to the current fence with optional custom color. You may pass `options.markerId` for the first point marker ID.
- `renderFencesFromArray(fences, options)` - Supports fence objects with `{ id, name, points, color, borderColor, overlayHtml, overlayOptions, markerId }`. The `id` is used as the fence ID.
- `removeFence(fenceId)` - Remove a specific fence by its ID. Returns `true` if successful, `false` if fence not found.
- `removeFenceByName(name)` - Remove a specific fence by its name. Returns `true` if successful, `false` if fence not found.
- `clearFence()` - Clear the current fence being drawn
- `clearAllFences()` - Clear all fences on the map
- `isFenceCompleted()` - Check if the current fence is complete
- `isPointInsideFence(lngLat)` - Test if a point is inside the current fence
- `getFencePoints()` - Get current fence points
- `getFences()` - Get all stored fences
- `setFenceDefaultColor(color)` - Set the default color for new fences

#### Advanced Fence Styling
- `setFenceStyle(styleOptions)` - Set comprehensive fence style options
- `setFenceFillColor(color)` - Set fence fill color
- `setFenceFillOpacity(opacity)` - Set fence fill opacity (0-1)
- `setFenceLineColor(color)` - Set fence line color
- `setFenceLineWidth(width)` - Set fence line width in pixels
- `setFenceLineOpacity(opacity)` - Set fence line opacity (0-1)
- `setFenceLineDashArray(dashArray)` - Set fence line dash pattern
- `setFenceLineCap(cap)` - Set fence line cap ('butt', 'round', 'square')
- `setFenceLineJoin(join)` - Set fence line join ('bevel', 'round', 'miter')
- `setFenceBorderColor(color)` - Set fence border color
- `setFenceBorderWidth(width)` - Set fence border width in pixels
- `setFenceBorderOpacity(opacity)` - Set fence border opacity (0-1)
- `getFenceStyle()` - Get current fence style configuration
- `getDefaultFenceStyle()` - Get default fence style configuration
- `resetFenceStyle()` - Reset fence style to defaults

## Configuration

### Clustering Configuration

```javascript
const clusteringConfig = {
    enabled: true,           // Enable/disable clustering
    radius: 50,             // Cluster radius in pixels
    maxZoom: 16,            // Maximum zoom level for clustering
    clusterImage: null,     // Custom cluster image URL
    showClusterCount: false, // Show count badge on custom images
    clusterOnClick: (cluster, event) => {
        // Custom cluster click handler
    }
};
```

### Fence Drawing Features

- **Dynamic Preview**: Colored dashed line follows cursor while drawing
- **Multi-Fence Support**: Store and display multiple fences simultaneously
- **Auto-Completion**: Click on existing points to close fences
- **Smart Detection**: Automatically start new fences when clicking outside completed ones
- **Color Customization**: Support for custom colors per fence and default color configuration
- **Advanced Styling**: Comprehensive styling options for fill, lines, and borders including opacity, dash patterns, line caps, and joins

### Fence Styling

The fence manager now supports comprehensive styling options for creating beautiful, professional-looking fence boundaries.

#### Advanced Styling Methods

```javascript
// Set comprehensive fence style
gebetaMap.setFenceStyle({
    fillColor: '#ff0000',        // Fill color
    fillOpacity: 0.3,            // Fill opacity (0-1)
    lineColor: '#ff0000',        // Line color
    lineWidth: 2,                // Line width in pixels
    lineOpacity: 1,              // Line opacity (0-1)
    lineDashArray: [2, 2],       // Dash pattern [dash, gap]
    lineCap: 'round',            // Line cap: 'butt', 'round', 'square'
    lineJoin: 'round',           // Line join: 'bevel', 'round', 'miter'
    borderColor: '#ff0000',      // Border color
    borderWidth: 1,              // Border width in pixels
    borderOpacity: 0.8           // Border opacity (0-1)
});

// Individual style property setters
gebetaMap.setFenceFillColor('#00ff00');           // Set fill color
gebetaMap.setFenceFillOpacity(0.5);              // Set fill opacity
gebetaMap.setFenceLineColor('#0000ff');          // Set line color
gebetaMap.setFenceLineWidth(4);                  // Set line width
gebetaMap.setFenceLineOpacity(0.8);              // Set line opacity
gebetaMap.setFenceLineDashArray([5, 2, 1, 2]);  // Set dash pattern
gebetaMap.setFenceLineCap('square');             // Set line cap
gebetaMap.setFenceLineJoin('miter');             // Set line join
gebetaMap.setFenceBorderColor('#cc0000');        // Set border color
gebetaMap.setFenceBorderWidth(2);                // Set border width
gebetaMap.setFenceBorderOpacity(0.9);            // Set border opacity
```

#### Style Presets

```javascript
// Quick preset styles
gebetaMap.setFenceStyle({
    // Bold style
    fillColor: '#ff0000',
    fillOpacity: 0.5,
    lineColor: '#ff0000',
    lineWidth: 4,
    lineOpacity: 1,
    lineDashArray: [],           // Solid line
    lineCap: 'round',
    lineJoin: 'round',
    borderColor: '#cc0000',
    borderWidth: 2,
    borderOpacity: 1
});

// Subtle style
gebetaMap.setFenceStyle({
    fillColor: '#666666',
    fillOpacity: 0.1,
    lineColor: '#666666',
    lineWidth: 1,
    lineOpacity: 0.6,
    lineDashArray: [3, 3],       // Dashed line
    lineCap: 'butt',
    lineJoin: 'bevel',
    borderColor: '#999999',
    borderWidth: 0.5,
    borderOpacity: 0.4
});
```

#### Style Management

```javascript
// Get current fence style
const currentStyle = gebetaMap.getFenceStyle();

// Get default fence style
const defaultStyle = gebetaMap.getDefaultFenceStyle();

// Reset to default style
gebetaMap.resetFenceStyle();
```

### Fence Color Management

The fence manager supports flexible color customization:

#### Setting Custom Colors
```javascript
// Add a fence point with a specific color
gebetaMap.addFencePoint(
    [38.7685, 9.0161],
    customImage,
    onClickHandler,
    '#0066cc' // Blue color
);

// Set default color for all new fences
gebetaMap.setFenceDefaultColor('#00cc00'); // Green
```

#### Color Options
- **Hex Colors**: Use any valid hex color code (e.g., `#ff0000`, `#00ff00`)
- **Default Color**: Initialize with a custom default color
- **Per-Fence Colors**: Each fence can have its own unique color
- **Color Persistence**: Colors are preserved when storing multiple fences

#### Example: Random Colors
```javascript
// Generate random colors for each new fence
function generateRandomColor() {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Use random color for new fence
gebetaMap.addFencePoint(lngLat, null, null, generateRandomColor());
```

## Architecture

The library uses a modular architecture with dedicated managers:

- **GebetaMaps**: Main class that orchestrates all functionality
- **ClusteringManager**: Handles marker clustering logic and rendering
- **FenceManager**: Manages fence drawing, storage, and rendering

This separation ensures clean code organization and makes the library easy to extend and maintain.

## License

This library is provided by Gebeta Maps. Please refer to the Gebeta Maps terms of service for usage rights and restrictions.

## Support

For support and documentation, visit [gebetamaps.com](https://gebetamaps.com)

## Navigation & Tracking

The SDK provides navigation and tracking with automatic location updates and turn-by-turn instructions.

See [Navigation & Tracking Usage Guide](NAVIGATION_USAGE.md) for documentation.

```javascript
await gebetaMap.startNavigation({
  origin: { lat: 9.01, lng: 38.67 },
  destination: { lat: 8.98, lng: 38.88 },
  userId: 'unique-user-id',
  role: 'driver' // optional, defaults to 'driver'
});

const navController = gebetaMap.getNavigationController();
navController.on('stepchange', (data) => {
  console.log('Next turn:', data.step.instruction);
});
navController.on('progress', (data) => {
  console.log('Distance remaining:', data.remainingDistance, 'm');
});
```

## Directions API Usage

The library provides built-in support for route planning and directions, including waypoints and step instructions.

### Getting Directions

```javascript
// Basic usage
const routeData = await gebetaMap.getDirections(
  { lat: 9.0161, lng: 38.7685 }, // origin
  { lat: 9.0450, lng: 38.7450 }, // destination
  {
    waypoints: [
      { lat: 8.987192, lng: 38.82223 },
      // ...more waypoints
    ],
    avgSpeedKmh: 40 // (optional) average speed for duration estimation
  }
);

// Display the route on the map
gebetaMap.displayRoute(routeData, {
  showMarkers: true, // Show origin/destination/waypoint markers
  showInstructions: true, // Show step instruction markers (default: false)
  originIcon: 'https://cdn-icons-png.flaticon.com/512/1828/1828640.png',
  destinationIcon: 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png',
  waypointIcon: 'https://cdn-icons-png.flaticon.com/512/484/484167.png'
});
```

#### Options
- `waypoints`: Array of `{ lat, lng }` objects for intermediate stops.
- `avgSpeedKmh`: (optional) Average speed in km/h for duration estimation (default: 30).
- `showInstructions`: (displayRoute option) Show step-by-step instruction markers on the map (default: false).
- `originIcon`, `destinationIcon`, `waypointIcon`: (displayRoute options) Custom marker icons.

#### Route Data
The returned `routeData` object contains:
- `geometry`: GeoJSON LineString for the route
- `origin`, `destination`, `waypoints`: Coordinates
- `distance`, `duration`: Human-readable distance and estimated duration
- `instructions`: Array of step instructions (if available)

#### Example: Show Instructions
```javascript
gebetaMap.displayRoute(routeData, { showInstructions: true });
```

Clicking an instruction marker will zoom to that step and show the instruction in a popup.

## Geocoding API Usage

The library provides built-in support for both forward and reverse geocoding.

### Forward Geocoding
Find coordinates by searching for a place name.

```javascript
// Forward geocoding
const results = await gebetaMap.geocode('bole');
console.log(results);
// [
//   { name: 'bole arabsa', lat: 8.978027, lng: 38.884797, city: 'Addis Ababa', country: 'Ethiopia', type: 'neighborhood' },
//   ...
// ]
```
- **Method:** `gebetaMap.geocode(name)`
- **Parameters:**
  - `name` (string): The place name to search for (required)
- **Returns:** Array of matching locations with properties like `name`, `lat`, `lng`, `city`, `country`, `type`.

### Reverse Geocoding
Find place details by searching with coordinates.

```javascript
// Reverse geocoding
const results = await gebetaMap.reverseGeocode(8.989022, 38.79036);
console.log(results);
// [
//   { name: 'haji suktala building materials', latitude: 9.05559, longitude: 38.705503, city: 'addis ababa', country: 'Ethiopia', type: 'Building', ... },
//   ...
// ]
```
- **Method:** `gebetaMap.reverseGeocode(lat, lon)`
- **Parameters:**
  - `lat` (number): Latitude (required)
  - `lon` (number): Longitude (required)
- **Returns:** Array of matching places with properties like `name`, `latitude`, `longitude`, `city`, `country`, `type`, etc.

### Error Handling
If the API returns an error or no results, an exception is thrown. Use try/catch to handle errors gracefully.

### Example (with error handling)
```javascript
try {
  const results = await gebetaMap.geocode('bole');
  if (results.length === 0) {
    console.log('No results found.');
  } else {
    console.log('First result:', results[0]);
  }
} catch (err) {
  console.error('Geocoding error:', err.message);
} 
```

##### Example: Add a marker with a popup
```javascript
gebetaMap.addImageMarker(
  [38.7685, 9.0161],
  'https://cdn-icons-png.flaticon.com/512/484/484167.png',
  [30, 30],
  null, // onClick
  10,   // zIndex
  '<div style="font-size:14px;"><strong>Gebeta HQ</strong><br>Lat: 9.0161, Lng: 38.7685</div>' // popupHtml
);