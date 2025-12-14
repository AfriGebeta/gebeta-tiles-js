# Navigation & Tracking Usage Guide

## Overview

Navigation provides turn-by-turn directions with automatic location tracking. When you start navigation with `userId`, tracking happens automatically using the API key from the GebetaMaps constructor.

## Basic Usage

### Start Navigation

```javascript
const gebetaMap = new GebetaMaps({ apiKey: 'your-api-key' });
await gebetaMap.init({ container: 'map' });

await gebetaMap.startNavigation({
  origin: { lat: 9.01, lng: 38.67 },
  destination: { lat: 8.98, lng: 38.88 },
  userId: 'unique-user-id',
  role: 'driver' // optional, defaults to driver
});
```

Required parameters:
- `userId` (string): Unique identifier for the user being tracked
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

When `startNavigation()` is called with `userId`:
1. Route is calculated (if origin/destination provided)
2. GPS tracking starts
3. WebSocket connection is established and authenticated
4. Location updates are sent to WebSocket server every 5 seconds
5. Map camera adjusts for navigation view
6. Turn-by-turn instructions are provided via `stepchange` events
7. Current location marker is displayed
8. Progress updates are emitted via `progress` events

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
  userId: 'user-123',
  role: 'driver'
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
  userId: 'user-123',
  role: 'driver'
});
```

## Examples

- [examples/navigation.html](examples/navigation.html) - Full navigation example with search and GPS tracking
- [examples/navigation-simulated.html](examples/navigation-simulated.html) - Navigation with simulated location provider
