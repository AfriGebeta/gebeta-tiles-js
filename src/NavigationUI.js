/**
 * NavigationUI - A default navigation UI component that can be extended
 * 
 * Provides a starting point for displaying navigation instructions, distance, and time.
 * Developers can extend this class to customize the UI to their needs.
 * 
 * @example
 * // Use the default UI
 * const navUI = new NavigationUI(map, navController);
 * navUI.mount();
 * 
 * @example
 * // Extend and customize
 * class CustomNavigationUI extends NavigationUI {
 *   mount() {
 *     super.mount();
 *     // Add custom elements
 *   }
 *   
 *   update(data) {
 *     super.update(data);
 *     // Custom update logic
 *   }
 * }
 */
export class NavigationUI {
  /**
   * Create a NavigationUI instance
   * @param {Object} map - MapLibre map instance
   * @param {Object} navController - NavController instance
   * @param {Object} options - Configuration options
   * @param {string} options.position - Position of UI ('top', 'bottom', 'center')
   * @param {string} options.theme - Theme ('light', 'dark')
   * @param {Function} options.onStop - Callback when stop button is clicked
   */
  constructor(map, navController, options = {}) {
    this.map = map;
    this.nav = navController;
    this.options = {
      position: 'top',
      theme: 'light',
      onStop: null,
      ...options,
    };
    this._mounted = false;
    this._container = null;
    this._instructionEl = null;
    this._instructionIconEl = null;
    this._distanceEl = null;
    this._timeEl = null;
    this._stopBtn = null;
  }

  /**
   * Bind navigation events
   * Can be overridden to customize event handling
   */
  _bindEvents() {
    if (!this.nav) return;
    
    this.nav.on('progress', (data) => {
      this.update(data);
    });
    
    this.nav.on('stepchange', (data) => {
      if (data.step) {
        this._setInstruction(data.step);
      }
    });
    
    this.nav.on('start', () => {
      if (this.nav.route?.instructions?.[0]) {
        this._setInstruction(this.nav.route.instructions[0]);
      }
    });
    
    // If navigation is already active when UI is mounted, update immediately
    if (this.nav._active && this.nav.route?.instructions?.[0]) {
      this._setInstruction(this.nav.route.instructions[0]);
    }
  }

  /**
   * Mount the UI to the map container
   * Can be overridden to customize the DOM structure
   */
  mount() {
    if (this._mounted) return;
    this._injectStyles();
    const parent = this.map?.getContainer?.();
    if (!parent) return;

    const wrapper = this._createWrapper();
    const instructionCard = this._createInstructionCard();
    const metrics = this._createMetrics();

    wrapper.appendChild(instructionCard);
    wrapper.appendChild(metrics);
    parent.appendChild(wrapper);

    this._container = wrapper;
    this._instructionEl = instructionCard.querySelector('.gebeta-nav-instruction');
    this._instructionIconEl = instructionCard.querySelector('.gebeta-nav-icon');
    this._distanceEl = metrics._distanceEl || metrics.querySelector('.gebeta-nav-distance .value');
    this._timeEl = metrics._timeEl || metrics.querySelector('.gebeta-nav-time .value');
    this._mounted = true;
    
    // Bind events after elements are created
    this._bindEvents();
  }

  /**
   * Create the wrapper element
   * Can be overridden to customize wrapper structure
   * @returns {HTMLElement}
   */
  _createWrapper() {
    const wrapper = document.createElement('div');
    wrapper.className = 'gebeta-nav-wrapper';
    return wrapper;
  }

  /**
   * Create the instruction card element
   * Can be overridden to customize instruction display
   * @returns {HTMLElement}
   */
  _createInstructionCard() {
    const instructionCard = document.createElement('div');
    instructionCard.className = 'gebeta-nav-card';
    
    const icon = document.createElement('div');
    icon.className = 'gebeta-nav-icon';
    icon.textContent = '⬆️';
    
    const instructionText = document.createElement('div');
    instructionText.className = 'gebeta-nav-instruction';
    instructionText.textContent = 'Ready';
    
    instructionCard.appendChild(icon);
    instructionCard.appendChild(instructionText);
    
    return instructionCard;
  }

