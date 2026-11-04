/**
 * Panel stub for '@excalidraw/mermaid-to-excalidraw' (vite.panel.config.ts
 * panelRedirects). Keeps mermaid, elkjs and cytoscape out of dist-panel; the
 * fork only reaches it through dynamic imports (App.tsx paste, TTDDialog).
 */
export async function parseMermaidToExcalidraw(): Promise<never> {
    throw new Error('Mermaid is not available on classroom panels');
}
