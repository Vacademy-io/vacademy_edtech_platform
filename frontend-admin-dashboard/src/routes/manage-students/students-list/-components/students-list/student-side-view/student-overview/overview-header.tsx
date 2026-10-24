import { StatusChips } from '@/components/design-system/chips';
import { StudentTable } from '@/types/student-table-types';
import { cn } from '@/lib/utils';
import {
    GraduationCap,
    Clock,
    Exam,
    Wallet,
    Target,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface OverviewHeaderProps {
    student: StudentTable | null;
    /** Attendance % (0–100). Pass undefined to render "—". */
    attendancePercent?: number;
    /** Progress % (0–100). Pass undefined to render "—". */
    progressPercent?: number;
    /** Tests attempted/total. Pass undefined to render "—". */
    testsAttempted?: { attempted: number; total: number };
    /** Outstanding amount in INR. Pass undefined to render "—". */
    outstandingAmount?: number;
    /** Lead score 0–100. Pass undefined to skip the tile. */
    leadScore?: number;
}

/**
 * Overview Header — the 4-tile health-stat strip that sits near the top of
 * every learner's Overview tab, per the design handoff's OverviewSection.
 *
 * The earlier "CURRENTLY ENROLLED" band has been dropped: it duplicated
 * data already surfaced by Continue Learning (course + level + session)
 * and Enrolment Details (enrollment#, plan, joined). This component now
 * only renders the at-a-glance health tiles (Attendance / Progress /
 * Tests / Outstanding / Lead Score) — the rest of the identity lives in
 * the sticky sidebar header above.
 *
 * Stat tiles only render when their underlying query has loaded.
 */
export const OverviewHeader = ({
    student,
    attendancePercent,
    progressPercent,
    testsAttempted,
    outstandingAmount,
    leadScore,
}: OverviewHeaderProps) => {
    const { t } = useTranslation('manageStudentsOverviewHeader');

    if (!student) return null;

    // Only show stat tiles we actually have data for. An empty/all-undefined
    // strip is removed entirely — no walls of em-dashes for unloaded data.
    const tiles: Array<{
        label: string;
        icon: PhosphorIcon;
        value: string;
        tone: Tone;
        hint?: string;
    }> = [];
    if (progressPercent != null) {
        tiles.push({
            label: t('tiles.courseProgress.label'),
            icon: GraduationCap,
            value: `${Math.round(progressPercent)}%`,
            tone:
                progressPercent >= 75
                    ? 'success'
                    : progressPercent >= 25
                      ? 'warning'
                      : 'danger',
            hint:
                progressPercent >= 75
                    ? t('tiles.courseProgress.hint.onTrack')
                    : progressPercent >= 25
                      ? t('tiles.courseProgress.hint.paceCheckNeeded')
                      : t('tiles.courseProgress.hint.behindSchedule'),
        });
    }
    if (attendancePercent != null) {
        tiles.push({
            label: t('tiles.attendance.label'),
            icon: Clock,
            value: `${Math.round(attendancePercent)}%`,
            tone:
                attendancePercent >= 75
                    ? 'success'
                    : attendancePercent >= 50
                      ? 'warning'
                      : 'danger',
            hint:
                attendancePercent >= 75
                    ? t('tiles.attendance.hint.aboveTarget')
                    : attendancePercent >= 50
                      ? t('tiles.attendance.hint.watchList')
                      : t('tiles.attendance.hint.belowTarget'),
        });
    }
    if (testsAttempted) {
        tiles.push({
            label: t('tiles.tests.label'),
            icon: Exam,
            value: `${testsAttempted.attempted}/${testsAttempted.total}`,
            tone: 'neutral',
            hint:
                testsAttempted.total > 0 && testsAttempted.attempted < testsAttempted.total
                    ? t('tiles.tests.hint.pending', {
                          count: testsAttempted.total - testsAttempted.attempted,
                      })
                    : undefined,
        });
    }
    if (outstandingAmount != null) {
        tiles.push({
            label: t('tiles.outstanding.label'),
            icon: Wallet,
            value:
                outstandingAmount > 0
                    ? `₹${outstandingAmount.toLocaleString('en-IN')}`
                    : '₹0',
            tone: outstandingAmount > 0 ? 'danger' : 'success',
            hint:
                outstandingAmount > 0
                    ? t('tiles.outstanding.hint.actionRequired')
                    : t('tiles.outstanding.hint.paidInFull'),
        });
    }
    if (leadScore != null) {
        tiles.push({
            label: t('tiles.leadScore.label'),
            icon: Target,
            value: `${Math.round(leadScore)} / 100`,
            tone:
                leadScore >= 70
                    ? 'success'
                    : leadScore >= 40
                      ? 'warning'
                      : 'danger',
            hint:
                leadScore >= 70
                    ? t('tiles.leadScore.hint.hotLead')
                    : leadScore >= 40
                      ? t('tiles.leadScore.hint.nurture')
                      : t('tiles.leadScore.hint.cold'),
        });
    }

    if (tiles.length === 0) return null;

    // Flat health-stat strip per handoff OverviewSection: a single grid of
    // bordered tiles, no outer hero band. The tile count adapts so partially-
    // loaded data still looks intentional rather than ragged.
    return (
        <div
            className={cn(
                'grid gap-3',
                tiles.length === 1 && 'grid-cols-1',
                tiles.length === 2 && 'grid-cols-2',
                tiles.length === 3 && 'grid-cols-3',
                tiles.length >= 4 && 'grid-cols-2 md:grid-cols-4'
            )}
        >
            {tiles.map((t) => (
                <StatTile
                    key={t.label}
                    label={t.label}
                    icon={t.icon}
                    value={t.value}
                    tone={t.tone}
                    hint={t.hint}
                />
            ))}
        </div>
    );
};

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

// StatTile maps to the handoff's StatTile primitive: bordered card with
// uppercase LABEL + bold VALUE on the LEFT and a tone-tinted icon CHIP on
// the RIGHT, optionally followed by a single-line hint below the value.
// Mirrors the handoff snapshot tile layout where the metric leads and the
// icon is a decorative tone marker, not the primary read.
const TONE_CLASSES: Record<
    Tone,
    { value: string; iconBg: string; iconFg: string }
> = {
    neutral: {
        value: 'text-card-foreground',
        iconBg: 'bg-muted',
        iconFg: 'text-muted-foreground',
    },
    success: {
        value: 'text-card-foreground',
        iconBg: 'bg-success-50',
        iconFg: 'text-success-600',
    },
    warning: {
        value: 'text-card-foreground',
        iconBg: 'bg-warning-50',
        iconFg: 'text-warning-600',
    },
    danger: {
        value: 'text-danger-700',
        iconBg: 'bg-danger-50',
        iconFg: 'text-danger-600',
    },
};

const StatTile = ({
    label,
    icon: Icon,
    value,
    tone,
    hint,
}: {
    label: string;
    icon: PhosphorIcon;
    value: string;
    tone: Tone;
    /** Optional single-line caption rendered below the value (handoff hint). */
    hint?: string;
}) => {
    const c = TONE_CLASSES[tone];
    return (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </span>
                <span className={cn('truncate text-h3 font-bold leading-tight', c.value)}>
                    {value}
                </span>
                {hint && (
                    <span className="mt-0.5 truncate text-caption text-muted-foreground">
                        {hint}
                    </span>
                )}
            </div>
            <span
                className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-md',
                    c.iconBg,
                    c.iconFg
                )}
            >
                <Icon className="size-5" weight="duotone" />
            </span>
        </div>
    );
};

// Re-export StatusChips for convenience; consumed by callers that want to
// surface the status pill near the header (e.g. inside the sticky sidebar
// header, which already does that).
export { StatusChips };
