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
```

### Core Methods

#### Map Initialization
- `init(options)` - Initialize the map
- `on(event, handler)` - Add event listeners to the map
- `addNavigationControls(position)` - Add zoom/pan controls

#### Markers
- `addImageMarker(lngLat, imageUrl, size, onClick)` - Add a custom marker
- `clearAllMarkers()` - Remove all markers from the map

#### Fence Drawing
- `addFencePoint(lngLat, customImage, onClick)` - Add a point to the current fence
- `clearFence()` - Clear the current fence being drawn
- `clearAllFences()` - Clear all fences on the map
- `isFenceCompleted()` - Check if the current fence is complete
- `isPointInsideFence(lngLat)` - Test if a point is inside the current fence
- `getFencePoints()` - Get current fence points
- `getFences()` - Get all stored fences

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

- **Dynamic Preview**: Red dashed line follows cursor while drawing
- **Multi-Fence Support**: Store and display multiple fences simultaneously
- **Auto-Completion**: Click on existing points to close fences
- **Smart Detection**: Automatically start new fences when clicking outside completed ones

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