import { describe, expect, it } from 'vitest';
import { classCapability } from './capability';

const FLAG_OFF = 9999;

describe('classCapability, the WebView table', () => {
    it.each([66, 74, 83, 91, 98, 109, 130])('flag off at %i: BBB goes to the device', (major) => {
        expect(classCapability('bbb', major, FLAG_OFF)).toBe('device');
    });

    it.each([
        [66, 'device'],
        [74, 'device'],
        [83, 'device'],
        [91, 'here'],
        [98, 'here'],
        [109, 'here'],
    ])('flag at 91, WebView %i: BBB is %s', (major, expected) => {
        expect(classCapability('bbb', major as number, 91)).toBe(expected);
    });

    it.each([66, 83])('no flag value turns BBB on below its own gate (%i)', (major) => {
        expect(classCapability('bbb', major, 1)).toBe('device');
    });

    it('an unknown WebView version goes to the device', () => {
        expect(classCapability('bbb', 0, 1)).toBe('device');
    });

    it.each(['zoom', 'meet'] as const)('%s is always the device', (provider) => {
        [66, 91, 109, 130].forEach((major) => {
            expect(classCapability(provider, major, 91)).toBe('device');
        });
    });

    it.each(['zoho', 'external'] as const)('%s always opens externally', (provider) => {
        [66, 91, 109].forEach((major) => {
            expect(classCapability(provider, major, FLAG_OFF)).toBe('external');
        });
    });

    it('nothing to open is none', () => {
        expect(classCapability(null, 109, 91)).toBe('none');
    });
});
