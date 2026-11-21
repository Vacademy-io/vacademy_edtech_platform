/**
 * Code 128, code set B, as bar widths for an SVG (owner decision 2026-11-18:
 * labels are printed from the browser, and many USB scanners read only 1D
 * codes, so every label carries this barcode of its code). Pure and unit-tested.
 *
 * A symbol is 3 bars and 3 spaces, 11 modules wide (the stop is 4 bars and
 * 3 spaces, 13 modules). The check symbol is (104 + Σ value × position) mod 103.
 * A quiet zone of 10 modules is kept on each side.
 */

/** Bar/space widths of every symbol value 0..106 (ISO/IEC 15417 table). */
export const CODE128_PATTERNS: readonly string[] = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const START_B = 104;
export const STOP = 106;
export const QUIET_ZONE_MODULES = 10;

export interface Code128 {
    /** Symbol values: start, data, check, stop. */
    values: number[];
    checksum: number;
    /** Alternating bar and space widths in modules, starting with a bar. */
    widths: number[];
    /** Width of the symbols without the quiet zones. */
    modules: number;
}

/** Code set B covers printable ASCII (space to tilde). */
export const isCode128B = (text: string): boolean => text.length > 0 && /^[\x20-\x7E]+$/.test(text);

export function encodeCode128B(text: string): Code128 {
    if (!isCode128B(text)) throw new Error('Code 128 B takes printable ASCII only');
    const data = Array.from(text, (ch) => ch.charCodeAt(0) - 32);
    const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), START_B) % 103;
    const values = [START_B, ...data, checksum, STOP];
    const widths = values.flatMap((value) => Array.from(CODE128_PATTERNS[value] as string, Number));
    return { values, checksum, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

/** The bars as rectangles in module units, after the left quiet zone. */
export function code128Bars(text: string): { bars: { x: number; width: number }[]; totalModules: number } {
    const { widths, modules } = encodeCode128B(text);
    const bars: { x: number; width: number }[] = [];
    let x = QUIET_ZONE_MODULES;
    widths.forEach((width, index) => {
        if (index % 2 === 0) bars.push({ x, width });
        x += width;
    });
    return { bars, totalModules: modules + 2 * QUIET_ZONE_MODULES };
}
