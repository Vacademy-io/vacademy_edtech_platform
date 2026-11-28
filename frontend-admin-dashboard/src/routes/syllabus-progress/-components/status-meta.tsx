import type { TFunction } from 'i18next';
import { ArrowArcRight, CheckCircle, Circle, CircleHalf, type Icon } from '@phosphor-icons/react';
import type { SyllabusBlock, SyllabusStatus } from '@/services/syllabus-progress';

/** Colour + icon per status. Icons differ too, so status never relies on colour alone. */
export const STATUS_META: Record<
    SyllabusStatus,
    { icon: Icon; chip: string; text: string; labelKey: string }
> = {
    NOT_STARTED: {
        icon: Circle,
        chip: 'border-neutral-200 bg-card text-neutral-400 hover:border-neutral-400',
        text: 'text-neutral-500',
        labelKey: 'status.NOT_STARTED',
    },
    IN_PROGRESS: {
        icon: CircleHalf,
        chip: 'border-warning-200 bg-warning-50 text-warning-700 hover:border-warning-400',
        text: 'text-warning-700',
        labelKey: 'status.IN_PROGRESS',
    },
    COMPLETED: {
        icon: CheckCircle,
        chip: 'border-success-200 bg-success-50 text-success-700 hover:border-success-400',
        text: 'text-success-700',
        labelKey: 'status.COMPLETED',
    },
    SKIPPED: {
        icon: ArrowArcRight,
        chip: 'border-info-200 bg-info-50 text-info-700 hover:border-info-400',
        text: 'text-info-700',
        labelKey: 'status.SKIPPED',
    },
};

/** "W1–4" (or "W5" for a one-week block). */
export const blockShortLabel = (block: SyllabusBlock, t: TFunction): string =>
    block.week_from === block.week_to
        ? t('block.weekShort', { week: block.week_from })
        : t('block.weeksShort', { from: block.week_from, to: block.week_to });

/** "Weeks 1–4 · Bija · Month 1" for dialog titles and screen readers. */
export const blockLongLabel = (block: SyllabusBlock, t: TFunction): string => {
    const weeks =
        block.week_from === block.week_to
            ? t('block.week', { week: block.week_from })
            : t('block.weeks', { from: block.week_from, to: block.week_to });
    const parts = [weeks];
    if (block.trimester) parts.push(block.trimester);
    if (block.month_no != null) parts.push(t('block.month', { month: block.month_no }));
    return parts.join(' · ');
};

export const formatDate = (iso: string | null | undefined, lang: string): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
};
