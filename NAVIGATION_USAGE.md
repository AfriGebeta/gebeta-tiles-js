# Navigation & Tracking Usage Guide

## Overview

Navigation provides turn-by-turn directions with automatic location tracking. When you start navigation with `companyId` and `clientId`, tracking happens automatically.

## Basic Usage

### Start Navigation

```javascript
const gebetaMap = new GebetaMaps({ apiKey: 'your-api-key' });
await gebetaMap.init({ container: 'map' });

await gebetaMap.startNavigation({
  origin: { lat: 9.01, lng: 38.67 },
  destination: { lat: 8.98, lng: 38.88 },
  companyId: 'your-company-id',
  clientId: 'unique-client-id'
});
```

Required parameters:
- `companyId` (string): Company identifier for tracking
- `clientId` (string): Unique identifier for the client being tracked
- Either `route` OR both `origin` and `destination` must be provided

### Listen to Navigation Events

```javascript
const navController = gebetaMap.getNavigationController();

navController.on('progress', (data) => {
  // data.remainingDistance (meters)
  // data.remainingDuration (minutes)
  // data.currentStep (current instruction)
  // data.nextStep (next instruction)
  // data.location (current GPS location)
  // data.bearing (direction in degrees)
  // data.speed (speed in m/s)
});

navController.on('stepchange', (data) => {
  // data.step.instruction (text instruction)
  // data.step.icon (icon for the maneuver)
  // data.step.type (maneuver type number)
  // data.step.coord (turn location [lng, lat])
  // data.step.time (estimated time in seconds)
  // data.step.length (distance in kilometers)
});

navController.on('start', (data) => {
  // Navigation started
});

navController.on('arrive', () => {
  // Arrived at destination
});

navController.on('offroute', (data) => {
  // Off route detected
});

navController.on('stop', () => {
  // Navigation stopped
});
```

### Stop Navigation

```javascript
gebetaMap.stopNavigation();
```

## Turn-by-Turn Instructions

Instructions are provided from the routing API. Each instruction includes:
- Instruction text
- Icon representing the maneuver type
- Coordinate where the turn should be made
- Distance and time for the step

Access instructions from route data:

```javascript
const route = await gebetaMap.getDirections(origin, destination);
console.log('Instructions:', route.instructions);
```

## What Happens Automatically

When `startNavigation()` is called with `companyId` and `clientId`:
1. Route is calculated (if origin/destination provided)
2. GPS tracking starts
3. Location updates are sent to WebSocket server every 5 seconds
4. Map camera adjusts for navigation view
5. Turn-by-turn instructions are provided via `stepchange` events
6. Current location marker is displayed
7. Progress updates are emitted via `progress` events

When `stopNavigation()` is called:
1. Navigation stops
2. GPS tracking stops
3. WebSocket connection closes
4. Map camera returns to original view
5. Location marker is removed

## Advanced Options

### Use a pre-calculated route

```javascript
const route = await gebetaMap.getDirections(origin, destination);
await gebetaMap.startNavigation({ 
  route,
  companyId: 'company-123',
  clientId: 'client-456'
});
```

### Custom location provider

```javascript
const customProvider = {
  start: (onLocation) => {
    onLocation({ 
      lat: 9.01, 
      lng: 38.67, 
      speed: 50, 
      bearing: 90,
      timestamp: Date.now()
    });
    
    const interval = setInterval(() => {
      onLocation({ 
        lat: 9.01, 
        lng: 38.67, 
        speed: 50, 
        bearing: 90,
        timestamp: Date.now()
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }
};

await gebetaMap.startNavigation({
  origin: { lat: 9.01, lng: 38.67 },
  destination: { lat: 8.98, lng: 38.88 },
  locationProvider: customProvider,
  companyId: 'company-123',
  clientId: 'client-456'
});
```

## Examples

- [examples/navigation.html](examples/navigation.html) - Full navigation example with search and GPS tracking
- [examples/navigation-simulated.html](examples/navigation-simulated.html) - Navigation with simulated location provider
