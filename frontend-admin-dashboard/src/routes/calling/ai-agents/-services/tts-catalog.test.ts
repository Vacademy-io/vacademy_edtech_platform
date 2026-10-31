import { describe, expect, it } from 'vitest';
import { normalizeTtsModel, voiceLabel } from './tts-catalog';

describe('Sarvam Bulbul v4 Flash', () => {
    it('is its own engine, never read as v3', () => {
        expect(normalizeTtsModel('sarvam_v4')).toBe('sarvam_v4');
        expect(normalizeTtsModel('bulbul:v4-flash')).toBe('sarvam_v4');
        expect(normalizeTtsModel('sarvam')).toBe('sarvam');
        expect(normalizeTtsModel('bulbul:v3')).toBe('sarvam');
    });

    it('shows a v4 voice by its label and others by their id', () => {
        expect(
            voiceLabel({
                id: 'shubh_enhi_ads',
                gender: 'male',
                model: 'sarvam_v4',
                label: 'Shubh · Hinglish · ads',
            })
        ).toBe('Shubh · Hinglish · ads');
        expect(voiceLabel({ id: 'priya', gender: 'female', model: 'sarvam' })).toBe('Priya');
    });
});
