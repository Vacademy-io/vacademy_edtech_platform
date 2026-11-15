/**
 * GSTIN checks "as typed": 15 characters, the state
 * prefix, the embedded PAN shape and the check character. A convenience for the
 * person typing; the server validates again and the CA confirms the number.
 */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type GstinProblem = 'length' | 'shape' | 'state' | 'checksum';

export const normalizeGstin = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase();

/** The 15th character for the first 14 (GSTN's mod-36 scheme). */
export function gstinCheckCharacter(first14: string): string | null {
    if (first14.length !== 14) return null;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const value = CHARSET.indexOf(first14.charAt(i));
        if (value < 0) return null;
        const product = value * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(product / 36) + (product % 36);
    }
    return CHARSET.charAt((36 - (sum % 36)) % 36);
}

/**
 * null when the GSTIN is well formed. `stateCode` (two digits) is compared with
 * the prefix when given.
 */
export function gstinProblem(raw: string, stateCode?: string | null): GstinProblem | null {
    const gstin = normalizeGstin(raw);
    if (gstin.length !== 15) return 'length';
    if (!GSTIN_SHAPE.test(gstin)) return 'shape';
    if (stateCode && gstin.slice(0, 2) !== stateCode) return 'state';
    return gstinCheckCharacter(gstin.slice(0, 14)) === gstin.charAt(14) ? null : 'checksum';
}

/**
 * GST state and union-territory codes (two digits), for the state select. The
 * names are in the `commerce` strings under `states.<code>`, in Hindi and English.
 */
export const GST_STATE_CODES: readonly string[] = [
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
    '24',
    '26',
    '27',
    '29',
    '30',
    '31',
    '32',
    '33',
    '34',
    '35',
    '36',
    '37',
    '38',
];
