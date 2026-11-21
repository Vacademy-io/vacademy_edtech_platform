import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ArrowRight,
    CalendarCheck,
    Clock,
    GraduationCap,
    TrayArrowDown,
    UsersThree,
    type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { useTabSettings } from '@/hooks/use-tab-settings';
import { useMentorDashboard } from '@/routes/mentorship/-hooks/use-mentorship';

interface Tile {
    key: string;
    label: string;
    value: number;
    subtitle: string;
    Icon: Icon;
    iconBg: string;
    iconColor: string;
    cardBg: string;
    /** Where this tile navigates; defaults to the mentors screen. */
    to?: string;
}

/**
 * Admin dashboard KPI card: mentors, mentees, today's and upcoming mentor
 * sessions. Learners waiting on a mentor appear as a link beside "Manage" rather
 * than replacing a tile — the four metrics stay put so the card reads the same way
 * every time. Data from the mentorship dashboard endpoint. Self-hides when the
 * institute has no mentors, so it only surfaces where mentorship is in use.
 */
export default function MentorshipStatsWidget() {
    const { t } = useTranslation('dashboardMentorshipStatsWidget');
    const navigate = useNavigate();
    const instituteId = getInstituteId();
    // The card self-hides when the institute has no mentors, but it has to ask the server to find
    // that out. Skip the call entirely where Mentorship is switched off for this institute — the
    // home page is the one screen every admin loads, so a pointless request there is the worst place
    // for one. Every tile below links into Mentorship, so a hidden module has nothing to show anyway.
    const mentorshipVisible = useTabSettings().isTabVisible('mentorship');
    const { data, isLoading, isError } = useMentorDashboard(instituteId, mentorshipVisible);

    if (!instituteId || isError || !mentorshipVisible) return null;
    if (!isLoading && (data?.total_mentors ?? 0) === 0) return null;

    const go = (to = '/mentorship/mentors') => navigate({ to });
    const pendingRequests = data?.pending_requests ?? 0;

    const tiles: Tile[] = [
        {
            key: 'mentors',
            label: t('tiles.mentors.label'),
            value: data?.total_mentors ?? 0,
            subtitle: t('tiles.mentors.subtitle'),
            Icon: UsersThree,
            iconBg: 'bg-primary-100',
            iconColor: 'text-primary-600',
            cardBg: 'bg-primary-50',
        },
        {
            key: 'mentees',
            label: t('tiles.mentees.label'),
            value: data?.distinct_mentees ?? 0,
            subtitle: t('tiles.mentees.subtitle'),
            Icon: GraduationCap,
            iconBg: 'bg-success-100',
            iconColor: 'text-success-600',
            cardBg: 'bg-success-50',
        },
        {
            key: 'today',
            label: t('tiles.today.label'),
            value: data?.today_sessions ?? 0,
            subtitle: t('tiles.today.subtitle'),
            Icon: CalendarCheck,
            iconBg: 'bg-warning-100',
            iconColor: 'text-warning-600',
            cardBg: 'bg-warning-50',
        },
        {
            key: 'upcoming',
            label: t('tiles.upcoming.label'),
            value: data?.upcoming_sessions ?? 0,
            subtitle: t('tiles.upcoming.subtitle'),
            Icon: Clock,
            iconBg: 'bg-info-100',
            iconColor: 'text-info-600',
            cardBg: 'bg-info-50',
        },
    ];

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-100">
                        <UsersThree size={18} weight="duotone" className="text-primary-600" />
                    </span>
                    <div>
                        <p className="text-caption font-medium text-neutral-400">
                            {t('header.eyebrow')}
                        </p>
                        <h3 className="text-body font-semibold text-neutral-700">
                            {t('header.title')}
                        </h3>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {pendingRequests > 0 && (
                        <button
                            type="button"
                            onClick={() => go('/mentorship/requests')}
                            className="flex items-center gap-1.5 rounded-full bg-danger-50 px-2.5 py-1 text-caption font-medium text-danger-600 hover:bg-danger-100"
                            title={t('actions.pendingTooltip')}
                        >
                            <TrayArrowDown size={13} weight="bold" />
                            {t('actions.pendingReview', { count: pendingRequests })}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => go()}
                        className="flex items-center gap-1 text-caption font-medium text-primary-600 hover:text-primary-700"
                    >
                        {t('actions.manage')}
                        <ArrowRight size={12} weight="bold" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {isLoading
                    ? Array.from({ length: 4 }, (_, i) => (
                          <Card key={i} className="p-4 shadow-sm">
                              <div className="flex items-start justify-between">
                                  <Skeleton className="h-3 w-16" />
                                  <Skeleton className="size-9 rounded-lg" />
                              </div>
                              <Skeleton className="mt-3 h-7 w-12" />
                              <Skeleton className="mt-2 h-2.5 w-20" />
                          </Card>
                      ))
                    : tiles.map((tile) => {
                          const StatIcon = tile.Icon;
                          return (
                              <button
                                  key={tile.key}
                                  type="button"
                                  onClick={() => go(tile.to)}
                                  className="group text-left"
                              >
                                  <Card
                                      className={cn(
                                          'relative h-full overflow-hidden p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md',
                                          tile.cardBg
                                      )}
                                  >
                                      <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0 flex-1 text-caption font-medium uppercase tracking-wide text-neutral-500">
                                              {tile.label}
                                          </div>
                                          <span
                                              className={cn(
                                                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                                                  tile.iconBg
                                              )}
                                          >
                                              <StatIcon
                                                  size={18}
                                                  weight="duotone"
                                                  className={tile.iconColor}
                                              />
                                          </span>
                                      </div>
                                      <div className="mt-2 text-h2 font-semibold tabular-nums text-neutral-700">
                                          {tile.value.toLocaleString('en-IN')}
                                      </div>
                                      <span className="mt-1 line-clamp-1 text-caption text-neutral-500">
                                          {tile.subtitle}
                                      </span>
                                  </Card>
                              </button>
                          );
                      })}
            </div>
        </section>
    );
}
