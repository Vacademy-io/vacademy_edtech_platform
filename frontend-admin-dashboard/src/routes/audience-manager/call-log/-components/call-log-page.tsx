/**
 * Call Log — a standalone CRM page (sidebar: Leads → Call Log), NOT a Reports
 * tab. The operational, row-level call list across AI + human, inbound +
 * outbound, every provider.
 *
 * Owns its own chrome + filter bar (date range / team / counsellor) — the same
 * shared-filter idiom as the Reports Center shell — and feeds the applied window
 * to {@link CallLogTab}, which renders the KPIs, worklist chips, table and
 * disposition flow.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise, User } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { TeamPicker } from '@/components/shared/crm/TeamPicker';
import {
    fetchCounsellors,
} from '@/routes/counsellors/-services/counsellor-workbench-services';
import CallLogTab from './CallLogTab';
import { PlaceCallDialog } from './PlaceCallDialog';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import CallIntelligenceTab from '../../reports/-components/call-intelligence-tab';
import { useCallIntelligenceEnabled, TeamCoachingSection } from '@/components/shared/leads';

// ── Date helpers (mirror the Reports shell) ────────────────────────────────

const DEFAULT_DAYS = 30;
const toDateInput = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const computeRange = (days: number) => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    return { from: toDateInput(start), to: toDateInput(now) };
};

const PRESETS = [
    { key: '7', days: 7 },
    { key: '30', days: 30 },
    { key: '90', days: 90 },
] as const;

/** Wall-clock presets ("last 1 hour"): an instant window the server honours over dates. */
const HOUR_PRESETS = [1, 3, 6, 24] as const;

interface AppliedRange {
    from: string;
    to: string;
    /** Set for hour presets; absent for day presets / manual dates. */
    fromTs?: number;
    toTs?: number;
    hours?: number;
}
const hourRange = (hours: number): AppliedRange => {
    const now = new Date();
    const start = new Date(now.getTime() - hours * 3600 * 1000);
    return { from: toDateInput(start), to: toDateInput(now), fromTs: start.getTime(), hours };
};

const ALL_COUNSELLORS_VALUE = '__ALL_COUNSELLORS__';

// ── Page ───────────────────────────────────────────────────────────────────

