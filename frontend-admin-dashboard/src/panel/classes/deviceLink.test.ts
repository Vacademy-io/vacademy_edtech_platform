import { describe, expect, it } from 'vitest';
import { buildDeviceStartUrl, deviceStartAddress } from './deviceLink';

describe('buildDeviceStartUrl', () => {
    it('is host, path and a fragment with the two ids only', () => {
        const url = buildDeviceStartUrl('https://dash.example.test', 'sched-1', 'inst-a');
        expect(url).toBe('https://dash.example.test/classroom#s=sched-1&i=inst-a');
        const parsed = new URL(url!);
        expect(parsed.search).toBe('');
        expect(parsed.username + parsed.password).toBe('');
        expect(parsed.pathname).toBe('/classroom');
    });

    it('does not double the scheme or a slash', () => {
        expect(buildDeviceStartUrl('https://a.test/', 's', 'i')).toBe(
            'https://a.test/classroom#s=s&i=i'
        );
    });

    it('encodes ids so they cannot add fragment fields', () => {
        expect(buildDeviceStartUrl('https://a.test', 's&t=1', 'i#2')).toBe(
            'https://a.test/classroom#s=s%26t%3D1&i=i%232'
        );
    });

    it.each([null, undefined, '', 'dash.example.test', 'javascript:alert(1)', 'https://a.test/x'])(
        'refuses a base of %s',
        (base) => {
            expect(buildDeviceStartUrl(base, 's', 'i')).toBeNull();
        }
    );

    it('needs both ids', () => {
        expect(buildDeviceStartUrl('https://a.test', '', 'i')).toBeNull();
        expect(buildDeviceStartUrl('https://a.test', 's', '')).toBeNull();
    });
});

describe('deviceStartAddress', () => {
    it('reads as something to type', () => {
        expect(deviceStartAddress('https://dash.example.test/')).toBe(
            'dash.example.test/classroom'
        );
    });
});