  /**
   * Create the metrics element (distance and time)
   * Can be overridden to customize metrics display
   * @returns {HTMLElement}
   */
  _createMetrics() {
    const metrics = document.createElement('div');
    metrics.className = 'gebeta-nav-metrics';
    
    const distance = document.createElement('div');
    distance.className = 'gebeta-nav-distance gebeta-nav-metric';
    distance.innerHTML = `<div class="label">Distance</div><div class="value">--</div>`;
    
    const time = document.createElement('div');
    time.className = 'gebeta-nav-time gebeta-nav-metric';
    time.innerHTML = `<div class="label">Time</div><div class="value">--</div>`;
    
    metrics.appendChild(distance);
    metrics.appendChild(time);
    
    // Store references for easier access
    metrics._distanceEl = distance.querySelector('.value');
    metrics._timeEl = time.querySelector('.value');
    
    return metrics;
  }

  /**
   * Update the UI with navigation progress data
   * Can be overridden to customize update behavior
   * @param {Object} data - Progress data from NavController
   */
  update(data) {
    if (!this._mounted) return;
    
    if (this._distanceEl && data.remainingDistance !== undefined) {
      const km = data.remainingDistance / 1000;
      this._distanceEl.textContent = `${km.toFixed(km >= 10 ? 0 : 1)} km`;
    }
    
    if (this._timeEl && data.remainingDuration !== undefined) {
      const duration = data.remainingDuration;
      if (typeof duration === 'string') {
        // Already formatted (e.g., "5 min" or "1h 30m")
        this._timeEl.textContent = duration;
      } else if (typeof duration === 'number') {
        // Minutes as number
        if (duration < 60) {
          this._timeEl.textContent = `${duration} min`;
        } else {
          const h = Math.floor(duration / 60);
          const m = duration % 60;
          this._timeEl.textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
        }
      }
    }
  }

  /**
   * Set the instruction text and icon
   * Can be overridden to customize instruction display
   * @param {Object} step - Instruction step object
   */
  _setInstruction(step) {
    if (!this._instructionEl || !this._instructionIconEl) return;
    
    if (!step) {
      this._instructionEl.textContent = 'Continue';
      this._instructionIconEl.textContent = '⬆️';
      return;
    }
    
    // Use icon from step if available, otherwise default
    const icon = step.icon || '⬆️';
    const instruction = step.instruction || step.path || step.turn || 'Continue';
    
    this._instructionIconEl.textContent = icon;
    this._instructionEl.textContent = instruction;
  }

  /**
   * Hide/unmount the UI
   */
  hide() {
    if (this._container && this._container.parentElement) {
      this._container.parentElement.removeChild(this._container);
    }
    this._container = null;
    this._mounted = false;
  }

  /**
   * Inject default styles
   * Can be overridden to customize styles
   */
  _injectStyles() {
    if (document.getElementById('gebeta-nav-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'gebeta-nav-styles';
    style.textContent = this._getStyles();
    document.head.appendChild(style);
  }

  /**
   * Get the default CSS styles
   * Can be overridden to return custom styles
   * @returns {string}
   */
  _getStyles() {
    return `
      .gebeta-nav-wrapper {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 1200;
        width: min(460px, calc(100vw - 20px));
      }
      .gebeta-nav-card, .gebeta-nav-metrics {
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 8px 18px rgba(0,0,0,0.12);
        padding: 12px 16px;
        display: flex;
        align-items: center;
      }
      .gebeta-nav-card {
        gap: 12px;
      }
      .gebeta-nav-icon {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        background: #0c7bdc;
        color: #fff;
        display: grid;
        place-items: center;
        font-size: 20px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .gebeta-nav-instruction {
        flex: 1;
        font-size: 16px;
        font-weight: 600;
        color: #333;
      }
      .gebeta-nav-metrics {
        justify-content: space-around;
        gap: 20px;
      }
      .gebeta-nav-metric {
        text-align: center;
        flex: 1;
      }
      .gebeta-nav-metric .label {
        font-size: 12px;
        color: #666;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .gebeta-nav-metric .value {
        font-size: 18px;
        font-weight: 700;
        color: #333;
      }
    `;
  }
}