export function CallLogPage() {
    const { t } = useTranslation('audienceManagerCallLogPage');
    const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('header.navTitle')}</h1>);
    }, [setNavHeading, t]);

    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id ?? '';
    const queryClient = useQueryClient();
    // Call Intelligence analytics show here only when the institute has the feature on.
    const callIntelligenceEnabled = useCallIntelligenceEnabled();

    const defaults = useMemo(() => computeRange(DEFAULT_DAYS), []);
    const [fromDate, setFromDate] = useState(defaults.from);
    const [toDate, setToDate] = useState(defaults.to);
    const [applied, setApplied] = useState<AppliedRange>(defaults);
    const [customHours, setCustomHours] = useState('');
    const [teamId, setTeamId] = useState<string | undefined>(undefined);
    const [counsellorUserId, setCounsellorUserId] = useState<string | undefined>(undefined);

    const activePreset = applied.hours
        ? undefined
        : PRESETS.find((p) => {
              const r = computeRange(p.days);
              return applied.from === r.from && applied.to === r.to;
          })?.key;
    const activeHours = applied.hours;

    const applyPreset = (days: number) => {
        const r = computeRange(days);
        setFromDate(r.from);
        setToDate(r.to);
        setApplied(r);
    };
    const applyHours = (hours: number) => {
        if (!Number.isFinite(hours) || hours <= 0) return;
        const r = hourRange(Math.min(hours, 24 * 90));
        setFromDate(r.from);
        setToDate(r.to);
        setApplied(r);
    };
    const apply = () => setApplied({ from: fromDate, to: toDate });
    const reset = () => {
        setFromDate(defaults.from);
        setToDate(defaults.to);
        setApplied(defaults);
        setTeamId(undefined);
        setCounsellorUserId(undefined);
    };
    const handleTeamChange = (next: string | undefined) => {
        setTeamId(next);
        setCounsellorUserId(undefined);
    };

    const [isRefreshing, setIsRefreshing] = useState(false);
    const { t: tPages } = useTranslation('crmPages');
    const [logTab, setLogTab] = useState<'calls' | 'intel'>('calls');
    const tabbed = !!callIntelligenceEnabled;
    const refresh = async () => {
        setIsRefreshing(true);
        try {
            // 'crm-call-' rather than 'crm-call-log-': the disposition vocabulary
            // ('crm-call-disposition-*') is cached for 5 minutes and is now sourced
            // from AI Calling settings + the AI-agent registry, so adding a custom
            // outcome over in Settings must be one Refresh away from showing up in
            // the filter — not a five-minute wait. Every 'crm-call-' key belongs to
            // this page.
            await queryClient.invalidateQueries({
                predicate: (q) =>
                    typeof q.queryKey[0] === 'string' &&
                    (q.queryKey[0] as string).startsWith('crm-call-'),
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <div className="flex min-h-full flex-col gap-6 bg-neutral-50 p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
                        {t('header.title')}
                    </h1>
                    <p className="text-sm text-neutral-600">{t('header.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.Telephony}
                        label={t('header.callingSettings')}
                    />
                    <Button
                        onClick={refresh}
                        size="sm"
                        variant="outline"
                        disabled={!instituteId || isRefreshing}
                        className="gap-2"
                    >
                        <ArrowsClockwise size={14} className={cn(isRefreshing && 'animate-spin')} />
                        {t('header.refresh')}
                    </Button>
                    <PlaceCallDialog />
                </div>
            </header>

            {/* Shared filter bar */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-1 self-end rounded-md border border-neutral-200 bg-white p-1">
                    {HOUR_PRESETS.map((h) => (
                        <button
                            key={`h${h}`}
                            type="button"
                            onClick={() => applyHours(h)}
                            className={cn(
                                'rounded px-2.5 py-1 text-xs',
                                activeHours === h
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-50'
                            )}
                        >
                            {t('filters.presetHours', { hours: h })}
                        </button>
                    ))}
                    <span className="mx-0.5 h-4 w-px bg-neutral-200" aria-hidden />
                    {PRESETS.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => applyPreset(p.days)}
                            className={cn(
                                'rounded px-2.5 py-1 text-xs',
                                activePreset === p.key
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-50'
                            )}
                        >
                            {t('filters.presetLabel', { days: p.days })}
                        </button>
                    ))}
                    <span className="mx-0.5 h-4 w-px bg-neutral-200" aria-hidden />
                    <Input
                        type="number"
                        min={1}
                        max={2160}
                        value={customHours}
                        onChange={(e) => setCustomHours(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') applyHours(Number(customHours));
                        }}
                        onBlur={() => customHours && applyHours(Number(customHours))}
                        placeholder={t('filters.customHoursPlaceholder')}
                        aria-label={t('filters.customHoursLabel')}
                        className={cn(
                            'h-7 w-24 text-xs',
                            activeHours && !HOUR_PRESETS.includes(activeHours as 1 | 3 | 6 | 24)
                                ? 'border-primary-500'
                                : ''
                        )}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="cl-from" className="text-xs text-neutral-600">
                        {t('filters.from')}
                    </Label>
                    <Input
                        id="cl-from"
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        className="w-40"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="cl-to" className="text-xs text-neutral-600">
                        {t('filters.to')}
                    </Label>
                    <Input
                        id="cl-to"
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        className="w-40"
                    />
                </div>
                <Button onClick={apply} size="sm" disabled={!instituteId}>
                    {t('filters.apply')}
                </Button>
                <Button onClick={reset} size="sm" variant="ghost">
                    {t('filters.reset')}
                </Button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <TeamPicker
                        instituteId={instituteId}
                        value={teamId}
                        onChange={handleTeamChange}
                    />
                    <CounsellorScopePicker
                        instituteId={instituteId}
                        value={counsellorUserId}
                        onChange={setCounsellorUserId}
                    />
                </div>
            </div>

            {/* Calls and Call Intelligence as tabs instead of stacked. */}
            {tabbed && (
                <div className="flex w-fit rounded-lg border border-neutral-200 bg-white p-0.5">
                    {(['calls', 'intel'] as const).map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setLogTab(k)}
                            className={cn(
                                'rounded-md px-4 py-1.5 font-medium transition-colors',
                                logTab === k
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-100'
                            )}
                        >
                            <span className="text-caption">{tPages(`callLog.tabs.${k}`)}</span>
                        </button>
                    ))}
                </div>
            )}

            {!instituteId ? (
                <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700">
                    {t('filters.noInstitute')}
                </div>
            ) : tabbed && logTab === 'intel' ? null : (
                <CallLogTab
                    instituteId={instituteId}
                    fromDate={applied.from}
                    toDate={applied.to}
                    fromTs={applied.fromTs}
                    toTs={applied.toTs}
                    teamId={teamId}
                    counsellorUserId={counsellorUserId}
                />
            )}

            {/* AI Call Intelligence analytics — team quality, outcome/sentiment mix,
                per-counsellor leaderboard. Only when the institute has it enabled. */}
            {instituteId && callIntelligenceEnabled && (!tabbed || logTab === 'intel') && (
                <div className="flex flex-col gap-3">
                    <h2 className="text-base font-semibold text-neutral-900">
                        {t('callIntelligence.heading')}
                    </h2>
                    <CallIntelligenceTab
                        instituteId={instituteId}
                        fromDate={applied.from}
                        toDate={applied.to}
                        teamId={teamId}
                        counsellorUserId={counsellorUserId}
                    />
                    {/* Whole-team coaching from all analyzed calls — weakest skills,
                        recurring themes and objections across the team. */}
                    <TeamCoachingSection
                        instituteId={instituteId}
                        fromMillis={new Date(applied.from).getTime()}
                        toMillis={new Date(`${applied.to}T23:59:59`).getTime()}
                    />
                </div>
            )}
        </div>
    );
}

