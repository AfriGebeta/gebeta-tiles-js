import maplibregl from 'maplibre-gl';
import ClusteringManager from './ClusteringManager.js';
import FenceManager from './FenceManager.js';
import DirectionsManager from './DirectionsManager.js';
import GeocodingManager from './GeocodingManager.js';
import './style.css';

class GebetaMaps {
  constructor({ apiKey, clustering = {} }) {
    if (!apiKey) {
      console.error("An API key is required for Gebeta Maps.");
    }
    this.apiKey = apiKey;
    this.map = null;
    this.markerList = [];
    
    // Clustering configuration
    this.clustering = {
      enabled: clustering.enabled || false,
      ...clustering
    };
    
    // Clustering manager
    this.clusteringManager = null;

    // Fence manager
    this.fenceManager = null;

    // Directions manager
    this.directionsManager = null;

    this.geocodingManager = new GeocodingManager(apiKey);

    // Fullscreen popup state
    this._fullscreen = {
      overlayEl: null,
      closeBtnEl: null,
      originalParent: null,
      originalNextSibling: null,
      isOpen: false,
      keydownHandler: null,
    };

    // Style selector state
    this._styleSelector = {
      currentStyle: 'standard', // 'standard', 'satellite', or 'terrain'
      styles: {
        standard: {
          url: 'https://tiles.gebeta.app/styles/standard/style.json',
          imageUrl: 'https://tiles.gebeta.app/static/standard.jpg',
          label: 'Standard'
        },
        satellite: {
          url: 'https://tiles.gebeta.app/styles/raster/raster.json',
          imageUrl: 'https://tiles.gebeta.app/static/satellite.jpg',
          label: 'Satellite'
        },
        terrain: {
          url: 'https://tiles.gebeta.app/styles/standard/terrain/terrain.json',
          imageUrl: 'https://tiles.gebeta.app/static/terrain.jpg',
          label: 'Terrain'
        }
      }
    };
  }

  init(options = {}) {
    const defaultStyleUrl = `https://tiles.gebeta.app/styles/standard/style.json`;

    // Allow callers to pass either:
    // - styleUrl: a custom style URL
    // - style: a full style JSON object
    // We then pass the resolved style into MapLibre.
    const {
      styleUrl,
      style,
      ...mapOptions
    } = options;

    // Determine the style to use: prefer style object, then styleUrl, then default
    let resolvedStyle;
    if (style && typeof style === 'object') {
      // Pass style object directly to MapLibre
      resolvedStyle = style;
      // Can't determine which style from an object, default to standard
      this._styleSelector.currentStyle = 'standard';
    } else if (styleUrl && typeof styleUrl === 'string') {
      // Pass style URL string to MapLibre
      resolvedStyle = styleUrl;
      // Detect which style is being used
      if (styleUrl.includes('terrain')) {
        this._styleSelector.currentStyle = 'terrain';
      } else if (styleUrl.includes('raster') || styleUrl.includes('satellite')) {
        this._styleSelector.currentStyle = 'satellite';
      } else {
        this._styleSelector.currentStyle = 'standard';
      }
    } else {
      // Use default style URL
      resolvedStyle = defaultStyleUrl;
      this._styleSelector.currentStyle = 'standard';
    }

    this.map = new maplibregl.Map({
      ...mapOptions,
      style: resolvedStyle,
      attributionControl: false,
      transformRequest: (url, resourceType) => {
        // Only add the Authorization header for requests to tiles.gebeta.app
        if (url.startsWith('https://tiles.gebeta.app')) {
          return {
            url,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          };
        }
        return { url };
      },
    });

    this.addGebetaLogo();
    this.addCustomAttribution();

    // Initialize fence manager immediately so event listeners can be registered
    this.initFenceManager();

    // Add fullscreen control by default (can be disabled with options.fullscreenControl = false)
    if (!options || options.fullscreenControl !== false) {
      try { this.addFullscreenPopupControl(); } catch (e) {}
    }

    // Add style selector if enabled
    if (options && options.satelliteToggle === true) {
      // Allow custom style URLs and image URLs
      if (options.satelliteToggleOptions) {
        if (options.satelliteToggleOptions.standardStyleUrl) {
          this._styleSelector.styles.standard.url = options.satelliteToggleOptions.standardStyleUrl;
        }
        if (options.satelliteToggleOptions.satelliteStyleUrl) {
          this._styleSelector.styles.satellite.url = options.satelliteToggleOptions.satelliteStyleUrl;
        }
        if (options.satelliteToggleOptions.terrainStyleUrl) {
          this._styleSelector.styles.terrain.url = options.satelliteToggleOptions.terrainStyleUrl;
        }
        if (options.satelliteToggleOptions.standardImageUrl) {
          this._styleSelector.styles.standard.imageUrl = options.satelliteToggleOptions.standardImageUrl;
        }
        if (options.satelliteToggleOptions.satelliteImageUrl) {
          this._styleSelector.styles.satellite.imageUrl = options.satelliteToggleOptions.satelliteImageUrl;
        }
        if (options.satelliteToggleOptions.terrainImageUrl) {
          this._styleSelector.styles.terrain.imageUrl = options.satelliteToggleOptions.terrainImageUrl;
        }
      }
      try { this.addStyleSelector(); } catch (e) {}
    }

    // Initialize remaining managers after map loads
    this.map.on('load', () => {
      // Initialize clustering if enabled
      if (this.clustering.enabled) {
        this.initClustering();
      }

      // Initialize directions manager
      this.initDirectionsManager();
    });

    return this.map;
  }

