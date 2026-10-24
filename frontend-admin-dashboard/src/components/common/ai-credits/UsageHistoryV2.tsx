/**
 * History tab v2 of the AI credits popover: one row per metered AI use
 * (ai_usage_event joined to the ledger), merged with non-usage ledger rows
 * (grants, purchases, adjustments) when no feature/user/role filter is set.
 *
 * Mounted only when usage-config reports history_v2_enabled; otherwise the
 * popover renders the v1 TransactionsTab unchanged.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretDown, DownloadSimple, Receipt } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { parseUtcDate } from '@/utils/dateUtils';
import {
    ROLE_CLASSES,
    downloadUsageEventsCsv,
    toNumber,
    useUsageEventsQuery,
    useUsageSummaryQuery,
    type UsageEventFilters,
    type UsageEventItem,
    type UsageLedgerItem,
} from '@/services/ai-credits/usage-v2';
import {
    contextEntries,
    eventAmount,
    featureGroupStyle,
    ledgerTypeStyle,
    modelShortName,
    unitLines,
} from './usageV2Format';
import { allowancePart, planRowBadge } from './aiPlan';

const PAGE_SIZE = 10;
const ALL = '__all__';
/** Look-back for the filter option lists (users / feature groups seen). */
const OPTION_DAYS = 90;

interface UsageHistoryV2Props {
    instituteId: string;
    isAdmin: boolean;
}

function useFormatters() {
    const { i18n } = useTranslation();
    const locale = i18n.language || 'en';
    return useMemo(() => {
        const credits = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
        const balance = new Intl.NumberFormat(locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        });
        const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
        const time = (iso: string) =>
            parseUtcDate(iso).toLocaleString(locale, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        return { credits, balance, integer, time, locale };
    }, [locale]);
}

type Formatters = ReturnType<typeof useFormatters>;

