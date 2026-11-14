/**
 * Panel stub for the Excalidraw fork's subset/subset-main.ts (wired through the
 * REDIRECTS map in vite.panel.config.ts).
 *
 * The real module lazy-loads a ~1.8 MB (725 KB gz) harfbuzz/woff2 wasm chunk
 * and a {type:"module"} worker (Chrome 80+) to subset fonts. Only exportToSvg
 * (inlining fonts into an SVG) reaches it; panels render with exportToCanvas /
 * exportToBlob.
 *
 * The stub does what the real module does when subsetting fails
 * (subset-shared.chunk.ts: catch -> toBase64(arrayBuffer)): it returns the
 * whole, unsubsetted woff2 as a data URL. Throwing instead would make
 * ExcalidrawFontFace.getContent() try every registered URL, including the
 * esm.sh CDN fallback.
 */
// Same call signature as the real export; codepoints are ignored (no subsetting).
export const subsetWoff2GlyphsByCodepoints: (
    arrayBuffer: ArrayBuffer,
    codePoints: Array<number>
) => Promise<string> = (arrayBuffer) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            resolve(`data:font/woff2;base64,${comma >= 0 ? result.slice(comma + 1) : ''}`);
        };
        reader.onerror = () => reject(reader.error || new Error('Could not read font data'));
        reader.readAsDataURL(new Blob([arrayBuffer], { type: 'font/woff2' }));
    });
