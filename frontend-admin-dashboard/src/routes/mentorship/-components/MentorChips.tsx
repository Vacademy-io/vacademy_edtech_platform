import { Star } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { MentorDTO } from '../-types/mentorship-types';

/**
 * A mentor's rating, or a quiet prompt when nobody has rated them yet. Clicking
 * opens the feedback list — the number is only useful next to what learners said.
 */
export function RatingChip({ mentor, onClick }: { mentor: MentorDTO; onClick: () => void }) {
    const { t } = useTranslation('mentorshipMentorChips');
    const avg = mentor.average_rating;
    const count = mentor.rating_count ?? 0;

    // Nothing is drawn for an unrated mentor: a row of greyed "Not rated" chips is
    // noise, and the absence of a score already carries the same meaning.
    if (avg == null || count === 0) return null;
    return (
        <button
            type="button"
            onClick={onClick}
            title={t('ratingTooltip', { count })}
            className="flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1 text-caption text-warning-700 hover:bg-warning-100"
        >
            <Star size={13} weight="fill" className="text-warning-500" />
            {avg.toFixed(1)}
            <span className="text-warning-600/70">({count})</span>
        </button>
    );
}

/**
 * Mentee count against the mentor's cap. An uncapped mentor just shows the count;
 * a capped one shows load, and turns amber then red as they fill up — so an admin
 * can see who has room before opening the assign dialog.
 */
export function CapacityChip({ mentor }: { mentor: MentorDTO }) {
    const { t } = useTranslation('mentorshipMentorChips');
    const count = mentor.assigned_student_count ?? 0;
    const cap = mentor.max_mentees ?? null;

    if (!cap) {
        return (
            <span
                className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-caption text-neutral-500"
                title={t('noCapTooltip')}
            >
                {count} {t('studentsSuffix', { count })}
            </span>
        );
    }

    const full = mentor.at_capacity ?? count >= cap;
    const nearlyFull = !full && count / cap >= 0.8;
    const tone = full
        ? 'bg-danger-50 text-danger-600'
        : nearlyFull
          ? 'bg-warning-50 text-warning-600'
          : 'bg-neutral-100 text-neutral-500';

    return (
        <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-caption ${tone}`}
            title={
                full
                    ? t('atCapacityTooltip')
                    : t('placesOpenTooltip', { count: cap - count, cap })
            }
        >
            {count}/{cap}
            {full ? ` · ${t('fullSuffix')}` : ` ${t('studentsSuffix', { count })}`}
        </span>
    );
}

/**
 * How full a mentor is, as a bar. The chip above answers "how many"; this answers
 * "how much room is left", which is the question an admin is actually asking when
 * they scan the list looking for someone to assign to.
 */
export function CapacityMeter({ mentor }: { mentor: MentorDTO }) {
    const { t } = useTranslation('mentorshipMentorChips');
    const count = mentor.assigned_student_count ?? 0;
    const cap = mentor.max_mentees ?? null;
    const full = cap != null && (mentor.at_capacity ?? count >= cap);

    return (
        <div className="flex w-full min-w-0 flex-col gap-1">
            <span
                className={cn(
                    'text-caption tabular-nums',
                    full ? 'text-danger-600' : 'text-neutral-600'
                )}
            >
                {count} / {cap ?? '∞'}
                {full ? ` · ${t('fullSuffix')}` : ''}
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                    className={cn(
                        'h-full rounded-full',
                        full ? 'bg-danger-500' : cap ? 'bg-primary-500' : 'bg-primary-300'
                    )}
                    // Data-driven width. Without a cap there is no "full", so an
                    // uncapped mentor shows a token sliver rather than a bar that
                    // would imply a limit they don't have.
                    style={{
                        width: cap ? `${Math.min(100, Math.max(4, (count / cap) * 100))}%` : '18%',
                    }}
                />
            </div>
        </div>
    );
}
