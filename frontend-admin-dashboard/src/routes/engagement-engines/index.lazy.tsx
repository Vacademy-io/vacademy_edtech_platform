import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { EnginesStatusCounts } from './-components/EnginesStatusCounts';
import { EngagementTasksStrip } from '@/components/shared/crm-enhance/group-summary-strips';
import { Helmet } from 'react-helmet';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import type { Icon } from '@phosphor-icons/react';
import {
    Clock,
    FileText,
    Flask,
    ListBullets,
    MagnifyingGlass,
    Plus,
    Repeat,
    Robot,
    SquaresFour,
    Translate,
    Tray,
    UsersThree,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    staticTableData,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { useGroupDashboard, type EngagementSections } from '@/services/group-dashboard';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import { useEngines } from './-hooks';
import { ToneBadge } from './-components/ToneBadge';
import { ChannelChip, Chip, IconTile } from './-components/engine-ui';
import {
    buildChannelMeta,
    buildEngineStatusMeta,
    buildLanguageOptions,
    CHANNEL_ORDER,
} from './-constants';
import { enabledChannels, formatDateTime } from './-utils';
import type { ChannelKey, EngagementEngine, EngineStatus } from './-types';

export const Route = createLazyFileRoute('/engagement-engines/')({
    component: EngagementEnginesPage,
});

type EngineStats = EngagementSections['engines'][number];
type ViewMode = 'cards' | 'table';

const fmt = (n: number) => n.toLocaleString('en-IN');

/** A one-line next step for engines that are not sending yet. */
const STATUS_HINT: Partial<Record<EngineStatus, { key: string; icon: Icon }>> = {
    TEMPLATES_PENDING: { key: 'card.hint.templatesPending', icon: FileText },
    DRY_RUN: { key: 'card.hint.dryRun', icon: Flask },
    DRAFT: { key: 'card.hint.draft', icon: UsersThree },
};

function EngineCard({ engine, stats }: { engine: EngagementEngine; stats?: EngineStats }) {
    const navigate = useNavigate();
    const { t } = useTranslation('engagementEnginesIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const meta = buildEngineStatusMeta(tConstants)[engine.status] ?? {
        label: engine.status,
        tone: 'neutral' as const,
    };
    const channelMeta = buildChannelMeta(tConstants);
    const channels = enabledChannels(engine);
    const language =
        buildLanguageOptions(tConstants).find((l) => l.value === engine.language)?.label ??
        engine.language;
    const hint = STATUS_HINT[engine.status];
    const open = () =>
        navigate({ to: '/engagement-engines/$engineId', params: { engineId: engine.id } });
    return (
        <Card
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
            }}
            className="flex cursor-pointer flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:border-primary-200 hover:shadow-md"
        >
            <div className="flex items-start gap-3">
                <IconTile status={engine.status} />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-neutral-900">
                        <span className="text-subtitle">{engine.name}</span>
                    </p>
                    {engine.objective && (
                        <p className="mt-0.5 line-clamp-2 text-neutral-500">
                            <span className="text-caption">{engine.objective}</span>
                        </p>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <ToneBadge label={meta.label} tone={meta.tone} />
                {channels.length ? (
                    channels.map((c) => (
                        <ChannelChip key={c} channel={c} label={channelMeta[c].label} />
                    ))
                ) : (
                    <Chip label={t('card.noChannels')} />
                )}
                <Chip icon={Repeat} label={t('card.cadence', { hours: engine.cadenceHours })} />
                <Chip icon={Translate} label={language} />
            </div>
            {stats && (
                <div className="grid grid-cols-4 gap-2 border-t border-neutral-100 pt-3">
                    {[
                        { k: 'members', v: stats.members, warn: false },
                        { k: 'drafted', v: stats.drafted, warn: false },
                        { k: 'completed', v: stats.completed, warn: false },
                        { k: 'failed', v: stats.failed, warn: stats.failed > 0 },
                    ].map((s) => (
                        <div key={s.k} className="flex min-w-0 flex-col">
                            <span
                                className={cn(
                                    'font-semibold tabular-nums',
                                    s.warn ? 'text-danger-600' : 'text-neutral-900'
                                )}
                            >
                                <span className="text-subtitle">{fmt(s.v)}</span>
                            </span>
                            <span className="truncate text-neutral-500">
                                <span className="text-caption">{t(`card.stats.${s.k}`)}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {(hint || engine.lastSweptAt) && (
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-500">
                    {hint && (
                        <span className="flex items-center gap-1">
                            <hint.icon size={14} />
                            <span className="text-caption">{t(hint.key)}</span>
                        </span>
                    )}
                    {engine.lastSweptAt && (
                        <span className="ms-auto flex items-center gap-1">
                            <Clock size={14} />
                            <span className="text-caption">
                                {t('card.lastRun', { when: formatDateTime(engine.lastSweptAt) })}
                            </span>
                        </span>
                    )}
                </div>
            )}
        </Card>
    );
}

function NewEngineCard({ description }: { description: string }) {
    const navigate = useNavigate();
    const { t } = useTranslation('engagementEnginesIndex');
    return (
        <button
            type="button"
            onClick={() => navigate({ to: '/engagement-engines/create' })}
            className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 p-5 text-center text-neutral-500 transition-colors hover:border-primary-300 hover:text-primary-600"
        >
            <span className="flex size-10 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                <Plus size={20} weight="bold" />
            </span>
            <span className="font-semibold text-neutral-800">
                <span className="text-subtitle">{t('actions.newEngine')}</span>
            </span>
            <span className="max-w-xs">
                <span className="text-caption">{description}</span>
            </span>
        </button>
    );
}

function EngagementEnginesPage() {
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { data: engines, isLoading, isError } = useEngines();
    const { t } = useTranslation('engagementEnginesIndex');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');

    // Same query (and cache entry) the tasks strip below already loads, so the per-engine
    // numbers on the cards cost no extra request. Admins only, like that strip.
    const isAdmin = useIsInstituteAdmin();
    const dash = useGroupDashboard<EngagementSections>('engagement', 30, isAdmin);
    const statsById = useMemo(() => {
        const m: Record<string, EngineStats> = {};
        (dash.data?.sections.engines ?? []).forEach((e) => (m[e.engine_id] = e));
        return m;
    }, [dash.data]);

    const [statusView, setStatusView] = useState('all');
    const [search, setSearch] = useState('');
    const [channel, setChannel] = useState('all');
    const [language, setLanguage] = useState('all');
    const [showArchived, setShowArchived] = useState(false);
    const [view, setView] = useState<ViewMode>('cards');

    useEffect(() => {
        setNavHeading(t('title'));
    }, [setNavHeading, t]);

    const all = engines ?? [];
    const q = search.trim().toLowerCase();
    const rows = all.filter(
        (e) =>
            (statusView === 'all'
                ? showArchived || e.status !== 'ARCHIVED'
                : e.status === statusView) &&
            (!q ||
                e.name.toLowerCase().includes(q) ||
                (e.objective ?? '').toLowerCase().includes(q)) &&
            (channel === 'all' || enabledChannels(e).includes(channel as ChannelKey)) &&
            (language === 'all' || e.language === language)
    );
    const filtersOn =
        statusView !== 'all' || !!q || channel !== 'all' || language !== 'all' || showArchived;
    const clearFilters = () => {
        setStatusView('all');
        setSearch('');
        setChannel('all');
        setLanguage('all');
        setShowArchived(false);
    };

    const channelMeta = buildChannelMeta(tConstants);
    const languageOptions = buildLanguageOptions(tConstants);
    const statusMeta = buildEngineStatusMeta(tConstants);
    const emptyDescription = t('empty.description', {
        term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner).toLowerCase(),
    });

    // Built every render (labels come from t), not memoised.
    const columns: ColumnDef<EngagementEngine>[] = [
        {
            id: 'name',
            header: t('table.engine'),
            size: 280,
            cell: ({ row }) => (
                <button
                    type="button"
                    onClick={() =>
                        navigate({
                            to: '/engagement-engines/$engineId',
                            params: { engineId: row.original.id },
                        })
                    }
                    className="flex min-w-0 flex-col text-left hover:text-primary-600"
                >
                    <span className="truncate font-semibold text-neutral-900">
                        <span className="text-caption">{row.original.name}</span>
                    </span>
                    {row.original.objective && (
                        <span className="truncate text-neutral-500">
                            <span className="text-caption">{row.original.objective}</span>
                        </span>
                    )}
                </button>
            ),
        },
        {
            id: 'status',
            header: t('table.status'),
            size: 140,
            cell: ({ row }) => {
                const m = statusMeta[row.original.status] ?? {
                    label: row.original.status,
                    tone: 'neutral' as const,
                };
                return <ToneBadge label={m.label} tone={m.tone} />;
            },
        },
        {
            id: 'channels',
            header: t('table.channels'),
            size: 200,
            cell: ({ row }) => (
                <div className="flex flex-wrap gap-1">
                    {enabledChannels(row.original).map((c) => (
                        <ChannelChip key={c} channel={c} label={channelMeta[c].label} />
                    ))}
                </div>
            ),
        },
        {
            id: 'language',
            header: t('table.language'),
            size: 110,
            cell: ({ row }) => (
                <span className="text-caption">
                    {languageOptions.find((l) => l.value === row.original.language)?.label ??
                        row.original.language}
                </span>
            ),
        },
        {
            id: 'cadence',
            header: t('table.cadence'),
            size: 100,
            cell: ({ row }) => (
                <span className="text-caption">
                    {t('card.cadence', { hours: row.original.cadenceHours })}
                </span>
            ),
        },
        ...(isAdmin && dash.data
            ? (['members', 'drafted', 'completed'] as const).map(
                  (k): ColumnDef<EngagementEngine> => ({
                      id: k,
                      header: t(`table.${k}`),
                      size: 100,
                      cell: ({ row }) => (
                          <span className="tabular-nums">
                              <span className="text-caption">
                                  {statsById[row.original.id]
                                      ? fmt(statsById[row.original.id]![k])
                                      : '—'}
                              </span>
                          </span>
                      ),
                  })
              )
            : []),
        {
            id: 'lastRun',
            header: t('table.lastRun'),
            size: 140,
            cell: ({ row }) => (
                <span className="text-caption">
                    {row.original.lastSweptAt ? formatDateTime(row.original.lastSweptAt) : '—'}
                </span>
            ),
        },
    ];

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('title')}</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <IconTile icon={Robot} size="lg" />
                        <div>
                            <h1 className="font-semibold text-neutral-900">
                                <span className="text-h2">{t('title')}</span>
                            </h1>
                            <p className="text-neutral-500">
                                <span className="text-body">{t('subtitle')}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => navigate({ to: '/engagement-engines/inbox' })}
                        >
                            <Tray className="me-1 size-4" /> {t('actions.taskInbox')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => navigate({ to: '/engagement-engines/create' })}
                        >
                            <Plus className="me-1 size-4" /> {t('actions.newEngine')}
                        </MyButton>
                    </div>
                </div>

                {!isLoading && !isError && (
                    <EnginesStatusCounts
                        statuses={all.map((e) => e.status)}
                        active={statusView}
                        onSelect={setStatusView}
                        includeArchived={showArchived}
                    />
                )}
                <EngagementTasksStrip />

                {!isLoading && !isError && all.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-72">
                            <MagnifyingGlass
                                size={16}
                                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                            />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('toolbar.search')}
                                aria-label={t('toolbar.search')}
                                className="ps-9"
                            />
                        </div>
                        <Select value={channel} onValueChange={setChannel}>
                            <SelectTrigger className="w-40" aria-label={t('toolbar.allChannels')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('toolbar.allChannels')}</SelectItem>
                                {CHANNEL_ORDER.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {channelMeta[c].label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={language} onValueChange={setLanguage}>
                            <SelectTrigger className="w-40" aria-label={t('toolbar.anyLanguage')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('toolbar.anyLanguage')}</SelectItem>
                                {languageOptions.map((l) => (
                                    <SelectItem key={l.value} value={l.value}>
                                        {l.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 text-neutral-600">
                            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                            <span className="text-body">{t('toolbar.showArchived')}</span>
                        </label>
                        <div className="ms-auto flex rounded-lg border border-neutral-200 bg-white p-0.5">
                            {(
                                [
                                    { k: 'cards', icon: SquaresFour, label: t('toolbar.cards') },
                                    { k: 'table', icon: ListBullets, label: t('toolbar.table') },
                                ] as const
                            ).map((v) => (
                                <button
                                    key={v.k}
                                    type="button"
                                    aria-pressed={view === v.k}
                                    onClick={() => setView(v.k)}
                                    className={cn(
                                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
                                        view === v.k
                                            ? 'bg-primary-50 text-primary-600'
                                            : 'text-neutral-500 hover:text-neutral-800'
                                    )}
                                >
                                    <v.icon size={14} />
                                    <span className="text-caption">{v.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {isLoading && (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-44 w-full rounded-xl" />
                        ))}
                    </div>
                )}

                {isError && (
                    <Card className="p-6 text-center text-body text-danger-600">{t('error')}</Card>
                )}

                {!isLoading && !isError && all.length === 0 && (
                    <Card className="flex flex-col items-center gap-3 p-10 text-center">
                        <Robot className="size-10 text-neutral-300" />
                        <p className="text-subtitle font-medium text-neutral-600">
                            {t('empty.title')}
                        </p>
                        <p className="max-w-md text-body text-neutral-500">{emptyDescription}</p>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => navigate({ to: '/engagement-engines/create' })}
                        >
                            <Plus className="me-1 size-4" /> {t('actions.createFirstEngine')}
                        </MyButton>
                    </Card>
                )}

                {!isLoading && !isError && all.length > 0 && rows.length === 0 && (
                    <Card className="flex flex-col items-center gap-3 p-8 text-center">
                        <MagnifyingGlass className="size-8 text-neutral-300" />
                        <p className="text-subtitle font-medium text-neutral-600">
                            {t('filteredEmpty.title')}
                        </p>
                        {filtersOn && (
                            <MyButton buttonType="secondary" scale="small" onClick={clearFilters}>
                                {t('filteredEmpty.clear')}
                            </MyButton>
                        )}
                    </Card>
                )}

                {!isLoading && !isError && rows.length > 0 && view === 'cards' && (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {rows.map((e) => (
                            <EngineCard key={e.id} engine={e} stats={statsById[e.id]} />
                        ))}
                        <NewEngineCard description={emptyDescription} />
                    </div>
                )}

                {!isLoading && !isError && rows.length > 0 && view === 'table' && (
                    <MyTable<EngagementEngine>
                        data={staticTableData(rows)}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={0}
                        enableColumnResizing={false}
                        enableColumnPinning={false}
                        scrollable
                    />
                )}
            </div>
        </LayoutContainer>
    );
}
