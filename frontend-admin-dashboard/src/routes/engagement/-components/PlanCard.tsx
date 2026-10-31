import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    Archive,
    ArrowClockwise,
    ArrowCounterClockwise,
    CaretDown,
    ChartBar,
    Copy,
    DotsThreeVertical,
    Eye,
    EyeSlash,
    PencilSimple,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
    deleteEngagementPlan,
    getEngagementPlan,
    setPlanStatus,
} from '../-services/engagement-service';
import type {
    EngagementItemDTO,
    EngagementPlanDTO,
    PlanLifecycle,
    PlanStatus,
} from '../-types/types';
import {
    formatDateTime,
    formatDay,
    formatDayRange,
    formatFraction,
    planDateRange,
    planLifecycle,
} from '../-utils/format';
import { PlanOverviewDialog } from './PlanOverviewDialog';
import { ItemTrackingDialog } from './ItemTrackingDialog';
import { PlanComposerDialog } from './PlanComposerDialog';
import { serverMessageOf } from './composer/use-composer-save';
import { DuplicatePlanDialog } from './DuplicatePlanDialog';
import { PlanDaySchedule } from './list/PlanDaySchedule';

const LIFECYCLE_TONE: Record<PlanLifecycle, StatusType> = {
    DRAFT: 'INFO',
    UPCOMING: 'WARNING',
    RUNNING: 'SUCCESS',
    ENDED: 'INFO',
    ARCHIVED: 'INFO',
};

const STATUS_TONE: Record<PlanStatus, StatusType> = {
    PUBLISHED: 'SUCCESS',
    DRAFT: 'INFO',
    ARCHIVED: 'INFO',
    DELETED: 'DANGER',
};

/** The server's own message when it sent one, else the caller's fallback. */
function errorMessage(e: unknown, fallback: string): string {
    // A VacademyException body carries its text in `ex`, not `message`.
    return serverMessageOf(e) ?? fallback;
}

type MenuAction =
    | 'progress'
    | 'edit'
    | 'duplicate'
    | 'publish'
    | 'unpublish'
    | 'archive'
    | 'unarchive'
    | 'remove';

type StatusAction = 'publish' | 'unpublish' | 'archive' | 'unarchive';

const STATUS_FOR: Record<StatusAction, PlanStatus> = {
    publish: 'PUBLISHED',
    unpublish: 'DRAFT',
    archive: 'ARCHIVED',
    // Restoring lands in drafts: a teacher checks the dates before learners see it again.
    unarchive: 'DRAFT',
};

/**
 * One plan in the list.
 *
 * Collapsed, it answers "which batch, when, and how is today going": the title with a
 * lifecycle chip, then `batch · 24–26 Sep · 3 days · 14 tasks`, and while it runs,
 * `Today: 11 tasks · 1 / 2 learners started`. Progress and Edit sit inline (in the
 * kebab on phones); Duplicate, Publish/Unpublish, Archive and Remove live in the kebab.
 *
 * Expanded, it loads the plan's days and tasks (only then — a list should not pull
 * every task of every plan) and groups them into Past / Today / Upcoming.
 */
