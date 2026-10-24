import { describe, expect, it } from 'vitest';
import {
    formatDuration,
    formatRate,
    formatRating,
    platformKey,
    platformLabelKey,
    presetForRange,
    rangeForPreset,
    rangeLengthDays,
    rateTone,
    ratingTone,
} from './dashboard-format';

const TODAY = new Date(2026, 8, 27); // 27 Sep 2026, local time

describe('dashboard date presets', () => {
    it('"last 5 days" is today and the four days before it', () => {
        expect(rangeForPreset('last5', TODAY)).toEqual({ start: '2026-09-23', end: '2026-09-27' });
        expect(rangeLengthDays('2026-09-23', '2026-09-27')).toBe(5);
    });

    it('"next 7 days" starts today', () => {
        expect(rangeForPreset('next7', TODAY)).toEqual({ start: '2026-09-27', end: '2026-10-03' });
    });

    it('recognises a preset range and reports a custom one as null', () => {
        expect(presetForRange('2026-08-29', '2026-09-27', TODAY)).toBe('last30');
        expect(presetForRange('2026-09-01', '2026-09-27', TODAY)).toBeNull();
    });

    it('a reversed or unparseable range has no length', () => {
        expect(rangeLengthDays('2026-09-27', '2026-09-01')).toBe(0);
        expect(rangeLengthDays('', '2026-09-01')).toBe(0);
    });
});

describe('dashboard number formatting', () => {
    it('shows a dash, not 0%, when there was nothing to divide by', () => {
        expect(formatRate(null)).toBe('—');
        expect(formatRate(0)).toBe('0%');
        expect(formatRate(0.482)).toBe('48%');
        expect(formatRating(null)).toBe('—');
        expect(formatRating(4.64)).toBe('4.6');
    });

    it('formats minutes as hours and minutes with caller-supplied units', () => {
        const units = { h: 'h', m: 'm' };
        expect(formatDuration(45, units)).toBe('45m');
        expect(formatDuration(80, units)).toBe('1h 20m');
        expect(formatDuration(120, units)).toBe('2h');
        expect(formatDuration(null, units)).toBe('—');
    });

    it('bands rates and ratings into tones', () => {
        expect(rateTone(0.8)).toBe('success');
        expect(rateTone(0.5)).toBe('warning');
        expect(rateTone(0.2)).toBe('danger');
        expect(rateTone(null)).toBe('neutral');
        expect(ratingTone(4.2)).toBe('success');
        expect(ratingTone(3.1)).toBe('warning');
        expect(ratingTone(2)).toBe('danger');
    });

    it('folds unknown platforms into "other" and makes space-free label keys', () => {
        expect(platformKey('bbb')).toBe('bbb');
        expect(platformKey('teams')).toBe('other');
        expect(platformLabelKey('google meet')).toBe('google_meet');
    });
});