// ── Counsellor scope picker (same contract as the Reports shell) ────────────

function CounsellorScopePicker({
    instituteId,
    value,
    onChange,
}: {
    instituteId: string;
    value: string | undefined;
    onChange: (userId: string | undefined) => void;
}) {
    const { t } = useTranslation('audienceManagerCallLogPage');
    // Role-based roster: every COUNSELLOR-role user the caller may see —
    // hierarchy scope for scoped callers, institute-wide for pure admins.
    const rosterQuery = useQuery({
        queryKey: ['report-counsellor-roster', instituteId],
        enabled: !!instituteId,
        retry: false,
        staleTime: 5 * 60 * 1000,
        queryFn: () => fetchCounsellors(instituteId, { size: 500 }),
    });

    const options = useMemo(
        () =>
            (rosterQuery.data?.content ?? [])
                .map((c) => ({ id: c.user_id, name: c.full_name ?? c.email ?? c.user_id }))
                .sort((a, b) => a.name.localeCompare(b.name)),
        [rosterQuery.data]
    );

    if (rosterQuery.isError || options.length === 0) return null;

    return (
        <Select
            value={value ?? ALL_COUNSELLORS_VALUE}
            onValueChange={(v) => onChange(v === ALL_COUNSELLORS_VALUE ? undefined : v)}
        >
            <SelectTrigger
                className="h-9 w-52 bg-white"
                aria-label={t('counsellorPicker.ariaLabel')}
            >
                <User className="mr-1.5 size-4 shrink-0 text-neutral-400" />
                <SelectValue placeholder={t('counsellorPicker.allCounsellors')} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_COUNSELLORS_VALUE}>
                    {t('counsellorPicker.allCounsellors')}
                </SelectItem>
                {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                        {o.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