export function PlanCard({
    plan,
    onChanged,
    onOpenPlan,
    hideBatch = false,
    showCreated = false,
}: {
    plan: EngagementPlanDTO;
    /** After any change to this plan (status, edit, remove, a copy made). */
    onChanged?: () => void;
    /** Open another plan in the editor (the "Edit copy" action after Duplicate). */
    onOpenPlan?: (planId: string) => void;
    /** Leave the batch out of the meta line (the list is already filtered to one batch). */
    hideBatch?: boolean;
    /**
     * Add "Created 22 Sep, 10:42 AM" to the meta line: the list sets it when two plans
     * would otherwise read the same (same title, batch and dates).
     */
    showCreated?: boolean;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const queryClient = useQueryClient();
    const isMobile = useIsMobile();
    const uid = useId();
    const [expanded, setExpanded] = useState(false);
    const [trackingItem, setTrackingItem] = useState<EngagementItemDTO | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [overviewOpen, setOverviewOpen] = useState(false);
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [busy, setBusy] = useState(false);

    const lifecycle = planLifecycle(plan);
    const title = plan.title?.trim() || t('card.untitled');
    const isArchived = plan.status === 'ARCHIVED';
    const isPublished = plan.status === 'PUBLISHED';

    const {
        data: detail,
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ['engagement-plan', plan.id],
        queryFn: () => getEngagementPlan(plan.id),
        enabled: expanded,
    });

    function changed() {
        void queryClient.invalidateQueries({ queryKey: ['engagement-plan', plan.id] });
        onChanged?.();
    }

    async function changeStatus(action: StatusAction) {
        if (busy) return;
        setBusy(true);
        try {
            await setPlanStatus(plan.id, STATUS_FOR[action]);
            toast.success(t(`card.toast.${action}`));
            changed();
        } catch (e: unknown) {
            toast.error(errorMessage(e, t(`card.toast.${action}Error`)));
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (busy) return;
        setBusy(true);
        try {
            await deleteEngagementPlan(plan.id);
            toast.success(t('card.removed'));
            setConfirmRemove(false);
            onChanged?.();
        } catch (e: unknown) {
            toast.error(errorMessage(e, t('card.removeError')));
        } finally {
            setBusy(false);
        }
    }

    function handleMenu(value: string) {
        switch (value as MenuAction) {
            case 'progress':
                setOverviewOpen(true);
                break;
            case 'edit':
                setEditOpen(true);
                break;
            case 'duplicate':
                setDuplicateOpen(true);
                break;
            case 'remove':
                setConfirmRemove(true);
                break;
            case 'publish':
            case 'unpublish':
            case 'archive':
            case 'unarchive':
                void changeStatus(value as StatusAction);
                break;
        }
    }

    const iconClass = 'size-4 shrink-0';
    const menu = [
        ...(isMobile
            ? [
                  {
                      value: 'progress',
                      label: t('card.progressButton'),
                      icon: <ChartBar className={iconClass} aria-hidden />,
                  },
                  {
                      value: 'edit',
                      label: t('card.edit'),
                      icon: <PencilSimple className={iconClass} aria-hidden />,
                  },
              ]
            : []),
        {
            value: 'duplicate',
            label: t('card.duplicate'),
            icon: <Copy className={iconClass} aria-hidden />,
        },
        ...(isArchived
            ? []
            : [
                  isPublished
                      ? {
                            value: 'unpublish',
                            label: t('card.unpublish'),
                            icon: <EyeSlash className={iconClass} aria-hidden />,
                        }
                      : {
                            value: 'publish',
                            label: t('card.publish'),
                            icon: <Eye className={iconClass} aria-hidden />,
                        },
              ]),
        isArchived
            ? {
                  value: 'unarchive',
                  label: t('card.unarchive'),
                  icon: <ArrowCounterClockwise className={iconClass} aria-hidden />,
              }
            : {
                  value: 'archive',
                  label: t('card.archive'),
                  icon: <Archive className={iconClass} aria-hidden />,
              },
        {
            value: 'remove',
            label: t('card.remove'),
            icon: <Trash className={cn(iconClass, 'text-danger-600')} aria-hidden />,
        },
    ];

    const chip = lifecycleChip(plan, lifecycle, t, lang);
    const meta = metaLine(plan, { hideBatch, showCreated, t, lang });
    const todayLine = lifecycle === 'RUNNING' ? todayLineFor(plan, t, lang) : null;
    const detailId = `${uid}-detail`;

    return (
        <article className="rounded-lg border border-neutral-200 bg-white">
            <div className="flex items-start gap-2 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:gap-3">
                        <h3 className="w-full min-w-0 flex-1 text-subtitle font-semibold text-neutral-900">
                            <button
                                type="button"
                                onClick={() => setExpanded((v) => !v)}
                                aria-expanded={expanded}
                                aria-controls={detailId}
                                className="-mx-1 flex w-full items-start gap-2 rounded-md px-1 text-start transition-colors hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            >
                                <CaretDown
                                    size={16}
                                    aria-hidden
                                    className={cn(
                                        'mt-1 shrink-0 text-neutral-600 transition-transform',
                                        !expanded && '-rotate-90 rtl:rotate-90'
                                    )}
                                />
                                <span className="line-clamp-2 break-words">{title}</span>
                            </button>
                        </h3>
                        <div className="shrink-0 ps-6 sm:ps-0">
                            <StatusChip
                                text={chip.text}
                                textSize="text-caption"
                                status={chip.tone}
                                showIcon={false}
                            />
                        </div>
                    </div>
                    {meta && <p className="mt-1 ps-6 text-caption text-neutral-600">{meta}</p>}
                    {todayLine && (
                        <p className="mt-1 ps-6 text-caption font-semibold text-neutral-700">
                            {todayLine}
                        </p>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="hidden sm:min-w-0 md:inline-flex"
                        onClick={() => setOverviewOpen(true)}
                    >
                        <ChartBar size={16} aria-hidden />
                        {t('card.progressButton')}
                    </MyButton>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    layoutVariant="icon"
                                    aria-label={t('card.edit')}
                                    className="hidden text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 md:inline-flex"
                                    onClick={() => setEditOpen(true)}
                                >
                                    <PencilSimple size={18} aria-hidden />
                                </MyButton>
                            </TooltipTrigger>
                            <TooltipContent>{t('card.edit')}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <div className="rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-300">
                        <MyDropdown dropdownList={menu} onSelect={handleMenu} disable={busy}>
                            <span
                                className={cn(
                                    'flex size-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
                                    busy && 'opacity-50'
                                )}
                            >
                                <DotsThreeVertical size={18} aria-hidden />
                                <span className="sr-only">{t('card.actionsFor', { title })}</span>
                            </span>
                        </MyDropdown>
                    </div>
                </div>
            </div>

            {expanded && (
                <div id={detailId} className="border-t border-neutral-100 p-3 sm:p-4">
                    {isLoading && (
                        <div className="space-y-2" aria-busy>
                            <Skeleton className="h-5 w-48" />
                            <Skeleton className="h-14 w-full" />
                            <Skeleton className="h-14 w-full" />
                        </div>
                    )}

                    {isError && (
                        <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                            <div className="flex flex-wrap items-center gap-3">
                                <WarningCircle size={18} className="shrink-0" aria-hidden />
                                <AlertDescription className="min-w-0 flex-1">
                                    {t('card.loadError')}
                                </AlertDescription>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => void refetch()}
                                >
                                    <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
                                </MyButton>
                            </div>
                        </Alert>
                    )}

                    {detail && (
                        <PlanDaySchedule
                            plan={{ ...plan, ...detail }}
                            onOpenItem={setTrackingItem}
                        />
                    )}
                </div>
            )}

            {/* Removing a plan takes it off every learner's home page; the attempts and
                points already earned are untouched. */}
            <AlertDialog
                open={confirmRemove}
                onOpenChange={(next) => {
                    if (!busy) setConfirmRemove(next);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {t('card.removeTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {t('card.removeConfirm', { title })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>{t('card.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={(e) => {
                                // Keep the dialog open until the delete settles, so a
                                // failure is reported while the teacher is still here.
                                e.preventDefault();
                                void remove();
                            }}
                        >
                            {busy ? t('card.removing') : t('card.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <PlanComposerDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                planId={plan.id}
                onCreated={changed}
            />

            <PlanOverviewDialog
                planId={plan.id}
                open={overviewOpen}
                onOpenChange={setOverviewOpen}
            />

            <DuplicatePlanDialog
                plan={plan}
                open={duplicateOpen}
                onOpenChange={setDuplicateOpen}
                onDuplicated={() => onChanged?.()}
                onOpenPlan={onOpenPlan}
            />

            <ItemTrackingDialog
                item={trackingItem}
                open={Boolean(trackingItem)}
                onOpenChange={(next) => {
                    if (!next) setTrackingItem(null);
                }}
            />
        </article>
    );
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * Plans the list shows with their creation time: those whose title, batch and dates
 * match another plan's, so two otherwise identical cards can be told apart.
 */
export function lookAlikePlanIds(plans: EngagementPlanDTO[]): Set<string> {
    const signature = (plan: EngagementPlanDTO) => {
        const range = planDateRange(plan);
        return [
            (plan.title ?? '').trim().toLowerCase(),
            plan.packageSessionId,
            range?.first ?? '',
            range?.last ?? '',
        ].join('|');
    };
    const counts = new Map<string, number>();
    for (const plan of plans) counts.set(signature(plan), (counts.get(signature(plan)) ?? 0) + 1);
    return new Set(
        plans.filter((plan) => (counts.get(signature(plan)) ?? 0) > 1).map((plan) => plan.id)
    );
}

/** "Running", "Starts 30 Sep", "Ended 26 Sep"…; the stored status for an older server. */
export function lifecycleChip(
    plan: EngagementPlanDTO,
    lifecycle: PlanLifecycle | null,
    t: TFn,
    lang: string
): { text: string; tone: StatusType } {
    if (!lifecycle) {
        return {
            text: t(`card.status.${plan.status}`),
            tone: STATUS_TONE[plan.status] ?? 'INFO',
        };
    }
    const range = planDateRange(plan);
    let text: string;
    if (lifecycle === 'UPCOMING' && range) {
        text = t('card.lifecycle.UPCOMING_on', {
            date: formatDay(range.first, lang, { weekday: false }),
        });
    } else if (lifecycle === 'ENDED' && range) {
        text = t('card.lifecycle.ENDED_on', {
            date: formatDay(range.last, lang, { weekday: false }),
        });
    } else {
        text = t(`card.lifecycle.${lifecycle}`);
    }
    return { text, tone: LIFECYCLE_TONE[lifecycle] };
}

/**
 * `batch · 24–26 Sep · 3 days · 14 tasks`, leaving out what the server didn't send;
 * with `showCreated`, `· Created 22 Sep, 10:42 AM` tells look-alike plans apart.
 */
export function metaLine(
    plan: EngagementPlanDTO,
    {
        hideBatch,
        showCreated = false,
        t,
        lang,
    }: { hideBatch: boolean; showCreated?: boolean; t: TFn; lang: string }
): string {
    const range = planDateRange(plan);
    const parts = [
        hideBatch ? null : plan.packageSessionLabel?.trim() || null,
        range ? formatDayRange(range.first, range.last, lang) : null,
        plan.scheduleMode === 'RELATIVE'
            ? t('card.afterJoining', { count: plan.lastDay ?? plan.dayCount ?? 1 })
            : null,
        typeof plan.dayCount === 'number' && plan.dayCount > 0
            ? t('card.days', { count: plan.dayCount })
            : null,
        typeof plan.taskCount === 'number' ? t('card.tasks', { count: plan.taskCount }) : null,
        showCreated && plan.createdAt
            ? t('card.created', {
                  date: formatDateTime(plan.createdAt, lang, plan.timezone || undefined),
              })
            : null,
    ].filter((part): part is string => Boolean(part));
    return parts.join(' · ');
}

/** `Today: 11 tasks · 1 / 2 learners started`, or null when the server sent no counts. */
export function todayLineFor(plan: EngagementPlanDTO, t: TFn, lang: string): string | null {
    if (typeof plan.todayTaskCount !== 'number') return null;
    if (plan.todayTaskCount === 0) return t('card.nothingToday');
    const parts = [t('card.todayTasks', { count: plan.todayTaskCount })];
    if (typeof plan.learnerCount === 'number' && plan.learnerCount > 0) {
        parts.push(
            t('card.learnersStarted', {
                count: plan.learnerCount,
                started: formatFraction(plan.todayStartedLearners ?? 0, plan.learnerCount, lang),
            })
        );
    }
    return parts.join(' · ');
}
