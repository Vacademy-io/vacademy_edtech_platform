/** Learner-facing sample text for templates and the current-home conversion, in the admin's language. */
import type { ConversionCopy } from './legacy-conversion';
import { clipTemplateCopy, type TemplateCopy } from './templates';

type Translate = (key: string) => string;

export function templateCopy(t: Translate): TemplateCopy {
    return clipTemplateCopy({
        tiles: {
            courses: t('link.features.COURSES'),
            liveClasses: t('link.features.LIVE_CLASSES'),
            assessments: t('link.features.ASSESSMENTS'),
            doubts: t('link.features.DOUBTS'),
            homework: t('link.features.HOMEWORK'),
            attendance: t('link.features.ATTENDANCE'),
            notebook: t('link.features.NOTEBOOK'),
            reports: t('link.features.REPORTS'),
            freeCourses: t('shelf.sources.FREE'),
            memberships: t('link.features.STORE_MEMBERSHIPS'),
            referral: t('link.features.REFERRAL'),
        },
        shelves: {
            newest: t('shelf.sources.NEWEST'),
            free: t('shelf.sources.FREE'),
            tag: t('shelf.sources.TAG'),
        },
        welcomeNotice: {
            title: t('start.sample.noticeTitle'),
            body: t('start.sample.noticeBody'),
            ackLabel: t('start.sample.ackLabel'),
        },
    });
}

export function conversionCopy(t: Translate): ConversionCopy {
    return {
        untitled: t('start.sample.untitled'),
        open: t('start.sample.open'),
        importedLabel: t('start.sample.imported'),
    };
}
