import { describe, expect, it } from 'vitest';
import {
    canDownloadSlideType,
    canRoleDownloadInAdmin,
    canRolePrintPdfInAdmin,
    effectiveRoleKey,
    type SlideDownloadPermissionData,
} from '../slide-download-permission';

/** The live Shiksha Nation blob at the time this rule was written. */
const SN_SETTING: SlideDownloadPermissionData = {
    version: 1,
    slideTypes: {
        VIDEO: { roles: { ADMIN: true, LEARNER: false, TEACHER: true } },
        ASSIGNMENT: { roles: { ADMIN: true, LEARNER: false, TEACHER: true } },
        DOCUMENT_PDF: { roles: { ADMIN: true, LEARNER: false, TEACHER: false } },
        DOCUMENT_CODE: { roles: { ADMIN: true, LEARNER: false, TEACHER: true } },
        DOCUMENT_PDF_PRINT: { roles: { ADMIN: true, LEARNER: false, TEACHER: false } },
    },
};

describe('effectiveRoleKey', () => {
    it('ranks ADMIN above a co-held STUDENT/LEARNER', () => {
        expect(effectiveRoleKey(['STUDENT', 'ADMIN'])).toBe('ADMIN');
        expect(effectiveRoleKey(['ADMIN', 'STUDENT'])).toBe('ADMIN');
    });

    it('ranks TEACHER above LEARNER but below ADMIN', () => {
        expect(effectiveRoleKey(['STUDENT', 'TEACHER'])).toBe('TEACHER');
        expect(effectiveRoleKey(['TEACHER', 'ADMIN', 'STUDENT'])).toBe('ADMIN');
    });

    it('returns null when only custom roles are held', () => {
        expect(effectiveRoleKey(['COUNSELLOR'])).toBeNull();
        expect(effectiveRoleKey([])).toBeNull();
    });
});

describe('an admin who is also enrolled as a student', () => {
    const roles = ['STUDENT', 'ADMIN'];

    it.each(['DOCUMENT_PDF', 'DOCUMENT_CODE', 'VIDEO', 'ASSIGNMENT'])(
        'downloads %s in the learner app on the ADMIN cell',
        (typeKey) => {
            expect(canDownloadSlideType(SN_SETTING, typeKey, roles)).toBe(true);
        }
    );

    it('is not blocked in the admin authoring app by the LEARNER cell', () => {
        expect(canRoleDownloadInAdmin(SN_SETTING, 'DOCUMENT_PDF', roles)).toBe(true);
    });

    it('may print a PDF when ADMIN print is on', () => {
        expect(canRolePrintPdfInAdmin(SN_SETTING, roles)).toBe(true);
    });
});

describe('restrictions still bind the role they target', () => {
    it('blocks a plain learner', () => {
        expect(canDownloadSlideType(SN_SETTING, 'DOCUMENT_PDF', ['STUDENT'])).toBe(false);
        expect(canRoleDownloadInAdmin(SN_SETTING, 'DOCUMENT_PDF', ['STUDENT'])).toBe(false);
    });

    it('blocks a teacher on PDF but allows them video, per their own row', () => {
        const teacher = ['TEACHER', 'STUDENT'];
        expect(canDownloadSlideType(SN_SETTING, 'DOCUMENT_PDF', teacher)).toBe(false);
        expect(canDownloadSlideType(SN_SETTING, 'VIDEO', teacher)).toBe(true);
    });

    it('honours an explicit ADMIN:false', () => {
        const locked: SlideDownloadPermissionData = {
            version: 1,
            slideTypes: { DOCUMENT_PDF: { roles: { ADMIN: false, LEARNER: true } } },
        };
        expect(canDownloadSlideType(locked, 'DOCUMENT_PDF', ['STUDENT', 'ADMIN'])).toBe(false);
        expect(canRoleDownloadInAdmin(locked, 'DOCUMENT_PDF', ['STUDENT', 'ADMIN'])).toBe(false);
    });
});

describe('unchanged behaviour', () => {
    it('falls back to role-aware defaults when a cell is unconfigured', () => {
        expect(canDownloadSlideType(null, 'DOCUMENT_PDF', ['ADMIN'])).toBe(true);
        expect(canDownloadSlideType(null, 'DOCUMENT_PDF', ['STUDENT'])).toBe(false);
        expect(canDownloadSlideType(null, 'DOCUMENT_PDF', [])).toBe(false);
    });

    it('keeps deny-wins for users holding only custom roles', () => {
        const data: SlideDownloadPermissionData = {
            version: 1,
            slideTypes: { VIDEO: { roles: { COUNSELLOR: false, MENTOR: true } } },
        };
        expect(canDownloadSlideType(data, 'VIDEO', ['MENTOR', 'COUNSELLOR'])).toBe(false);
        expect(canDownloadSlideType(data, 'VIDEO', ['MENTOR'])).toBe(true);
    });

    it('inherits PDF download when print is unconfigured for the deciding role', () => {
        const data: SlideDownloadPermissionData = {
            version: 1,
            slideTypes: { DOCUMENT_PDF: { roles: { ADMIN: false, LEARNER: false } } },
        };
        expect(canRolePrintPdfInAdmin(data, ['STUDENT', 'ADMIN'])).toBe(false);
    });

    it('does not let a LEARNER print cell hijack the admin', () => {
        const data: SlideDownloadPermissionData = {
            version: 1,
            slideTypes: {
                DOCUMENT_PDF: { roles: { ADMIN: true, LEARNER: false } },
                DOCUMENT_PDF_PRINT: { roles: { LEARNER: false } },
            },
        };
        // ADMIN has no explicit print cell → inherits ADMIN's PDF download (true).
        expect(canRolePrintPdfInAdmin(data, ['STUDENT', 'ADMIN'])).toBe(true);
        expect(canRolePrintPdfInAdmin(data, ['STUDENT'])).toBe(false);
    });
});
