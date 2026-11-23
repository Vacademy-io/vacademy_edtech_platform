import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    accessIntentOfPlan,
    clearAccessIntent,
    parseAccessIntent,
    rememberAccessIntent,
    takeAccessIntent,
} from './product-access-intent';

describe('product access intent', () => {
    afterEach(() => {
        localStorage.clear();
        vi.useRealTimers();
    });

    it('reads the website mode', () => {
        expect(parseAccessIntent('API')).toBe('API');
        expect(parseAccessIntent('dashboard')).toBe('PLATFORM');
        expect(parseAccessIntent('other')).toBeNull();
        expect(parseAccessIntent(undefined)).toBeNull();
    });

    it('tells an API plan from a dashboard one', () => {
        expect(accessIntentOfPlan('api-pro')).toBe('API');
        expect(accessIntentOfPlan('pro')).toBe('PLATFORM');
        expect(accessIntentOfPlan('')).toBeNull();
    });

    it('is read once, for its own product only', () => {
        rememberAccessIntent('API', 'telleo');
        expect(takeAccessIntent('evalezy')).toBeNull();
        rememberAccessIntent('API', 'telleo');
        expect(takeAccessIntent('telleo')).toBe('API');
        expect(takeAccessIntent('telleo')).toBeNull();
    });

    it('expires after a day and can be cleared', () => {
        vi.useFakeTimers();
        rememberAccessIntent('PLATFORM', 'telleo');
        vi.advanceTimersByTime(25 * 60 * 60 * 1000);
        expect(takeAccessIntent('telleo')).toBeNull();
        rememberAccessIntent('PLATFORM', 'telleo');
        clearAccessIntent();
        expect(takeAccessIntent('telleo')).toBeNull();
    });
});
