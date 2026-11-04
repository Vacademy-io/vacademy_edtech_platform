/**
 * #/whiteboard — full-screen touch whiteboard, works signed out.
 * Lazy-loaded by PanelApp (`lazy(() => import('./whiteboard'))`), so the
 * Excalidraw fork stays out of the initial bundle. PanelApp wraps this screen
 * in a Suspense (loading) and a per-screen error boundary (error state).
 */
import { PanelWhiteboard } from './PanelWhiteboard';

export default function WhiteboardScreen() {
    return <PanelWhiteboard />;
}
