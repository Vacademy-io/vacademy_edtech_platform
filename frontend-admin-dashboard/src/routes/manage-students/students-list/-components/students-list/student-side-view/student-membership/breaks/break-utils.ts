import { formatDate } from '@/lib/formatters';
import type { EnrolmentBreak } from '@/services/enrolment-breaks';

/** Reasons offered as quick picks; stored as the code, shown translated. */
export const BREAK_REASONS = [
    'TRAVEL',
    'EXAMS',
    'HEALTH',
    'FAMILY',
    'PAYMENT_PROMISED',
    'FINANCIAL',
    'OTHER',
] as const;

/** Quick lengths for the last-day picker, in days (inclusive of the first day). */
export const QUICK_LENGTHS = [7, 14, 30, 45] as const;

/** "2026-12-01" as a local date (never shifted by the viewer's UTC offset). */
export const parseDay = (iso?: string | null): Date | null => {
    if (!iso) return null;
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
};

export const toDayString = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export const addDaysTo = (iso: string, days: number): string => {
    const base = parseDay(iso) ?? new Date();
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    return toDayString(next);
};

/** A day (YYYY-MM-DD) in the active locale, e.g. "1 Dec 2026". */
export const formatDay = (iso?: string | null): string => {
    const date = parseDay(iso);
    return date ? formatDate(date) : '';
};

/** A full timestamp's date part in the active locale. */
export const formatInstant = (iso?: string | null): string => (iso ? formatDate(iso) : '');

export type BreakTone = 'warning' | 'info' | 'neutral';

/** The status pill key and colour for a break. */
export const breakStatusKey = (b: EnrolmentBreak): { key: string; tone: BreakTone } => {
    if (b.status === 'ACTIVE')
        return { key: b.kind === 'PAUSE' ? 'paused' : 'onHold', tone: 'warning' };
    if (b.status === 'SCHEDULED') {
        return { key: b.kind === 'PAUSE' ? 'scheduledPause' : 'scheduledHold', tone: 'info' };
    }
    return { key: b.status === 'CANCELLED' ? 'cancelled' : 'ended', tone: 'neutral' };
};

export const toneClasses: Record<BreakTone, string> = {
    warning: 'bg-warning-50 text-warning-700 ring-warning-200',
    info: 'bg-info-50 text-info-700 ring-info-200',
    neutral: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
};

/** Whole days from the first day to the last day, inclusive; null when open-ended. */
export const lengthInDays = (startsOn: string, endsOn: string | null): number | null => {
    const a = parseDay(startsOn);
    const b = parseDay(endsOn);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
};

/** Toggle chip (quick lengths, reasons): selected state, hover and a visible keyboard focus ring. */
export const chipClasses = (active: boolean): string =>
    [
        'rounded-full px-3 py-1 text-caption ring-1 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
        active
            ? 'bg-primary-50 text-primary-600 ring-primary-300'
            : 'text-neutral-600 ring-neutral-200 hover:bg-neutral-50',
    ].join(' ');

/** Today in the viewer's own calendar (fallback only; the server sends the institute's today). */
export const localToday = (): string => toDayString(new Date());