function Chip({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
    return (
        <span
            className={cn(
                'max-w-full truncate rounded bg-neutral-100 px-1 py-0.5 text-2xs text-neutral-500',
                mono && 'font-mono'
            )}
        >
            {children}
        </span>
    );
}

// ─── Amount column ─────────────────────────────────
function EventAmount({ event, fmt }: { event: UsageEventItem; fmt: Formatters }) {
    const { t } = useTranslation('aiCreditsUsage');
    const amount = eventAmount(event);
    switch (amount.kind) {
        case 'charged':
            return (
                <span className="text-xs font-bold text-danger-600">
                    {'−'}
                    {fmt.credits.format(amount.credits)}
                </span>
            );
        case 'included': {
            // Plan wording: INCLUDED = covered by the plan, ALLOWANCE = paid from the plan allowance.
            const badge = planRowBadge(event.billing_mode, amount.credits);
            return (
                <span className="rounded bg-purple-50 px-1 py-0.5 text-2xs font-semibold text-purple-700">
                    {badge === 'fromAllowance'
                        ? t('amount.fromAllowance')
                        : badge === 'includedInPlan'
                          ? t('amount.includedInPlan')
                          : t('amount.included')}
                </span>
            );
        }
        case 'ownKey':
            return (
                <span className="rounded bg-info-50 px-1 py-0.5 text-2xs font-semibold text-info-700">
                    {t('amount.ownKey')}
                </span>
            );
        case 'notCharged':
            return (
                <span className="block max-w-24 whitespace-normal text-2xs font-semibold leading-tight text-warning-700">
                    {t('amount.notCharged')}
                </span>
            );
        default:
            return (
                <span className="rounded bg-success-50 px-1 py-0.5 text-2xs font-semibold text-success-700">
                    {t('amount.free')}
                </span>
            );
    }
}

// ─── Usage row ─────────────────────────────────────
function UsageEventRow({
    event,
    isAdmin,
    expanded,
    onToggle,
    fmt,
}: {
    event: UsageEventItem;
    isAdmin: boolean;
    expanded: boolean;
    onToggle: () => void;
    fmt: Formatters;
}) {
    const { t } = useTranslation('aiCreditsUsage');
    const style = featureGroupStyle(event.feature_group);
    const Icon = style.icon;
    const label = event.label || event.use_case_label || t('history.otherUsage');
    const model = modelShortName(event);
    const roleClass = event.actor_role_class && event.actor_role_class !== 'UNKNOWN';
    const surface = event.surface && event.surface !== 'UNKNOWN';
    const amount = eventAmount(event);
    const balanceAfter = event.balance_after;
    // Admins see everyone's rows; name the actor when the label does not.
    const showActor =
        isAdmin &&
        !!event.actor_name &&
        !label.toLowerCase().includes(event.actor_name.toLowerCase());

    const units = unitLines(event);
    const ctx = contextEntries(event.context);
    const listCredits = toNumber(event.list_credits);
    const realCost = event.real_cost_usd;
    const planBadge = planRowBadge(event.billing_mode, toNumber(event.credits_charged));
    const allowancePaid =
        planBadge === 'fromAllowance' || planBadge === 'splitAllowance'
            ? allowancePart(listCredits, toNumber(event.credits_charged))
            : 0;

    return (
        <div className="overflow-hidden rounded-lg border bg-white">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={expanded ? t('history.hideDetails') : t('history.showDetails')}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-start transition-colors hover:bg-neutral-50"
            >
                <span className={cn('shrink-0 rounded-lg p-1.5', style.bgColor)}>
                    <Icon className={cn('size-3', style.color)} weight="bold" />
                </span>
                <span className="block min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-neutral-800">
                        {label}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-2xs text-neutral-400">
                        {event.use_case_label && event.use_case_label !== label && (
                            <Chip>{event.use_case_label}</Chip>
                        )}
                        {showActor && <Chip>{event.actor_name}</Chip>}
                        {roleClass && (
                            <Chip>
                                {t(`roleClass.${event.actor_role_class}`, {
                                    defaultValue: event.actor_role_class,
                                })}
                            </Chip>
                        )}
                        {model && <Chip mono>{model}</Chip>}
                        {surface && (
                            <Chip>
                                {t(`surface.${event.surface}`, { defaultValue: event.surface })}
                            </Chip>
                        )}
                        <span>{fmt.time(event.occurred_at)}</span>
                    </span>
                </span>
                <span className="block shrink-0 text-end">
                    <EventAmount event={event} fmt={fmt} />
                    {planBadge === 'splitAllowance' && allowancePaid > 0 && (
                        <span className="block text-2xs text-purple-600">
                            {t('amount.splitAllowance', {
                                credits: fmt.credits.format(allowancePaid),
                            })}
                        </span>
                    )}
                    {amount.refunded > 0 && (
                        <span className="block text-2xs text-success-600">
                            {t('amount.refunded', {
                                credits: fmt.credits.format(amount.refunded),
                            })}
                        </span>
                    )}
                    {balanceAfter !== null && balanceAfter !== undefined && balanceAfter !== '' && (
                        <span className="block text-2xs text-neutral-400">
                            {t('history.balanceAfter', {
                                balance: fmt.balance.format(toNumber(balanceAfter)),
                            })}
                        </span>
                    )}
                </span>
                <CaretDown
                    className={cn(
                        'size-3 shrink-0 text-neutral-400 transition-transform',
                        expanded && 'rotate-180'
                    )}
                />
            </button>
            {expanded && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t bg-neutral-50 px-3 py-2 text-2xs">
                    {event.actor_name && (
                        <DetailRow label={t('details.byUser')} value={event.actor_name} />
                    )}
                    {event.subject_name && (
                        <DetailRow label={t('details.onBehalfOf')} value={event.subject_name} />
                    )}
                    {event.model_id && (
                        <DetailRow label={t('details.model')} value={event.model_id} mono />
                    )}
                    {units.map((u) => (
                        <DetailRow
                            key={u.key}
                            label={t(u.labelKey)}
                            value={fmt.integer.format(u.value)}
                        />
                    ))}
                    {listCredits > 0 && (
                        <DetailRow
                            label={t('details.listCredits')}
                            value={fmt.credits.format(listCredits)}
                        />
                    )}
                    <DetailRow
                        label={t('details.charged')}
                        value={fmt.credits.format(toNumber(event.credits_charged))}
                    />
                    {allowancePaid > 0 && (
                        <DetailRow
                            label={t('details.fromAllowance')}
                            value={fmt.credits.format(allowancePaid)}
                        />
                    )}
                    {amount.refunded > 0 && (
                        <DetailRow
                            label={t('details.refundedCredits')}
                            value={fmt.credits.format(amount.refunded)}
                        />
                    )}
                    {event.charge_status && (
                        <DetailRow label={t('details.status')} value={event.charge_status} mono />
                    )}
                    {event.batch_id && (
                        <DetailRow label={t('details.batch')} value={event.batch_id} mono />
                    )}
                    {realCost !== undefined && realCost !== null && realCost !== '' && (
                        <DetailRow
                            label={t('details.realCost')}
                            value={`$${toNumber(realCost).toFixed(4)}`}
                            mono
                        />
                    )}
                    {ctx.map(([k, v]) => (
                        <DetailRow key={`ctx-${k}`} label={k} value={v} />
                    ))}
                </dl>
            )}
        </div>
    );
}

