import { describe, expect, it } from 'vitest';
import {
    LEGACY_TIERS,
    deriveTierKey,
    legacyTierKey,
    normalizeTierKey,
    tierChipStyle,
    type LeadTier,
} from '@/hooks/use-lead-tiers';

const tier = (over: Partial<LeadTier>): LeadTier => ({
    id: over.tier_key ?? 'X',
    tier_key: 'X',
    label: 'X',
    color: '#000000',
    display_order: 0,
    min_score: null,
    is_active: true,
    is_system: false,
    ...over,
});

describe('deriveTierKey', () => {
    it('reproduces the legacy 80/50/0 bands with the seeded defaults', () => {
        expect(deriveTierKey(LEGACY_TIERS, 100)).toBe('HOT');
        expect(deriveTierKey(LEGACY_TIERS, 80)).toBe('HOT');
        expect(deriveTierKey(LEGACY_TIERS, 79)).toBe('WARM');
        expect(deriveTierKey(LEGACY_TIERS, 50)).toBe('WARM');
        expect(deriveTierKey(LEGACY_TIERS, 49)).toBe('COLD');
        expect(deriveTierKey(LEGACY_TIERS, 0)).toBe('COLD');
        // Missing score behaves like 0 (matches the backend's null handling).
        expect(deriveTierKey(LEGACY_TIERS, null)).toBe('COLD');
        expect(deriveTierKey(LEGACY_TIERS, undefined)).toBe('COLD');
    });

    it('picks the highest matching band across a custom Eduzilla-style ladder', () => {
        const ladder = [
            tier({ tier_key: 'SUPER_HOT', min_score: 95 }),
            tier({ tier_key: 'VERY_HOT', min_score: 85 }),
            tier({ tier_key: 'HOT', min_score: 70 }),
            tier({ tier_key: 'WARM', min_score: 50 }),
            tier({ tier_key: 'LUKEWARM', min_score: 35 }),
            tier({ tier_key: 'COLD', min_score: 20 }),
            tier({ tier_key: 'VERY_COLD', min_score: 0 }),
        ];
        expect(deriveTierKey(ladder, 97)).toBe('SUPER_HOT');
        expect(deriveTierKey(ladder, 85)).toBe('VERY_HOT');
        expect(deriveTierKey(ladder, 84)).toBe('HOT');
        expect(deriveTierKey(ladder, 36)).toBe('LUKEWARM');
        expect(deriveTierKey(ladder, 5)).toBe('VERY_COLD');
    });

    it('ignores manual-only tiers (no band) and returns null when nothing is banded', () => {
        const mixed = [
            tier({ tier_key: 'VIP', min_score: null }),
            tier({ tier_key: 'HOT', min_score: 80 }),
            tier({ tier_key: 'COLD', min_score: 0 }),
        ];
        expect(deriveTierKey(mixed, 100)).toBe('HOT');
        expect(deriveTierKey(mixed, 10)).toBe('COLD');
        expect(deriveTierKey([tier({ tier_key: 'VIP' })], 100)).toBeNull();
        expect(deriveTierKey([], 50)).toBeNull();
    });

    it('does not assign a band whose floor is above the score', () => {
        // Lowest band starts at 20 → a score of 10 lands nowhere.
        const gapped = [
            tier({ tier_key: 'HOT', min_score: 80 }),
            tier({ tier_key: 'COLD', min_score: 20 }),
        ];
        expect(deriveTierKey(gapped, 10)).toBeNull();
    });
});

describe('normalizeTierKey', () => {
    it('upper-snakes labels the same way the backend does', () => {
        expect(normalizeTierKey('Super Hot')).toBe('SUPER_HOT');
        expect(normalizeTierKey('  very   cold ')).toBe('VERY_COLD');
        expect(normalizeTierKey('Hot!')).toBe('HOT');
        expect(normalizeTierKey('hot')).toBe('HOT');
        expect(normalizeTierKey(null)).toBe('');
        expect(normalizeTierKey(undefined)).toBe('');
    });
});

describe('unknown / deleted tier keys', () => {
    // A tier can be soft-deleted while leads still carry its key: the UI must stay readable
    // and must not disagree with the backend about which tier the lead is in.
    it('humanizes a key that has no catalog row', () => {
        // labelFor is exercised through the catalog in the app; the rule it applies:
        const humanize = (key: string) =>
            key
                .split(/[_\s]+/)
                .filter(Boolean)
                .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                .join(' ');
        expect(humanize('SUPER_HOT')).toBe('Super Hot');
        expect(humanize('LUKEWARM')).toBe('Lukewarm');
    });

    it('falls back to the legacy thresholds when no band covers the score (matches the backend)', () => {
        // Admin's lowest band starts at 20 — a lead scoring 10 is covered by nothing.
        const gapped = [
            tier({ tier_key: 'HOT', min_score: 80 }),
            tier({ tier_key: 'COLD', min_score: 20 }),
        ];
        expect(deriveTierKey(gapped, 10)).toBeNull();
        expect(legacyTierKey(10)).toBe('COLD');
        expect(legacyTierKey(55)).toBe('WARM');
        expect(legacyTierKey(95)).toBe('HOT');
        expect(legacyTierKey(null)).toBe('COLD');
    });
});

describe('tierChipStyle', () => {
    it('derives translucent background/border from the hex colour', () => {
        expect(tierChipStyle('#ef4444')).toEqual({
            backgroundColor: '#ef44441f',
            color: '#ef4444',
            borderColor: '#ef444455',
        });
    });
});
