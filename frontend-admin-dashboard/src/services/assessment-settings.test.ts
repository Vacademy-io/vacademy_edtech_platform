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

describe('Question paper folders setting', () => {
    it('is off when it was never saved', () => {
        expect(mergeWithDefaults({}).questionPaperFolders).toEqual({ enabled: false });
    });

    it('keeps the saved switch, apart from the assessment folders switch', () => {
        const merged = mergeWithDefaults({
            questionPaperFolders: { enabled: true },
            assessmentFolders: { enabled: false },
        });
        expect(merged.questionPaperFolders).toEqual({ enabled: true });
        expect(merged.assessmentFolders).toEqual({ enabled: false });
    });

    it('only a real true turns it on', () => {
        expect(
            mergeWithDefaults({ questionPaperFolders: { enabled: 'true' as never } })
                .questionPaperFolders
        ).toEqual({ enabled: false });
    });
});

describe('learner request notifications', () => {
    it('keeps the roles and channels the admin saved', () => {
        const merged = mergeWithDefaults({
            learnerRequestNotifications: {
                version: 1,
                roles: { ADMIN: false, TEACHER: true },
                channels: { inApp: true, email: false },
            },
        });
        expect(merged.learnerRequestNotifications).toEqual({
            version: 1,
            roles: { ADMIN: false, TEACHER: true },
            channels: { inApp: true, email: false },
        });
    });

    it('gives an institute that never saved it both channels and the role defaults', () => {
        expect(mergeWithDefaults({}).learnerRequestNotifications).toEqual({
            version: 1,
            roles: {},
            channels: { inApp: true, email: true },
        });
    });
});
