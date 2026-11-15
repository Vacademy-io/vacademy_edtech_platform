/**
 * Manager PIN rules, the same ones `CommercePinService.setPin` enforces:
 * 6 to 8 digits, not one repeated digit, not a run that goes up or down by one
 * (123456, 87654321). Checked here only so the person hears it before the round
 * trip; the server decides.
 */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 8;

export type PinProblem = 'format' | 'trivial';

const PIN_FORMAT = /^\d{6,8}$/;

export function isTrivialPin(pin: string): boolean {
    let same = true;
    let up = true;
    let down = true;
    for (let i = 1; i < pin.length; i++) {
        const step = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
        same = same && step === 0;
        up = up && step === 1;
        down = down && step === -1;
    }
    return same || up || down;
}

/** null when the PIN is acceptable as a NEW PIN. */
export function pinProblem(pin: string): PinProblem | null {
    if (!PIN_FORMAT.test(pin)) return 'format';
    return isTrivialPin(pin) ? 'trivial' : null;
}

/** Shape check only, for typing an EXISTING PIN (the server judges the value). */
export const looksLikePin = (pin: string): boolean => PIN_FORMAT.test(pin);

/** Keeps digits only and cuts at the longest PIN, for the input's onChange. */
export const sanitizePinInput = (raw: string): string =>
    raw.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);
