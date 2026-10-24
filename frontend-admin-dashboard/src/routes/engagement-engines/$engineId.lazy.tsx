import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Icon } from '@phosphor-icons/react';
import {
    Archive,
    ArrowLeft,
    ArrowsClockwise,
    CheckCircle,
    Clock,
    FileText,
    Flask,
    GearSix,
    Lightning,
    Pause,
    PencilSimple,
    Play,
    Prohibit,
    Repeat,
    Tray,
    Users,
    UsersThree,
    Warning,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
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
import { StatStrip, type StatItem } from '@/components/shared/crm-enhance';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import { ToneBadge } from './-components/ToneBadge';
import { TemplateNegotiation } from './-components/TemplateNegotiation';
import { ChannelChip, Chip, IconTile, KeyValue, SubHeading } from './-components/engine-ui';
import { buildChannelMeta } from './-constants';
import { buildEngineStatusMeta, buildLanguageOptions, NEXT_STATUSES } from './-constants';
import {
    useEditPrompt,
    useEngine,
    useEnrollEngine,
    useSetAutonomy,
    useTransitionEngine,
} from './-hooks';
import {
    autoSendChannels,
    enabledChannels,
    formatDateTime,
    safeParse,
    whatsappEnabled,
} from './-utils';
import type { AudienceSelector, EngagementEngine, EngineDetail, QuietHours } from './-types';
import type { EngineStatus } from './-types';

export const Route = createLazyFileRoute('/engagement-engines/$engineId')({
    component: EngineDetailPage,
});

function buildStatusActionLabel(t: TFunction): Record<string, string> {
    return {
        DRY_RUN: t('statusActions.DRY_RUN'),
        ACTIVE: t('statusActions.ACTIVE'),
        PAUSED: t('statusActions.PAUSED'),
        ARCHIVED: t('statusActions.ARCHIVED'),
    };
}

const STATUS_ACTION_ICON: Record<string, Icon> = {
    DRY_RUN: Flask,
    ACTIVE: Play,
    PAUSED: Pause,
    ARCHIVED: Archive,
};

const pad = (h: number) => String(h).padStart(2, '0');

function quietHoursText(engine: EngagementEngine): string | null {
    const q = safeParse<QuietHours>(engine.quietHours, {});
    if (q.startHour == null || q.endHour == null) return null;
    return `${pad(q.startHour)}:00–${pad(q.endHour)}:00${q.timezone ? ` ${q.timezone}` : ''}`;
}

/** The autonomy card only means something once a channel auto-sends, or a holdout exists. */
function hasAutonomyPanel(engine: EngagementEngine): boolean {
    return autoSendChannels(engine).length > 0 || !!(engine.holdoutPct && engine.holdoutPct > 0);
}

function EngineDetailPage() {
    const { engineId } = Route.useParams();
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { data, isLoading, isError } = useEngine(engineId);
    const transition = useTransitionEngine();
    const enroll = useEnrollEngine();
    const editPrompt = useEditPrompt();
    const setAutonomy = useSetAutonomy();
    const [amendOpen, setAmendOpen] = useState(false);
    const [confirmArchive, setConfirmArchive] = useState(false);
    const [delta, setDelta] = useState('');
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const STATUS_ACTION_LABEL = buildStatusActionLabel(t);

    useEffect(() => setNavHeading(t('navHeading')), [setNavHeading, t]);

    if (isLoading) {
        return (
            <LayoutContainer>
                <div className="flex flex-col gap-4 p-1">
                    <Skeleton className="h-8 w-64 rounded" />
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {[0, 1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-28 rounded-xl" />
                        ))}
                    </div>
                    <Skeleton className="h-40 w-full rounded-xl" />
                </div>
            </LayoutContainer>
        );
    }
    if (isError || !data) {
        return (
            <LayoutContainer>
                <Card className="m-1 p-6 text-center text-body text-danger-600">
                    {t('loadError')}
                </Card>
            </LayoutContainer>
        );
    }

    const { engine, activeMembers, prompt } = data;
    const meta = buildEngineStatusMeta(tConstants)[engine.status] ?? {
        label: engine.status,
        tone: 'neutral' as const,
    };
    const nextStatuses = NEXT_STATUSES[engine.status] ?? [];
    const channelMeta = buildChannelMeta(tConstants);
    const channels = enabledChannels(engine);
    const hasWhatsApp = whatsappEnabled(engine);
    const quietHours = quietHoursText(engine);
    const dataPointKeys = safeParse<string[]>(engine.dataPoints, []);
    const audience = safeParse<AudienceSelector[]>(engine.audience, []);
    const showAutonomy = hasAutonomyPanel(engine);
    const approvedTotal =
        data.approvedSends ??
        (data.approvedSendsByChannel
            ? Object.values(data.approvedSendsByChannel).reduce((a, n) => a + n, 0)
            : undefined);

    const sourceParts = [
        {
            n: audience.filter((a) => a.type === 'PACKAGE_SESSION').length,
            label: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
        },
        {
            n: audience.filter((a) => a.type === 'AUDIENCE').length,
            label: getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList),
        },
        { n: audience.filter((a) => a.type === 'USER').length, label: t('status.people') },
    ].filter((p) => p.n > 0);

    const kpis: StatItem[] = [
        {
            key: 'members',
            icon: UsersThree,
            label: t('kpi.members'),
            value: activeMembers,
            detail:
                engine.holdoutPct && engine.holdoutPct > 0
                    ? t('kpi.holdout', { pct: engine.holdoutPct })
                    : t('kpi.noHoldout'),
        },
        ...(approvedTotal !== undefined
            ? [
                  {
                      key: 'approved',
                      icon: CheckCircle,
                      tint: 'success' as const,
                      label: t('kpi.approved'),
                      value: approvedTotal,
                      detail: data.effectiveFirstN
                          ? t('kpi.graduateAfter', { n: data.effectiveFirstN })
                          : undefined,
                  },
              ]
            : []),
        {
            key: 'cadence',
            icon: Repeat,
            tint: 'info',
            label: t('kpi.cadence'),
            value: t('config.cadence', { hours: engine.cadenceHours }),
            detail: quietHours ? t('kpi.quiet', { window: quietHours }) : undefined,
        },
        {
            key: 'next',
            icon: Clock,
            tint: 'warning',
            label: t('kpi.nextRun'),
            value: engine.nextDueAt ? formatDateTime(engine.nextDueAt) : t('kpi.notScheduled'),
            detail: engine.lastSweptAt
                ? t('kpi.lastRun', { when: formatDateTime(engine.lastSweptAt) })
                : undefined,
        },
    ];

    return (
        <LayoutContainer>
            <Helmet>
                <title>{engine.name}</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <button
                    type="button"
                    onClick={() => navigate({ to: '/engagement-engines' })}
                    className="flex w-fit items-center gap-1 text-caption text-neutral-500 hover:text-primary-600"
                >
                    <ArrowLeft className="size-4" /> {t('backToAll')}
                </button>

                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                        <IconTile status={engine.status} size="lg" />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="font-semibold text-neutral-900">
                                    <span className="text-h2">{engine.name}</span>
                                </h1>
                                <ToneBadge label={meta.label} tone={meta.tone} />
                            </div>
                            {engine.objective && (
                                <p className="mt-0.5 text-neutral-500">
                                    <span className="text-body">{engine.objective}</span>
                                </p>
                            )}
                        </div>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => navigate({ to: '/engagement-engines/inbox' })}
                    >
                        <Tray className="me-1 size-4" /> {t('viewTaskInbox')}
                    </MyButton>
                </div>

                {engine.status === 'TEMPLATES_PENDING' && hasWhatsApp && (
                    <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-warning-700">
                        <Warning size={18} className="mt-0.5 shrink-0" />
                        <span className="text-body">{t('templatesPendingBanner')}</span>
                    </div>
                )}

                <StatStrip items={kpis} />

                <div className="grid gap-5 lg:grid-cols-5">
                    {/* Status + audience controls */}
                    <SectionCard title={t('status.title')} icon={Users} className="lg:col-span-2">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <span className="font-bold tabular-nums text-neutral-900">
                                    <span className="text-h2">{activeMembers}</span>
                                </span>{' '}
                                <span className="text-neutral-500">
                                    <span className="text-body">
                                        {t('detail.activeMember', { count: activeMembers })}
                                    </span>
                                </span>
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={enroll.isPending}
                                onClick={() => enroll.mutate(engine.id)}
                            >
                                <ArrowsClockwise className="me-1 size-4" />
                                {enroll.isPending
                                    ? t('detail.resolving')
                                    : t('detail.resolveAudience')}
                            </MyButton>
                        </div>
                        <KeyValue label={t('status.sources')}>
                            {sourceParts.length
                                ? sourceParts.map((p) => `${p.n} ${p.label}`).join(' · ')
                                : t('config.noChannels')}
                        </KeyValue>

                        <SubHeading>{t('status.change')}</SubHeading>
                        <div className="flex flex-wrap items-center gap-2">
                            {nextStatuses.length === 0 && (
                                <span className="text-caption text-neutral-500">
                                    {t('status.noTransitions')}
                                </span>
                            )}
                            {nextStatuses.map((s: EngineStatus) => {
                                const ActionIcon = STATUS_ACTION_ICON[s];
                                return (
                                    <MyButton
                                        key={s}
                                        buttonType={s === 'ACTIVE' ? 'primary' : 'secondary'}
                                        scale="small"
                                        disable={transition.isPending}
                                        onClick={() =>
                                            s === 'ARCHIVED'
                                                ? setConfirmArchive(true)
                                                : transition.mutate({
                                                      engineId: engine.id,
                                                      toStatus: s,
                                                  })
                                        }
                                    >
                                        {ActionIcon && <ActionIcon className="me-1 size-4" />}
                                        {STATUS_ACTION_LABEL[s] ?? s}
                                    </MyButton>
                                );
                            })}
                        </div>
                        <p className="mt-4 border-t border-neutral-100 pt-3 text-neutral-500">
                            <span className="text-caption">{t('status.footnote')}</span>
                        </p>
                    </SectionCard>

                    {/* Brief */}
                    <SectionCard
                        title={t('brief.title')}
                        subtitle={
                            prompt ? t('brief.version', { version: prompt.version }) : undefined
                        }
                        icon={FileText}
                        className="lg:col-span-3"
                        right={
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => {
                                    setDelta('');
                                    setAmendOpen(true);
                                }}
                            >
                                <PencilSimple className="me-1 size-4" /> {t('brief.amend')}
                            </MyButton>
                        }
                    >
                        <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 text-neutral-700">
                            <span className="text-body">
                                {prompt?.compiledText || engine.objective || t('brief.empty')}
                            </span>
                        </div>
                    </SectionCard>
                </div>

                <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('archiveDialog.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t('archiveDialog.description')}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={transition.isPending}>
                                {t('archiveDialog.cancel')}
                            </AlertDialogCancel>
                            <AlertDialogAction
                                disabled={transition.isPending}
                                className="bg-danger-600 hover:bg-danger-700"
                                onClick={(e) => {
                                    e.preventDefault();
                                    transition.mutate(
                                        { engineId: engine.id, toStatus: 'ARCHIVED' },
                                        { onSettled: () => setConfirmArchive(false) }
                                    );
                                }}
                            >
                                {t('archiveDialog.confirm')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <div className={showAutonomy ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-5'}>
                    {/* Config summary */}
                    <SectionCard title={t('config.title')} icon={GearSix}>
                        <KeyValue label={t('config.channels')}>
                            {channels.length ? (
                                <span className="flex flex-wrap gap-1.5">
                                    {channels.map((c) => (
                                        <ChannelChip
                                            key={c}
                                            channel={c}
                                            label={channelMeta[c].label}
                                        />
                                    ))}
                                </span>
                            ) : (
                                t('config.noChannels')
                            )}
                        </KeyValue>
                        <KeyValue label={t('config.language')}>
                            {buildLanguageOptions(tConstants).find(
                                (l) => l.value === engine.language
                            )?.label ?? engine.language}
                        </KeyValue>
                        <KeyValue label={t('config.cadenceLabel')}>
                            {t('config.cadence', { hours: engine.cadenceHours })}
                        </KeyValue>
                        {quietHours && (
                            <KeyValue label={t('config.quietHours')}>{quietHours}</KeyValue>
                        )}
                        <KeyValue label={t('config.dataPoints')}>
                            {dataPointKeys.length ? (
                                <span className="flex flex-wrap gap-1.5">
                                    {dataPointKeys.map((k) => (
                                        <Chip key={k} label={k} className="font-mono" />
                                    ))}
                                </span>
                            ) : (
                                t('config.noChannels')
                            )}
                        </KeyValue>
                        <KeyValue label={t('autonomy.holdout')}>
                            {`${engine.holdoutPct ?? 0}%`}
                        </KeyValue>
                    </SectionCard>

                    {showAutonomy && (
                        <AutonomyPanel
                            detail={data}
                            onToggleKill={(killed) =>
                                setAutonomy.mutate({ engineId: engine.id, killed })
                            }
                            busy={setAutonomy.isPending}
                        />
                    )}
                </div>

                {hasWhatsApp && <TemplateNegotiation engineId={engine.id} />}
            </div>

            {amendOpen && (
                <MyDialog
                    heading={t('amendDialog.heading')}
                    open={amendOpen}
                    onOpenChange={setAmendOpen}
                    dialogWidth="max-w-lg"
                >
                    <div className="flex flex-col gap-3 p-1">
                        <p className="text-caption text-neutral-500">{t('amendDialog.description')}</p>
                        <Textarea
                            rows={5}
                            value={delta}
                            onChange={(e) => setDelta(e.target.value)}
                            placeholder={t('amendDialog.placeholder')}
                        />
                        <div className="flex justify-end gap-2">
                            <MyButton buttonType="secondary" scale="small" onClick={() => setAmendOpen(false)}>
                                {t('amendDialog.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                disable={editPrompt.isPending || !delta.trim()}
                                onClick={() =>
                                    editPrompt.mutate(
                                        { engineId: engine.id, deltaText: delta.trim() },
                                        { onSuccess: () => setAmendOpen(false) }
                                    )
                                }
                            >
                                {editPrompt.isPending ? t('amendDialog.saving') : t('amendDialog.submit')}
                            </MyButton>
                        </div>
                    </div>
                </MyDialog>
            )}
        </LayoutContainer>
    );
}

function AutonomyStatusBadge({
    killed,
    graduated,
    approved,
    target,
    engineStatus,
}: {
    killed: boolean;
    graduated: boolean;
    approved: number;
    target: number;
    engineStatus: EngineStatus;
}) {
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    if (killed) return <ToneBadge label={t('autonomy.badge.off')} tone="neutral" />;
    if (!graduated)
        return (
            <ToneBadge
                label={t('autonomy.badge.ramping', { approved, target })}
                tone="warning"
            />
        );
    // Graduated + auto-on, but the badge must not claim live sending unless the engine is ACTIVE —
    // a PAUSED/DRAFT engine sends nothing, and DRY_RUN only simulates.
    if (engineStatus === 'ACTIVE')
        return <ToneBadge label={t('autonomy.badge.sendingAutonomously')} tone="success" />;
    if (engineStatus === 'DRY_RUN')
        return <ToneBadge label={t('autonomy.badge.dryRun')} tone="info" />;
    const statusLabel = buildEngineStatusMeta(tConstants)[engineStatus]?.label ?? engineStatus;
    return (
        <ToneBadge
            label={t('autonomy.badge.onEngineStatus', { status: statusLabel.toLowerCase() })}
            tone="neutral"
        />
    );
}

function AutonomyPanel({
    detail,
    onToggleKill,
    busy,
}: {
    detail: EngineDetail;
    onToggleKill: (killed: boolean) => void;
    busy: boolean;
}) {
    const { t } = useTranslation('engagementEnginesEngineIdIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const { engine, approvedSends, approvedSendsByChannel, effectiveFirstN } = detail;
    const autoChannels = autoSendChannels(engine);
    // Only meaningful once at least one channel is set to auto-send, or a holdout exists.
    if (!hasAutonomyPanel(engine)) return null;

    const killed = engine.autoSendKilled === true;
    const target = effectiveFirstN ?? 0;
    // Graduation is per channel. An older backend sends only the engine-wide total.
    const approvedOn = (channel: string) =>
        approvedSendsByChannel ? approvedSendsByChannel[channel] ?? 0 : approvedSends ?? 0;
    const channelMeta = buildChannelMeta(tConstants);

    return (
        <SectionCard
            title={t('autonomy.title')}
            icon={Lightning}
            right={
                autoChannels.length > 0 &&
                (killed ? (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={busy}
                        onClick={() => onToggleKill(false)}
                    >
                        <Lightning className="me-1 size-4" /> {t('autonomy.allowAutoSend')}
                    </MyButton>
                ) : (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy}
                        onClick={() => onToggleKill(true)}
                    >
                        <Prohibit className="me-1 size-4" /> {t('autonomy.keepAsCopilot')}
                    </MyButton>
                ))
            }
        >
            {autoChannels.length > 0 ? (
                <div className="flex flex-col gap-3">
                    <SubHeading>{t('autonomy.autoSendChannels')}</SubHeading>
                    {autoChannels.map((channel) => {
                        const approved = approvedOn(channel);
                        const graduated = target <= 0 || approved >= target;
                        const pct =
                            target > 0 ? Math.min(100, Math.round((approved / target) * 100)) : 100;
                        return (
                            <div
                                key={channel}
                                className="flex flex-col gap-2 rounded-lg border border-neutral-100 p-3"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="flex items-center gap-2">
                                        <ChannelChip
                                            channel={channel}
                                            label={channelMeta[channel].label}
                                        />
                                        <span className="text-neutral-500">
                                            <span className="text-caption">
                                                {t('autonomy.statusFor', {
                                                    channel: channelMeta[channel].label,
                                                })}
                                            </span>
                                        </span>
                                    </span>
                                    <AutonomyStatusBadge
                                        killed={killed}
                                        graduated={graduated}
                                        approved={approved}
                                        target={target}
                                        engineStatus={engine.status}
                                    />
                                </div>
                                {!killed && (
                                    <Progress
                                        value={pct}
                                        aria-label={t('autonomy.statusFor', {
                                            channel: channelMeta[channel].label,
                                        })}
                                        className="h-1.5 border border-neutral-200"
                                    />
                                )}
                                {!killed && !graduated && (
                                    <p className="text-caption text-neutral-500">
                                        {t('autonomy.rampingHintChannel', {
                                            channel: channelMeta[channel].label,
                                            count: Math.max(0, target - approved),
                                        })}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-caption text-neutral-500">{t('autonomy.noAutoSend')}</p>
            )}

            {engine.holdoutPct != null && engine.holdoutPct > 0 && (
                <KeyValue label={t('autonomy.holdout')}>
                    {t('autonomy.holdoutValue', { pct: engine.holdoutPct })}
                </KeyValue>
            )}
        </SectionCard>
    );
}
