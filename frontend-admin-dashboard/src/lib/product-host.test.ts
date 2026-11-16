import { describe, expect, it } from 'vitest';
import { hostProduct, isTelleoHost } from './product-host';

describe('isTelleoHost', () => {
    it('is the telleo host and nothing else', () => {
        expect(isTelleoHost('telleo.vacademy.io')).toBe(true);
        expect(isTelleoHost('TELLEO.vacademy.io')).toBe(true);
        expect(isTelleoHost('dash.vacademy.io')).toBe(false);
        // a client whose own name merely contains the word is not Telleo
        expect(isTelleoHost('telleorealty.com')).toBe(false);
        expect(isTelleoHost('admin.telleo.ai')).toBe(false);
    });
});

describe('hostProduct', () => {
    it('brands each product host with its own product', () => {
        expect(hostProduct('telleo.vacademy.io')).toMatchObject({
            key: 'telleo',
            name: 'Telleo',
            logo: '/telleo-logo.svg',
        });
        expect(hostProduct('evalezy.vacademy.io')).toMatchObject({
            key: 'evalezy',
            logo: '/evalezy-logo.svg',
        });
    });

    it('leaves institute and platform hosts to their own branding', () => {
        expect(hostProduct('dash.vacademy.io')).toBeNull();
        expect(hostProduct('admin.shikshanation.com')).toBeNull();
    });
});