  initClustering() {
    if (!this.map) return;
    this.clusteringManager = new ClusteringManager(this.map, this.clustering);
  }

  initFenceManager(defaultColor = '#ff0000') {
    if (!this.map) return;
    this.fenceManager = new FenceManager(this.map, this.clustering.enabled, defaultColor);
    
    // Register any pending event handlers
    if (this._pendingEventHandlers && this._pendingEventHandlers.fenceCompleted) {
      this._pendingEventHandlers.fenceCompleted.forEach(handler => {
        this.fenceManager.on('fenceCompleted', handler);
      });
      this._pendingEventHandlers.fenceCompleted = [];
    }
  }

  setFenceDefaultColor(color) {
    if (!this.fenceManager) return;
    this.fenceManager.defaultColor = color;
    this.fenceManager.currentFenceColor = color;
    // Also update the fence style to maintain consistency
    this.fenceManager.setFenceStyle({ 
      fillColor: color, 
      lineColor: color, 
      borderColor: color 
    });
  }

  // Enhanced fence styling methods
  setFenceStyle(styleOptions) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceStyle(styleOptions);
  }

  setFenceFillColor(color) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceFillColor(color);
  }

  setFenceFillOpacity(opacity) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceFillOpacity(opacity);
  }

  setFenceLineColor(color) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineColor(color);
  }

  setFenceLineWidth(width) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineWidth(width);
  }

  setFenceLineOpacity(opacity) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineOpacity(opacity);
  }

  setFenceLineDashArray(dashArray) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineDashArray(dashArray);
  }

  setFenceLineCap(cap) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineCap(cap);
  }

  setFenceLineJoin(join) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceLineJoin(join);
  }

  setFenceBorderColor(color) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceBorderColor(color);
  }

  setFenceBorderWidth(width) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceBorderWidth(width);
  }

  setFenceBorderOpacity(opacity) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceBorderOpacity(opacity);
  }

  getFenceStyle() {
    if (!this.fenceManager) return null;
    return this.fenceManager.getFenceStyle();
  }

  getDefaultFenceStyle() {
    if (!this.fenceManager) return null;
    return this.fenceManager.getDefaultFenceStyle();
  }

  resetFenceStyle() {
    if (!this.fenceManager) return;
    this.fenceManager.resetFenceStyle();
  }

  initDirectionsManager() {
    if (!this.map) return;
    this.directionsManager = new DirectionsManager(this.map, this.apiKey);
  }

  on(event, handler) {
    // Special case for fence events - can be registered even before map init
    if (event === 'fenceCompleted') {
      // If fence manager isn't initialized yet, store the handler to register later
      if (!this.fenceManager) {
        if (!this._pendingEventHandlers) {
          this._pendingEventHandlers = { fenceCompleted: [] };
        }
        this._pendingEventHandlers.fenceCompleted.push(handler);
      } else {
        this.fenceManager.on(event, handler);
      }
      return;
    }
    
    // For map events, require map to be initialized
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.on(event, handler);
  }

  addNavigationControls(position = 'top-right') {
    if (!this.map) throw new Error("Map not initialized. Call init() first.");
    this.map.addControl(new maplibregl.NavigationControl(), position);
  }

  /**
   * Add a custom control that opens the map in a fullscreen popup overlay
   * which sits above all page content (not using the browser Fullscreen API).
   */
  addFullscreenPopupControl(position = 'top-right') {
    if (!this.map) throw new Error('Map not initialized. Call init() first.');

    const control = {
      onAdd: () => {
        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group gebeta-fullscreen-ctrl';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gebeta-fullscreen-ctrl__btn';
        button.setAttribute('aria-label', 'Open fullscreen map');
        button.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 14h2v5h5v2H3v-7zm13 7v-2h5v-5h2v7h-7zM19 3h-5V1h7v7h-2V3zM3 8V1h7v2H5v5H3z"/></svg>';
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openFullscreenPopup();
        });

        container.appendChild(button);
        return container;
      },
      onRemove: () => {},
    };

    this.map.addControl(control, position);
  }

  openFullscreenPopup() {
    if (!this.map || this._fullscreen.isOpen) return;

    const mapContainer = this.map.getContainer();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'gebeta-map-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gebeta-map-overlay__close';
    closeBtn.setAttribute('aria-label', 'Close fullscreen map');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.closeFullscreenPopup());

    overlay.appendChild(closeBtn);

    // Save original placement
    const originalParent = mapContainer.parentElement;
    const originalNextSibling = mapContainer.nextSibling;

    // Move map container into overlay
    overlay.appendChild(mapContainer);

    // Mount overlay
    document.body.appendChild(overlay);

    // Keyboard handler (Esc to close)
    const keydownHandler = (ev) => {
      if (ev.key === 'Escape') {
        this.closeFullscreenPopup();
      }
    };
    document.addEventListener('keydown', keydownHandler);

    // Persist state
    this._fullscreen.overlayEl = overlay;
    this._fullscreen.closeBtnEl = closeBtn;
    this._fullscreen.originalParent = originalParent;
    this._fullscreen.originalNextSibling = originalNextSibling;
    this._fullscreen.keydownHandler = keydownHandler;
    this._fullscreen.isOpen = true;

    // Resize after relocation
    setTimeout(() => {
      try { this.map.resize(); } catch (e) {}
    }, 0);
  }

  closeFullscreenPopup() {
    if (!this.map || !this._fullscreen.isOpen) return;

    const { overlayEl, originalParent, originalNextSibling, keydownHandler } = this._fullscreen;
    const mapContainer = this.map.getContainer();

    // Move map container back
    if (originalParent) {
      if (originalNextSibling) {
        originalParent.insertBefore(mapContainer, originalNextSibling);
      } else {
        originalParent.appendChild(mapContainer);
      }
    }

    // Unmount overlay
    if (overlayEl && overlayEl.parentElement) {
      overlayEl.parentElement.removeChild(overlayEl);
    }

    // Cleanup listeners
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
    }

    // Reset state
    this._fullscreen.overlayEl = null;
    this._fullscreen.closeBtnEl = null;
    this._fullscreen.originalParent = null;
    this._fullscreen.originalNextSibling = null;
    this._fullscreen.keydownHandler = null;
    this._fullscreen.isOpen = false;

    // Resize after relocation
    setTimeout(() => {
      try { this.map.resize(); } catch (e) {}
    }, 0);
  }

  /**
   * Add a satellite/standard style toggle control at the bottom of the map
   */
  addStyleSelector(position = 'bottom-right') {
    if (!this.map) throw new Error('Map not initialized. Call init() first.');

    const control = {
      onAdd: () => {
        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl gebeta-style-selector';
        container.style.margin = '10px';
        container.style.background = 'transparent';
        container.style.border = 'none';
        container.style.boxShadow = 'none';
        container.style.padding = '0';
        container.style.position = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gebeta-style-selector__btn';
        button.setAttribute('aria-label', 'Select map style');
        button.style.width = '44px';
        button.style.height = '44px';
        button.style.padding = '0';
        button.style.margin = '0';
        button.style.border = '1px solid hsl(214.3 31.8% 91.4%)';
        button.style.outline = 'none';
        button.style.borderRadius = '6px';
        button.style.background = 'hsl(0 0% 100%)';
        button.style.overflow = 'hidden';
        button.style.cursor = 'pointer';
        button.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
        
        // Update button based on current state
        this._updateStyleSelectorButton(button);

        // Create popup menu
        const popup = document.createElement('div');
        popup.className = 'gebeta-style-selector__popup';
        popup.style.display = 'none';
        popup.style.position = 'absolute';
        popup.style.bottom = '54px';
        popup.style.right = '0';
        popup.style.background = 'transparent';
        popup.style.borderRadius = '0';
        popup.style.boxShadow = 'none';
        popup.style.padding = '0';
        popup.style.minWidth = '160px';
        popup.style.zIndex = '1000';
        popup.style.overflow = 'visible';
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px) scale(0.95)';
        popup.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        popup.style.pointerEvents = 'none';
        popup.style.display = 'none';
        popup.style.flexDirection = 'column';
        popup.style.gap = '4px';

        // Create menu items for each style
        const styleKeys = ['standard', 'satellite', 'terrain'];
        styleKeys.forEach((styleKey) => {
          const style = this._styleSelector.styles[styleKey];
          const menuItem = document.createElement('button');
          menuItem.type = 'button';
          menuItem.className = 'gebeta-style-selector__menu-item';
          menuItem.setAttribute('data-style-key', styleKey);
          menuItem.style.display = 'flex';
          menuItem.style.alignItems = 'center';
          menuItem.style.width = '100%';
          menuItem.style.padding = '8px 12px';
          menuItem.style.margin = '0';
          menuItem.style.border = '1px solid hsl(214.3 31.8% 91.4%)';
          menuItem.style.borderRadius = '6px';
          menuItem.style.background = 'hsl(0 0% 100%)';
          menuItem.style.cursor = 'pointer';
          menuItem.style.fontSize = '14px';
          menuItem.style.fontWeight = '400';
          menuItem.style.color = 'hsl(222.2 84% 4.9%)';
          menuItem.style.textAlign = 'left';
          menuItem.style.transition = 'all 0.15s ease';
          menuItem.style.position = 'relative';
          menuItem.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';

          const img = document.createElement('img');
          img.src = style.imageUrl;
          img.alt = style.label;
          img.style.width = '36px';
          img.style.height = '36px';
          img.style.borderRadius = '4px';
          img.style.objectFit = 'cover';
          img.style.marginRight = '10px';
          img.style.flexShrink = '0';
          img.style.border = '1px solid hsl(214.3 31.8% 91.4%)';
          img.style.transition = 'transform 0.15s ease';

          const label = document.createElement('span');
          label.textContent = style.label;
          label.style.fontSize = '14px';
          label.style.lineHeight = '1.5';
          label.style.fontWeight = 'inherit';

          menuItem.appendChild(img);
          menuItem.appendChild(label);

          // Highlight current style
          if (this._styleSelector.currentStyle === styleKey) {
            menuItem.style.background = 'hsl(210 40% 96.1%)';
            menuItem.style.color = 'hsl(222.2 47.4% 11.2%)';
            menuItem.style.fontWeight = '500';
            menuItem.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
          }

          menuItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._switchStyle(styleKey, button, popup);
          });

          menuItem.addEventListener('mouseenter', () => {
            if (this._styleSelector.currentStyle !== styleKey) {
              menuItem.style.background = 'hsl(210 40% 98%)';
              menuItem.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
            }
          });

          menuItem.addEventListener('mouseleave', () => {
            if (this._styleSelector.currentStyle !== styleKey) {
              menuItem.style.background = 'hsl(0 0% 100%)';
              menuItem.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
            }
          });

          popup.appendChild(menuItem);
        });

        // Toggle popup on button click
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isVisible = popup.style.display === 'flex' && popup.style.opacity === '1';
          
          if (isVisible) {
            // Close popup
            popup.style.opacity = '0';
            popup.style.transform = 'translateY(8px) scale(0.95)';
            popup.style.pointerEvents = 'none';
            setTimeout(() => {
              popup.style.display = 'none';
            }, 200);
          } else {
            // Open popup
            popup.style.display = 'flex';
            popup.style.pointerEvents = 'auto';
            // Trigger reflow to ensure display change is applied
            popup.offsetHeight;
            requestAnimationFrame(() => {
              popup.style.opacity = '1';
              popup.style.transform = 'translateY(0) scale(1)';
            });
          }
        });

        // Close popup when clicking outside
        const closePopup = (e) => {
          if (!container.contains(e.target) && popup.style.display === 'flex') {
            popup.style.opacity = '0';
            popup.style.transform = 'translateY(8px) scale(0.95)';
            popup.style.pointerEvents = 'none';
            setTimeout(() => {
              popup.style.display = 'none';
            }, 200);
          }
        };
        document.addEventListener('click', closePopup);
        container._closePopupHandler = closePopup;

        container.appendChild(button);
        container.appendChild(popup);
        return container;
      },
      onRemove: (container) => {
        // Remove event listener
        if (container && container._closePopupHandler) {
          document.removeEventListener('click', container._closePopupHandler);
        }
      },
    };

    this.map.addControl(control, position);
  }

  _updateStyleSelectorButton(button) {
    const currentStyle = this._styleSelector.styles[this._styleSelector.currentStyle];
    button.innerHTML = `<img src="${currentStyle.imageUrl}" alt="${currentStyle.label}" style="width: 44px; height: 44px; object-fit: cover; display: block; border-radius: 10px; border: none; padding: 0; margin: 0;" />`;
    button.setAttribute('aria-label', `Current style: ${currentStyle.label}. Click to change.`);
  }

  _switchStyle(styleKey, button, popup) {
    if (!this.map || this._styleSelector.currentStyle === styleKey) {
      popup.style.display = 'none';
      return;
    }

    const targetStyle = this._styleSelector.styles[styleKey];
    this._styleSelector.currentStyle = styleKey;

    // Update button immediately
    this._updateStyleSelectorButton(button);

    // Update popup menu highlighting
    const menuItems = popup.querySelectorAll('.gebeta-style-selector__menu-item');
    menuItems.forEach((item) => {
      const itemStyleKey = item.getAttribute('data-style-key');
      
      if (itemStyleKey === styleKey) {
        item.style.background = 'hsl(210 40% 96.1%)';
        item.style.color = 'hsl(222.2 47.4% 11.2%)';
        item.style.fontWeight = '500';
        item.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
      } else {
        item.style.background = 'hsl(0 0% 100%)';
        item.style.color = 'hsl(222.2 84% 4.9%)';
        item.style.fontWeight = '400';
        item.style.borderColor = 'hsl(214.3 31.8% 91.4%)';
      }
    });

    // Close popup with animation
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(8px) scale(0.95)';
    popup.style.pointerEvents = 'none';
    setTimeout(() => {
      popup.style.display = 'none';
    }, 200);

    // Switch map style
    this.map.setStyle(targetStyle.url);
  }

  // Keep old method name for backward compatibility
  addSatelliteToggle(position = 'bottom-right') {
    return this.addStyleSelector(position);
  }

  addImageMarker(lngLat, imageUrl, size = [30, 30], onClick = null, zIndex = 10, popupHtml = null, options = {}) {
    if (!this.map) throw new Error("Map not initialized.");

    // If clustering is enabled, add to clustering manager
    if (this.clustering.enabled && this.clusteringManager) {
      const markerId = (options && options.id) ? options.id : `marker_${Date.now()}_${Math.random()}`;
      const marker = {
        id: markerId,
        lngLat: lngLat,
        imageUrl,
        size,
        onClick,
        zIndex,
        popupHtml
      };
      this.clusteringManager.addMarker(marker);
      return marker;
    }

    // Traditional marker approach (non-clustered)
    const markerId = (options && options.id) ? options.id : `marker_${Date.now()}_${Math.random()}`;
    const el = document.createElement('div');
    el.style.backgroundImage = `url('${imageUrl}')`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.width = `${size[0]}px`;
    el.style.height = `${size[1]}px`;
    el.style.cursor = 'pointer';
    el.style.zIndex = zIndex;

    // Always stop propagation so map-level click handlers don't fire
    // when interacting with the marker element or its popup
    el.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(this.map);

    // Add ID to marker for removal
    marker.id = markerId;

    let popup = null;
    if (popupHtml) {
      popup = new maplibregl.Popup({ offset: 18, closeOnClick: false });
      if (typeof popupHtml === 'string') {
        popup.setHTML(popupHtml);
      } else if (popupHtml instanceof HTMLElement) {
        if (typeof popup.setDOMContent === 'function') {
          popup.setDOMContent(popupHtml);
        } else {
          popup.setHTML(popupHtml.outerHTML);
        }
      } else {
        popup.setHTML(String(popupHtml));
      }
      marker.setPopup(popup);
      // Open the popup by default without depending on click bubbling
      if (popup && typeof popup.addTo === 'function') {
        setTimeout(() => {
          try { popup.setLngLat(lngLat).addTo(this.map); } catch (_) {}
        }, 0);
      }
    }

    // Add click handler if provided
    if (onClick) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(lngLat, marker, e);
      });
    }

    this.markerList.push(marker);
    return { marker, popup, id: markerId };
  }

  addFencePoint(lngLat, customImage = null, onClick = null, color = null, options = null, borderColor = null) {
    if (!this.fenceManager) {
      console.warn("Fence manager not initialized. Fence functionality may not work properly.");
      return;
    }
    
    this.fenceManager.addFencePoint(lngLat, customImage, onClick, this.addImageMarker.bind(this), color, options, borderColor);
  }

  clearFence() {
    if (!this.fenceManager) return;
    this.fenceManager.clearFence();
  }

  removeFence(fenceId) {
    if (!this.fenceManager) return false;
    return this.fenceManager.removeFence(fenceId);
  }

  removeFenceByName(name) {
    if (!this.fenceManager) return false;
    return this.fenceManager.removeFenceByName(name);
  }

  clearAllFences() {
    if (!this.fenceManager) return;
    this.fenceManager.clearAllFences();
  }

  isFenceCompleted() {
    if (!this.fenceManager) return false;
    return this.fenceManager.isFenceCompleted();
  }

  isPointInsideFence(lngLat) {
    if (!this.fenceManager) return false;
    return this.fenceManager.isPointInsideFence(lngLat);
  }

  getFencePoints() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFencePoints();
  }

  getFencePointsWithClosure() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFencePointsWithClosure();
  }

  getFences() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getFences();
  }

  getCurrentFenceMarkers() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getCurrentFenceMarkers();
  }

  getAllMarkers() {
    if (!this.fenceManager) return [];
    return this.fenceManager.getAllMarkers();
  }

  setFenceOverlay(overlayHtml, options = {}) {
    if (!this.fenceManager) return;
    this.fenceManager.setFenceOverlay(overlayHtml, options);
  }

  storeCurrentFence(customId = null) {
    if (!this.fenceManager) return null;
    return this.fenceManager.storeCurrentFence(customId);
  }

  renderFencesFromArray(fences, options = {}) {
    if (!this.fenceManager) return;

    const {
      clearExisting = true,
      autoColor = true,
      startHue = 0,
      hueStep = 180,
      overlayAnchor = 'bottom',
      persistent = false
    } = options;

    if (clearExisting) {
      this.clearAllFences();
      this.clearAllMarkers();
    }

    const normalizeItem = (item, index) => {
      if (Array.isArray(item)) {
        return { id: null, name: `Path ${index + 1}`, points: item };
      }
      if (item && Array.isArray(item.points)) {
        return {
          id: item.id || null,
          name: item.name || `Path ${index + 1}`,
          points: item.points,
          color: item.color,
          borderColor: item.borderColor,
          overlayHtml: item.overlayHtml,
          overlayOptions: item.overlayOptions,
          markerId: item.markerId
        };
      }
      return null;
    };
    // Temporarily disable proximity-based auto-closure during batch rendering
    const prevFlag = this.fenceManager.disableProximityClosure;
    this.fenceManager.disableProximityClosure = true;

    fences.forEach((rawItem, index) => {
      const item = normalizeItem(rawItem, index);
      if (!item || !Array.isArray(item.points) || item.points.length === 0) return;

      const color = item.color || (autoColor ? `hsl(${startHue + index * hueStep}, 80%, 50%)` : this.fenceManager.defaultColor);

      const overlayHtml = item.overlayHtml || (item.name
        ? `<div style="padding:4px 8px;background:#fff;border:2px solid ${color};border-radius:6px;font-size:12px;color:#111;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.2);transform:translateY(-6px);">${item.name}</div>`
        : null);
      // Do NOT set persistent during the drawing phase to prevent auto-store on close
      const firstPointOptions = overlayHtml ? { overlayHtml, overlayOptions: { anchor: overlayAnchor } } : {};
      // Ensure name is carried in options for storage
      if (item.name) {
        firstPointOptions.name = item.name;
      }

      item.points.forEach((point, pointIndex) => {
        const opts = pointIndex === 0 ? firstPointOptions : {};
        // Pass optional markerId for first point if provided via item.markerId
        if (pointIndex === 0 && item.markerId) {
          opts.markerId = item.markerId;
        }
        this.addFencePoint(point, null, null, color, opts, item.borderColor);
      });

      if (item.points.length >= 3) {
        // Set persistence now, just before store, to avoid auto-store earlier
        if (typeof persistent === 'boolean' && this.fenceManager) {
          this.fenceManager.currentFencePersistent = persistent;
        }
        // Allow optional fence id via item.id
        this.storeCurrentFence(item.id);
      }
    });

    // Restore proximity closure flag
    this.fenceManager.disableProximityClosure = prevFlag;

    // No finalization needed; each path is explicitly stored above
  }

  // Directions API methods
  async getDirections(origin, destination, options = {}) {
    if (!this.directionsManager) {
      throw new Error("Directions manager not initialized. Call init() first.");
    }
    return await this.directionsManager.getDirections(origin, destination, options);
  }

  displayRoute(routeData, options = {}) {
    if (!this.directionsManager) {
      console.warn("Directions manager not initialized. Route display may not work properly.");
      return;
    }
    this.directionsManager.displayRoute(routeData, options);
  }

  clearRoute() {
    if (!this.directionsManager) return;
    this.directionsManager.clearRoute();
  }

  getCurrentRoute() {
    if (!this.directionsManager) return null;
    return this.directionsManager.getCurrentRoute();
  }

  getRouteSummary() {
    if (!this.directionsManager) return null;
    return this.directionsManager.getRouteSummary();
  }

  updateRouteStyle(style = {}) {
    if (!this.directionsManager) return;
    this.directionsManager.updateRouteStyle(style);
  }

  removeMarker(markerId) {
    if (!this.map) return false;

    // Handle clustered markers
    if (this.clustering.enabled && this.clusteringManager) {
      return this.clusteringManager.removeMarker(markerId);
    }

    // Handle regular markers
    const markerIndex = this.markerList.findIndex(marker => marker && marker.id === markerId);
    if (markerIndex !== -1) {
      const marker = this.markerList[markerIndex];
      if (marker && marker.remove) {
        marker.remove();
      }
      this.markerList.splice(markerIndex, 1);
      return true;
    }

    return false;
  }

  clearAllMarkers() {
    if (!this.map) return;

    // Clear custom markers (only for non-clustered markers)
    this.markerList.forEach(marker => marker && marker.remove && marker.remove());
    this.markerList = [];

    // Clear clustered markers
    if (this.clustering.enabled && this.clusteringManager) {
      this.clusteringManager.clearAllMarkers();
    }

    // Also clear fences' markers and overlays
    if (this.fenceManager) {
      this.fenceManager.clearAllFences();
    }

    // Clear route
    if (this.directionsManager) {
      this.directionsManager.clearRoute();
    }
  }

  addGebetaLogo() {
    if (!this.map) return;
    const logoContainer = document.createElement('div');
    logoContainer.className = 'maplibregl-ctrl-bottom-left';
    logoContainer.innerHTML = `
      <div class="maplibregl-ctrl" style="margin: 0 0 10px 10px;">
        <a href="https://gebetamaps.com/" target="_blank">
          <img src="https://tiles.gebeta.app/static/glogo.svg" alt="Gebeta Maps Logo" style="height: 30px; border-radius: 4px;"/>
        </a>
      </div>`;
    this.map.getContainer().appendChild(logoContainer);
  }

  addCustomAttribution() {
    if (!this.map) return;
    this.map.addControl(new maplibregl.AttributionControl({
      customAttribution: '<a href="https://gebetamaps.com/" target="_blank">© Gebeta Maps</a>',
    }));
  }

  async geocode(name) {
    if (!this.geocodingManager) throw new Error('Geocoding manager not initialized');
    return await this.geocodingManager.geocode(name);
  }

  async reverseGeocode(lat, lon) {
    if (!this.geocodingManager) throw new Error('Geocoding manager not initialized');
    return await this.geocodingManager.reverseGeocode(lat, lon);
  }

  // General overlay methods
  addHtmlOverlay(lngLat, htmlContent, options = {}) {
    if (!this.map) throw new Error("Map not initialized.");
    
    const {
      anchor = 'center',
      offset = [0, 0],
      closeable = false,
      closeButtonHtml = '&times;',
      onClose = null,
      className = 'gebeta-html-overlay',
      zIndex = 1000
    } = options;

    let element;
    if (typeof htmlContent === 'string') {
      element = document.createElement('div');
      element.innerHTML = htmlContent;
      // If string contains multiple nodes, wrap in a div
      if (element.childNodes.length === 1 && element.firstChild instanceof HTMLElement) {
        element = element.firstChild;
      }
    } else if (htmlContent instanceof HTMLElement) {
      element = htmlContent;
    } else {
      throw new Error('htmlContent must be a string or HTMLElement');
    }

    // Add close button if requested
    if (closeable) {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = closeButtonHtml;
      closeBtn.className = 'gebeta-overlay-close';
      closeBtn.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(0,0,0,0.5);
        color: white;
        border: none;
        border-radius: 3px;
        width: 20px;
        height: 20px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
      `;
      
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        marker.remove();
        if (onClose) onClose();
      });
      
      element.style.position = 'relative';
      element.appendChild(closeBtn);
    }

    // Add custom class if provided
    if (className) {
      element.classList.add(className);
    }

    // Set z-index
    element.style.zIndex = zIndex;

    const marker = new maplibregl.Marker({ 
      element, 
      anchor,
      offset
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return marker;
  }

  addOverlayWithCoordinates(lngLat, coordinates, options = {}) {
    if (!this.map) throw new Error("Map not initialized.");
    
    const {
      anchor = 'center',
      offset = [0, 0],
      closeable = false,
      closeButtonHtml = '&times;',
      onClose = null,
      className = 'gebeta-coordinates-overlay',
      zIndex = 1000
    } = options;

    const element = document.createElement('div');
    element.innerHTML = `
      <div style="
        background: white;
        border: 2px solid #333;
        border-radius: 6px;
        padding: 8px 12px;
        font-family: monospace;
        font-size: 12px;
        color: #111;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        min-width: 120px;
        text-align: center;
      ">
        <div style="font-weight: bold; margin-bottom: 4px;">Coordinates</div>
        <div>Lat: ${coordinates.lat.toFixed(6)}</div>
        <div>Lng: ${coordinates.lng.toFixed(6)}</div>
      </div>
    `;

    // Add close button if requested
    if (closeable) {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = closeButtonHtml;
      closeBtn.className = 'gebeta-overlay-close';
      closeBtn.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(0,0,0,0.5);
        color: white;
        border: none;
        border-radius: 3px;
        width: 20px;
        height: 20px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
      `;
      
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        marker.remove();
        if (onClose) onClose();
      });
      
      element.style.position = 'relative';
      element.appendChild(closeBtn);
    }

    // Add custom class if provided
    if (className) {
      element.classList.add(className);
    }

    // Set z-index
    element.style.zIndex = zIndex;

    const marker = new maplibregl.Marker({ 
      element, 
      anchor,
      offset
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return marker;
  }

  clearAllOverlays() {
    if (!this.map) return;
    
    // Find and remove all overlay markers
    const overlayElements = this.map.getContainer().querySelectorAll('.gebeta-html-overlay, .gebeta-coordinates-overlay');
    overlayElements.forEach(element => {
      const marker = element.closest('.maplibregl-marker');
      if (marker) {
        marker.remove();
      }
    });
  }
}

export default GebetaMaps; 