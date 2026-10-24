import { GraduationCap, Warning, CaretRight } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { ProfileSectionCard } from '../profile-ui';
import { cn } from '@/lib/utils';

/**
 * Continue Learning card — Overview's "what should the admin help them with
 * right now" anchor, per the Vacademy design handoff Overview section.
 *
 * Renders only when there's an active in-progress course. Layout:
 *   - Left  → ProgressRing 78px showing the average % across active courses
 *   - Right → primary course name + session/level + behind-on-N badge
 *
 * The ring uses an SVG circle stroke so the % is data-driven without an
 * arbitrary Tailwind class — the only inline style is the
 * `strokeDashoffset` calc (acceptable for genuinely dynamic values per the
 * design system rules).
 *
 * No new endpoints — the source data is `useLearnerPackagesQuery` already
 * fetched by Courses tab; Overview reuses the cached page-0 PROGRESS slice.
 */
export const OverviewContinueLearning = ({
    averagePercent,
    primaryCourseName,
    primaryLevel,
    primarySession,
    behindCount,
    onViewProgress,
}: {
    averagePercent: number;
    primaryCourseName?: string | null;
    primaryLevel?: string | null;
    primarySession?: string | null;
    behindCount: number;
    onViewProgress?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsOverviewContinueLearning');
    const pct = Math.max(0, Math.min(100, Math.round(averagePercent)));

    return (
        <ProfileSectionCard
            icon={GraduationCap}
            heading={t('heading')}
            action={
                onViewProgress ? (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={onViewProgress}
                    >
                        {t('action.viewProgress')}
                        <CaretRight className="size-3.5" />
                    </MyButton>
                ) : undefined
            }
        >
            <div className="flex items-center gap-4">
                {/* SVG progress ring — data-driven stroke offset. */}
                <ProgressRing pct={pct} t={t} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-semibold text-card-foreground">
                        {primaryCourseName || t('course.fallbackName')}
                    </div>
                    {(primarySession || primaryLevel) && (
                        <div className="mt-0.5 truncate text-caption text-muted-foreground">
                            {[
                                primarySession
                                    ? t('course.session', { session: primarySession })
                                    : null,
                                primaryLevel,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </div>
                    )}
                    {behindCount > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-700 ring-1 ring-warning-200">
                            <Warning className="size-3.5" weight="fill" />
                            {t('behindBadge', { count: behindCount })}
                        </div>
                    )}
                </div>
            </div>
        </ProfileSectionCard>
    );
};

/** Inline SVG progress ring — 78px diameter, 8px stroke. */
const ProgressRing = ({ pct, t }: { pct: number; t: TFunction }) => {
    const size = 78;
    const stroke = 8;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pct / 100) * circumference;
    const tone =
        pct >= 75 ? 'success' : pct >= 25 ? 'warning' : 'danger';
    const stops: Record<'success' | 'warning' | 'danger', string> = {
        success: 'stroke-success-500',
        warning: 'stroke-warning-500',
        danger: 'stroke-danger-500',
    };

    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={stroke}
                    className="stroke-muted"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    // Inline style: data-driven dash offset, can't be a token.
                    style={{ strokeDashoffset: offset }} // design-lint-ignore: dynamic ring value
                    className={cn('transition-all duration-500', stops[tone])}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-body font-bold leading-none text-card-foreground">
                    {pct}%
                </span>
                <span className="mt-0.5 text-caption uppercase tracking-wide text-muted-foreground">
                    {t('ring.complete')}
                </span>
            </div>
        </div>
    );
};
