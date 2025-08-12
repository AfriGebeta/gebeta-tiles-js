# Gebeta Maps Library

A JavaScript mapping library that provides an easy-to-use interface for creating interactive maps with advanced features like marker clustering, fence drawing, and custom markers.

## Features

- **Marker Clustering**: Automatic clustering of nearby markers with configurable radius and zoom levels
- **Fence Drawing**: Interactive polygon drawing with dynamic preview and multi-fence support
- **Custom Markers**: Support for custom marker images and click handlers
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
- `addNavigationControls(position)` - Add zoom/pan controls

#### Markers
- `addImageMarker(lngLat, imageUrl, size, onClick, zIndex, popupHtml)` - Add a custom marker. Optionally attach a popup with HTML content.
- `clearAllMarkers()` - Remove all markers from the map

#### Fence Drawing
- `addFencePoint(lngLat, customImage, onClick, color)` - Add a point to the current fence with optional custom color
- `clearFence()` - Clear the current fence being drawn
- `clearAllFences()` - Clear all fences on the map
- `isFenceCompleted()` - Check if the current fence is complete
- `isPointInsideFence(lngLat)` - Test if a point is inside the current fence
- `getFencePoints()` - Get current fence points
- `getFences()` - Get all stored fences
- `setFenceDefaultColor(color)` - Set the default color for new fences

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