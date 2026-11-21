import { describe, expect, it } from 'vitest';
import { mergeWithDefaults } from '@/services/assessment-settings';
import { normalizePenStyle } from '@/components/common/ai-copy-check/PenStylePicker';
import {
    EMPTY_COPY_CHECK_SETTINGS,
    toCopyCheckConfig,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';

describe('AI copy checking settings', () => {
    it('keeps every part of the pen the admin saved', () => {
        const penStyle = {
            ink: '#6a1fa0',
            font: 'CEDARVILLE_CURSIVE',
            size: 'LARGE',
            darkness: 70,
        } as const;
        const merged = mergeWithDefaults({
            aiCopyCheck: { commentPlacement: 'INSIDE', penStyle },
        });
        expect(merged.aiCopyCheck?.penStyle).toEqual(penStyle);
        expect(normalizePenStyle(merged.aiCopyCheck?.penStyle)).toEqual(penStyle);
    });

    it('shows an institute with no saved pen the pen its copies really get', () => {
        expect(normalizePenStyle(undefined)).toEqual({
            ink: 'RED',
            font: 'DAWNING_OF_A_NEW_DAY',
            size: 'MEDIUM',
            darkness: 50,
        });
    });

    it('keeps the institute defaults when settings are loaded', () => {
        const merged = mergeWithDefaults({
            aiCopyCheck: {
                commentPlacement: 'OUTSIDE',
                instructions: 'Follow the CBSE scheme.',
                languageFeedback: 'HIGHLIGHT',
            },
        });
        expect(merged.aiCopyCheck).toEqual({
            commentPlacement: 'OUTSIDE',
            instructions: 'Follow the CBSE scheme.',
            languageFeedback: 'HIGHLIGHT',
        });
    });

    it('loads settings saved before these fields existed exactly as before', () => {
        expect(
            mergeWithDefaults({ aiCopyCheck: { commentPlacement: 'INSIDE' } }).aiCopyCheck
        ).toEqual({
            commentPlacement: 'INSIDE',
        });
        expect(mergeWithDefaults({}).aiCopyCheck).toEqual({ commentPlacement: 'INSIDE' });
    });

    it('sends trimmed values and blanks as null', () => {
        expect(
            toCopyCheckConfig({
                subject: '  English ',
                level: ' ',
                instructions: '',
                languageFeedback: 'HIGHLIGHT',
            })
        ).toEqual({
            subject: 'English',
            level: null,
            instructions: null,
            language_feedback: 'HIGHLIGHT',
        });
        expect(toCopyCheckConfig(EMPTY_COPY_CHECK_SETTINGS).language_feedback).toBe('OFF');
    });
});

describe('Evalezy settings', () => {
    it('is on with camera and upload for an institute that never saved it', () => {
        expect(mergeWithDefaults({}).evalezy).toEqual({
            enabled: true,
            allowCamera: true,
            allowUpload: true,
            scanQuality: 'STANDARD',
            notifyEmail: true,
        });
    });

    it('keeps what the institute turned off and drops unknown values', () => {
        expect(
            mergeWithDefaults({
                evalezy: {
                    enabled: false,
                    allowCamera: false,
                    allowUpload: true,
                    // a value from a newer/older build must not leak through
                    scanQuality: 'ULTRA' as never,
                    notifyEmail: false,
                },
            }).evalezy
        ).toEqual({
            enabled: false,
            allowCamera: false,
            allowUpload: true,
            scanQuality: 'STANDARD',
            notifyEmail: false,
        });
    });
});
