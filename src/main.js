import GebetaMaps from './GebetaMaps.js'
import { NavigationUI } from './NavigationUI.js'

// Expose GebetaMaps and NavigationUI globally for CDN consumers
window.GebetaMaps = GebetaMaps
window.NavigationUI = NavigationUI

// Export for ES modules
export { NavigationUI }
export default GebetaMaps
