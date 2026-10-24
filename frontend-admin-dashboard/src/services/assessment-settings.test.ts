import { describe, expect, it } from 'vitest';
import { mergeWithDefaults } from '@/services/assessment-settings';
import {
    EMPTY_COPY_CHECK_SETTINGS,
    toCopyCheckConfig,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';

describe('AI copy checking settings', () => {
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
