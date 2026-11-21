import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms } from '@/routes/settings/-components/NamingSettings';
import type { EngagementPlanDTO, StartSourceType } from '../-types/types';

type T = (key: string, options?: Record<string, unknown>) => string;

const TERM: Record<Exclude<StartSourceType, 'COURSE'>, ContentTerms> = {
    SUBJECT: ContentTerms.Subject,
    MODULE: ContentTerms.Module,
    CHAPTER: ContentTerms.Chapter,
};

/**
 * "Chapter", or what the institute calls it in its naming settings. COURSE is "Whole
 * course". `t` is the engagement namespace.
 */
export function sourceTypeLabel(type: StartSourceType, t: T): string {
    const fallback = t(`composer.relative.sourceType.${type}`);
    return type === 'COURSE' ? fallback : getTerminology(TERM[type], fallback);
}

/**
 * "Chapter “Fractions”" (or "the course “Fractions 101”") for a plan that starts when
 * learners complete chosen content, or null for any other plan.
 */
export function startSourceText(
    plan: Partial<
        Pick<
            EngagementPlanDTO,
            'scheduleMode' | 'startTrigger' | 'startSourceType' | 'startSourceName'
        >
    >,
    t: T
): string | null {
    if (
        plan.scheduleMode !== 'RELATIVE' ||
        plan.startTrigger !== 'CONTENT' ||
        !plan.startSourceType
    ) {
        return null;
    }
    const name = plan.startSourceName || t('composer.relative.sourceUnnamed');
    if (plan.startSourceType === 'COURSE') return t('composer.relative.sourceTextCourse', { name });
    return t('composer.relative.sourceText', {
        type: sourceTypeLabel(plan.startSourceType, t),
        name,
    });
}