function DetailRow({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="min-w-0">
            <dt className="truncate capitalize text-neutral-400">{label}</dt>
            <dd className={cn('truncate text-neutral-700', mono && 'font-mono')} title={value}>
                {value}
            </dd>
        </div>
    );
}

// ─── Ledger row (grant / purchase / adjustment) ────
function LedgerRow({ item, fmt }: { item: UsageLedgerItem; fmt: Formatters }) {
    const { t } = useTranslation('aiCreditsUsage');
    const amount = toNumber(item.amount);
    const cfg = ledgerTypeStyle(item.transaction_type, amount);
    const Icon = cfg.icon;
    const isPositive = amount > 0;
    return (
        <div className="flex items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 transition-colors hover:bg-neutral-50">
            <div className={cn('rounded-lg p-1.5', cfg.bgColor)}>
                <Icon className={cn('size-3', cfg.color)} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-neutral-800">
                    {item.description || t(cfg.labelKey)}
                </span>
                <div className="mt-0.5 flex items-center gap-2 text-2xs text-neutral-400">
                    <Chip>{t(cfg.labelKey)}</Chip>
                    <span>{fmt.time(item.occurred_at)}</span>
                </div>
            </div>
            <div className="text-end">
                <span
                    className={cn(
                        'text-xs font-bold',
                        isPositive ? 'text-success-600' : 'text-danger-600'
                    )}
                >
                    {isPositive ? '+' : '−'}
                    {fmt.credits.format(Math.abs(amount))}
                </span>
                {item.balance_after !== null && item.balance_after !== undefined && (
                    <div className="text-2xs text-neutral-400">
                        {t('history.balanceAfter', {
                            balance: fmt.balance.format(toNumber(item.balance_after)),
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Filter select ─────────────────────────────────
function FilterSelect({
    value,
    onChange,
    allLabel,
    ariaLabel,
    options,
}: {
    value: string | undefined;
    onChange: (v: string | undefined) => void;
    allLabel: string;
    ariaLabel: string;
    options: { value: string; label: string }[];
}) {
    return (
        <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
            <SelectTrigger aria-label={ariaLabel} className="h-7 bg-white px-2 text-2xs">
                <SelectValue placeholder={allLabel} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
                <SelectItem value={ALL} className="text-xs">
                    {allLabel}
                </SelectItem>
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// ─── Tab ───────────────────────────────────────────
export function UsageHistoryV2({ instituteId, isAdmin }: UsageHistoryV2Props) {
    const { t } = useTranslation('aiCreditsUsage');
    const fmt = useFormatters();
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState<UsageEventFilters>({});
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    const { data, isLoading, isError } = useUsageEventsQuery(instituteId, filters, page, PAGE_SIZE);
    const { data: groupSummary } = useUsageSummaryQuery(
        instituteId,
        OPTION_DAYS,
        'feature_group',
        'charged'
    );
    const { data: userSummary } = useUsageSummaryQuery(
        instituteId,
        OPTION_DAYS,
        'user',
        'charged',
        isAdmin
    );

    const setFilter = (key: keyof UsageEventFilters, value: string | undefined) => {
        setPage(1);
        setExpandedId(null);
        setFilters((f) => {
            const next = { ...f };
            if (value === undefined) delete next[key];
            else (next as Record<string, string>)[key] = value;
            return next;
        });
    };

    const roleOptions = useMemo(
        () =>
            ROLE_CLASSES.filter((r) => r !== 'UNKNOWN').map((r) => ({
                value: r,
                label: t(`roleClass.${r}`, { defaultValue: r }),
            })),
        [t]
    );
    const groupOptions = useMemo(
        () =>
            (groupSummary?.rows ?? [])
                .filter((r) => !!r.key)
                .map((r) => ({ value: r.key, label: r.label || r.key })),
        [groupSummary]
    );
    const userOptions = useMemo(
        () =>
            (userSummary?.rows ?? [])
                .filter((r) => !!r.key)
                .map((r) => ({ value: r.key, label: r.label || r.key })),
        [userSummary]
    );

    const hasFilters = Object.keys(filters).length > 0;
    const totalPages = data
        ? Math.max(1, Math.ceil(data.total / (data.page_size || PAGE_SIZE)))
        : 1;

    const handleExport = async () => {
        setExporting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            await downloadUsageEventsCsv(instituteId, filters, `ai-usage-${today}.csv`);
        } catch {
            toast.error(t('filters.exportFailed'), {
                description: t('filters.exportFailedHint'),
            });
        } finally {
            setExporting(false);
        }
    };

    const items = data?.items ?? [];

    return (
        <div className="space-y-2">
            {/* Filters */}
            <div className="grid grid-cols-2 gap-1.5">
                {isAdmin && (
                    <FilterSelect
                        value={filters.user_id}
                        onChange={(v) => setFilter('user_id', v)}
                        allLabel={t('filters.allUsers')}
                        ariaLabel={t('filters.user')}
                        options={userOptions}
                    />
                )}
                <FilterSelect
                    value={filters.role_class}
                    onChange={(v) => setFilter('role_class', v)}
                    allLabel={t('filters.allRoles')}
                    ariaLabel={t('filters.role')}
                    options={roleOptions}
                />
                <FilterSelect
                    value={filters.feature_group}
                    onChange={(v) => setFilter('feature_group', v)}
                    allLabel={t('filters.allFeatures')}
                    ariaLabel={t('filters.feature')}
                    options={groupOptions}
                />
                {isAdmin && (
                    <button
                        type="button"
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex h-7 items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 text-2xs font-medium text-neutral-600 transition-colors hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50"
                    >
                        <DownloadSimple
                            className={cn('size-3', exporting && 'animate-pulse')}
                            weight="bold"
                        />
                        {exporting ? t('filters.exporting') : t('filters.export')}
                    </button>
                )}
            </div>
            {hasFilters && (
                <button
                    type="button"
                    onClick={() => {
                        setPage(1);
                        setExpandedId(null);
                        setFilters({});
                    }}
                    className="text-2xs font-medium text-purple-600 hover:underline"
                >
                    {t('filters.clear')}
                </button>
            )}

            {/* Rows */}
            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))}
                </div>
            ) : isError ? (
                <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
                    {t('history.error')}
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-neutral-400">
                    <Receipt className="mb-2 size-8 text-neutral-300" />
                    {hasFilters ? t('history.emptyFiltered') : t('history.empty')}
                </div>
            ) : (
                <div className="space-y-1.5">
                    {items.map((item) =>
                        item.kind === 'ledger' ? (
                            <LedgerRow key={`l-${item.id}`} item={item} fmt={fmt} />
                        ) : (
                            <UsageEventRow
                                key={`u-${item.id}`}
                                event={item}
                                isAdmin={isAdmin}
                                expanded={expandedId === item.id}
                                onToggle={() =>
                                    setExpandedId((id) => (id === item.id ? null : item.id))
                                }
                                fmt={fmt}
                            />
                        )
                    )}
                </div>
            )}

            {/* Pagination */}
            {data && totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="rounded-md border px-2.5 py-1 text-2xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {t('history.prev')}
                    </button>
                    <span className="text-2xs text-neutral-500">
                        {t('history.pageOf', { page, pages: totalPages })}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="rounded-md border px-2.5 py-1 text-2xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {t('history.next')}
                    </button>
                </div>
            )}
        </div>
    );
}
