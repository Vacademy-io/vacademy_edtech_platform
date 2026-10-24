import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useEffect, useMemo, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    Check,
    FilePlus,
    FileText,
    Flask,
    GraduationCap,
    Info,
    ListBullets,
    Robot,
    ShieldCheck,
    UsersThree,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { MultiSelect } from '@/components/design-system/multi-select';
import PackageSelector from '@/components/design-system/PackageSelector';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { buildTimezoneOptions } from '@/routes/study-library/live-session/schedule/-constants/options';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCampaignsList } from '@/routes/audience-manager/list/-hooks/useCampaignsList';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { buildChannelMeta, CHANNEL_ORDER, buildLanguageOptions } from '../-constants';
import { useCreateEngine, useDataPointCatalog } from '../-hooks';
import {
    CHANNEL_ICON,
    CHANNEL_TINT,
    ChannelChip,
    Chip,
    IconTile,
    KeyValue,
} from '../-components/engine-ui';
import type {
    AudienceSelector,
    ChannelKey,
    ChannelsConfig,
    CreateEngineRequest,
    DataPointSpec,
    EngineLanguage,
} from '../-types';

export const Route = createLazyFileRoute('/engagement-engines/create/')({
    component: CreateEnginePage,
});

const STEP_KEYS = ['basics', 'dataPoints', 'channels', 'audience', 'cadence', 'review'] as const;

function StepRail({
    current,
    t,
    onGoTo,
}: {
    current: number;
    t: TFunction;
    onGoTo: (step: number) => void;
}) {
    return (
        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-neutral-100 bg-neutral-50 p-3 lg:w-64 lg:flex-col lg:border-b-0 lg:border-e lg:p-4">
            {STEP_KEYS.map((key, i) => {
                const label = t(`steps.${key}`);
                const done = i < current;
                const active = i === current;
                return (
                    <button
                        key={key}
                        type="button"
                        // Only steps already passed can be revisited, so step validation still
                        // gates every forward move.
                        disabled={!done}
                        onClick={() => onGoTo(i)}
                        aria-current={active ? 'step' : undefined}
                        className={cn(
                            'flex shrink-0 items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                            active && 'bg-white shadow-sm',
                            done && 'hover:bg-white',
                            !done && 'cursor-default'
                        )}
                    >
                        <span
                            className={cn(
                                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-medium',
                                done && 'border-primary-500 bg-primary-500 text-white',
                                active && 'border-primary-500 text-primary-600',
                                !done && !active && 'border-neutral-300 text-neutral-400'
                            )}
                        >
                            {done ? (
                                <Check className="size-3.5" />
                            ) : (
                                <span className="text-caption">{i + 1}</span>
                            )}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span
                                className={
                                    active ? 'font-semibold text-neutral-900' : 'text-neutral-600'
                                }
                            >
                                <span className="text-body">{label}</span>
                            </span>
                            <span className="hidden text-neutral-500 lg:block">
                                <span className="text-caption">{t(`stepHints.${key}`)}</span>
                            </span>
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}

/** A titled block inside a step, with an icon tile. */
function StepSection({
    icon,
    title,
    hint,
    children,
}: {
    icon: Icon;
    title: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-4">
            <div className="flex items-start gap-3">
                <IconTile icon={icon} size="sm" tint="bg-neutral-100 text-neutral-600" />
                <div className="min-w-0">
                    <p className="font-semibold text-neutral-800">
                        <span className="text-subtitle">{title}</span>
                    </p>
                    {hint && (
                        <p className="text-neutral-500">
                            <span className="text-caption">{hint}</span>
                        </p>
                    )}
                </div>
            </div>
            {children}
        </section>
    );
}

function StepLead({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-neutral-600">
            <span className="text-body">{children}</span>
        </p>
    );
}

/** A switch row inside a channel card: a title, a one-line hint and the toggle. */
function ChannelOption({
    title,
    hint,
    ariaLabel,
    checked,
    onChange,
}: {
    title: string;
    hint: string;
    ariaLabel: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex items-start justify-between gap-3 border-t border-neutral-200 pt-3">
            <span className="flex flex-col">
                <span className="font-medium text-neutral-700">
                    <span className="text-body">{title}</span>
                </span>
                <span className="text-neutral-500">
                    <span className="text-caption">{hint}</span>
                </span>
            </span>
            <Switch aria-label={ariaLabel} checked={checked} onCheckedChange={onChange} />
        </label>
    );
}

const SENSITIVITY_TINT: Record<NonNullable<DataPointSpec['sensitivity']>, string> = {
    LOW: 'bg-neutral-100 text-neutral-600',
    MEDIUM: 'bg-warning-50 text-warning-700',
    HIGH: 'bg-danger-50 text-danger-700',
};

function CreateEnginePage() {
    const navigate = useNavigate();
    // Timezone labels are translated, so the list is built from the shared
    // options namespace rather than being a module-level constant.
    const { t: tOptions } = useTranslation('studyLibraryOptions');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const { t } = useTranslation('engagementEnginesCreateIndex');
    const TIMEZONE_OPTIONS = buildTimezoneOptions(tOptions);
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId() || '';
    const createEngine = useCreateEngine();
    const { data: catalog } = useDataPointCatalog();
    const { data: campaignsPage } = useCampaignsList({
        institute_id: instituteId,
        page: 0,
        size: 100,
    });
    const campaigns = campaignsPage?.content ?? [];

    useEffect(() => setNavHeading(t('heading')), [setNavHeading, t]);

    const [step, setStep] = useState(0);

    // Form state
    const [name, setName] = useState('');
    const [objective, setObjective] = useState('');
    const [brief, setBrief] = useState('');
    const [language, setLanguage] = useState<EngineLanguage>('en');
    const [dataPoints, setDataPoints] = useState<string[]>([]);
    const [consentHigh, setConsentHigh] = useState(false);
    const [channels, setChannels] = useState<ChannelsConfig>({ IN_APP: { enabled: true } });
    const [batchIds, setBatchIds] = useState<string[]>([]);
    const [audienceIds, setAudienceIds] = useState<string[]>([]);
    const [cadenceHours, setCadenceHours] = useState('72');
    const [quietStart, setQuietStart] = useState<string>('21');
    const [quietEnd, setQuietEnd] = useState<string>('8');
    const [timezone, setTimezone] = useState('Asia/Kolkata');
    const [holdoutPct, setHoldoutPct] = useState('0');
    const [firstN, setFirstN] = useState('');

    const batchesLabel = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const audiencesLabel = getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList);
    const learnersLower = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner).toLowerCase();

    // Always-on data points are read whatever the selection, so their sensitivity counts too.
    const highSelected = useMemo(
        () =>
            (catalog ?? []).some(
                (d) => d.sensitivity === 'HIGH' && (d.alwaysOn || dataPoints.includes(d.key))
            ),
        [catalog, dataPoints]
    );

    const enabledChannelKeys = CHANNEL_ORDER.filter((c) => channels[c]?.enabled);
    const audienceCount = batchIds.length + audienceIds.length;

    // Use the campaign's `id` (the audience row PK) — that IS the audience id the engagement
    // backend's leadsByAudience(ar.audience_id = :id) resolves against. The DTO's `campaign_id`
    // and `audience_id` fields are vestigial and always null, so filtering on audience_id
    // dropped every campaign and left this picker permanently empty for all institutes.
    const campaignOptions = campaigns
        .filter((c) => c.id)
        .map((c) => ({ label: c.campaign_name, value: c.id as string }));

    const canProceed = (s: number): boolean => {
        switch (s) {
            case 0:
                return name.trim().length > 0 && brief.trim().length > 0;
            case 1:
                return !highSelected || consentHigh;
            case 2:
                return enabledChannelKeys.length > 0;
            case 3:
                return audienceCount > 0;
            case 4:
                return Number(cadenceHours) >= 1;
            default:
                return true;
        }
    };

    const toggleChannel = (c: ChannelKey, patch: Partial<ChannelsConfig[ChannelKey]>) =>
        setChannels((prev) => ({
            ...prev,
            [c]: {
                ...prev[c],
                ...patch,
                // Disabling a channel clears its dependent intents — otherwise the auto/autoReply
                // sub-toggles vanish (they only render when enabled) leaving a stale flag the user
                // can't clear, which would report a disabled channel as auto-sending.
                ...(patch?.enabled === false ? { auto: false, autoReply: false } : {}),
            },
        }));

    const buildPayload = (): CreateEngineRequest => {
        const audience: AudienceSelector[] = [
            ...batchIds.map((id) => ({ type: 'PACKAGE_SESSION' as const, id })),
            ...audienceIds.map((id) => ({ type: 'AUDIENCE' as const, id })),
        ];
        // Strip the display-only label the wizard tracks so the backend gets pure {type,id}.
        const audiencePayload = audience.map(({ type, id }) => ({ type, id }));
        const quietHours = { startHour: Number(quietStart), endHour: Number(quietEnd), timezone };
        return {
            name: name.trim(),
            objective: objective.trim() || undefined,
            brief: brief.trim(),
            language,
            dataPoints,
            channels: JSON.stringify(channels),
            audience: JSON.stringify(audiencePayload),
            quietHours: JSON.stringify(quietHours),
            cadenceHours: Number(cadenceHours),
            holdoutPct: Math.max(0, Math.min(100, Number(holdoutPct) || 0)),
            firstN: firstN.trim() ? Math.max(0, Number(firstN)) : undefined,
        };
    };

    const submit = () => {
        if (!canProceed(0)) {
            toast.error(t('errors.nameAndBrief'));
            setStep(0);
            return;
        }
        createEngine.mutate(buildPayload(), {
            onSuccess: (engine) =>
                navigate({ to: '/engagement-engines/$engineId', params: { engineId: engine.id } }),
        });
    };

    const channelMeta = buildChannelMeta(tConstants);
    const languageOptions = buildLanguageOptions(tConstants);
    const holdoutValue = Math.max(0, Math.min(100, Number(holdoutPct) || 0));
    const quietFrom = Number(quietStart);
    const quietTo = Number(quietEnd);
    // Display only: the window wraps past midnight when the end is before the start.
    const isQuiet = (h: number) =>
        quietFrom === quietTo
            ? false
            : quietFrom < quietTo
              ? h >= quietFrom && h < quietTo
              : h >= quietFrom || h < quietTo;
    const dataPointLabel = (key: string) =>
        (catalog ?? []).find((d) => d.key === key)?.label ?? key;
    const autoSendKeys = CHANNEL_ORDER.filter((c) => channels[c]?.enabled && channels[c]?.auto);
    const hours = Array.from({ length: 24 }, (_, h) => h);

    const nextSteps: { icon: Icon; tint: string; key: string }[] = [
        { icon: FilePlus, tint: 'bg-neutral-100 text-neutral-600', key: 'draft' },
        { icon: UsersThree, tint: 'bg-info-50 text-info-600', key: 'enroll' },
        ...(channels.WHATSAPP?.enabled
            ? [{ icon: FileText, tint: 'bg-warning-50 text-warning-600', key: 'templates' }]
            : []),
        { icon: Flask, tint: 'bg-primary-50 text-primary-500', key: 'activate' },
    ];

    const basicsStep = (
        <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
                <MyInput
                    label={t('basics.name')}
                    required
                    inputType="text"
                    inputPlaceholder={t('basics.namePlaceholder', { learners: learnersLower })}
                    input={name}
                    onChangeFunction={(e) => setName(e.target.value)}
                />
                <MyInput
                    label={t('basics.objective')}
                    inputType="text"
                    inputPlaceholder={t('basics.objectivePlaceholder', { learners: learnersLower })}
                    input={objective}
                    onChangeFunction={(e) => setObjective(e.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1">
                <label htmlFor="engine-brief" className="text-subtitle font-regular">
                    {t('basics.brief')}
                    <span className="text-danger-600">*</span>
                </label>
                <Textarea
                    id="engine-brief"
                    rows={7}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={t('basics.briefPlaceholder', { learners: learnersLower })}
                />
                <p className="text-caption text-neutral-500">{t('basics.briefHint')}</p>
            </div>
            <div className="w-full sm:w-80">
                <label className="mb-1 block text-subtitle font-regular">
                    {t('basics.language')}
                </label>
                <SearchableSelect
                    options={languageOptions.map((l) => ({ label: l.label, value: l.value }))}
                    value={language}
                    onChange={(v) => setLanguage(v as EngineLanguage)}
                />
            </div>
        </div>
    );

    const dataPointsStep = (
        <div className="flex flex-col gap-4">
            <StepLead>{t('dataPoints.intro')}</StepLead>
            <div className="grid gap-3 md:grid-cols-2">
                {(catalog ?? []).map((d) => {
                    const alwaysOn = d.alwaysOn === true;
                    const selected = alwaysOn || dataPoints.includes(d.key);
                    return (
                        <button
                            key={d.key}
                            type="button"
                            disabled={alwaysOn}
                            aria-pressed={selected}
                            onClick={() =>
                                setDataPoints((prev) =>
                                    selected ? prev.filter((k) => k !== d.key) : [...prev, d.key]
                                )
                            }
                            className={cn(
                                'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                                selected
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200 hover:border-primary-200',
                                alwaysOn && 'cursor-default'
                            )}
                        >
                            <span
                                className={cn(
                                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                                    selected
                                        ? 'border-primary-500 bg-primary-500 text-white'
                                        : 'border-neutral-300 bg-white'
                                )}
                            >
                                {selected && <Check size={12} weight="bold" />}
                            </span>
                            <span className="flex min-w-0 flex-col gap-1">
                                <span className="font-semibold text-neutral-800">
                                    <span className="text-subtitle">{d.label}</span>
                                </span>
                                {d.description && (
                                    <span className="text-neutral-500">
                                        <span className="text-caption">{d.description}</span>
                                    </span>
                                )}
                                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                    {alwaysOn && <Chip label={t('dataPoints.alwaysOn')} />}
                                    {d.sensitivity && (
                                        <Chip
                                            label={t(`dataPoints.sensitivity.${d.sensitivity}`)}
                                            className={SENSITIVITY_TINT[d.sensitivity]}
                                        />
                                    )}
                                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-500">
                                        <span className="text-caption">{d.key}</span>
                                    </code>
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            {highSelected && (
                <label className="flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4">
                    <ShieldCheck size={20} className="mt-0.5 shrink-0 text-warning-600" />
                    <Checkbox
                        checked={consentHigh}
                        onCheckedChange={(v) => setConsentHigh(v === true)}
                        className="mt-0.5"
                    />
                    <span className="text-caption text-neutral-700">{t('dataPoints.consent')}</span>
                </label>
            )}
        </div>
    );

    const channelsStep = (
        <div className="flex flex-col gap-4">
            <StepLead>{t('channels.intro')}</StepLead>
            <div className="grid gap-3 md:grid-cols-2">
                {CHANNEL_ORDER.map((c) => {
                    const meta = channelMeta[c];
                    const cfg = channels[c] ?? {};
                    return (
                        <div
                            key={c}
                            className={cn(
                                'flex flex-col gap-3 rounded-xl border p-4 transition-colors',
                                cfg.enabled
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <IconTile icon={CHANNEL_ICON[c]} size="sm" tint={CHANNEL_TINT[c]} />
                                <span className="flex-1 font-semibold text-neutral-800">
                                    <span className="text-subtitle">{meta.label}</span>
                                </span>
                                <Switch
                                    aria-label={t('channels.enableAria', { channel: meta.label })}
                                    checked={!!cfg.enabled}
                                    onCheckedChange={(v) => toggleChannel(c, { enabled: v })}
                                />
                            </div>
                            {cfg.enabled && meta.supportsAuto && (
                                <ChannelOption
                                    title={t('channels.autoTitle')}
                                    hint={t('channels.autoHint')}
                                    ariaLabel={t('channels.autoAria', { channel: meta.label })}
                                    checked={!!cfg.auto}
                                    onChange={(v) => toggleChannel(c, { auto: v })}
                                />
                            )}
                            {cfg.enabled && meta.supportsAutoReply && (
                                <ChannelOption
                                    title={t('channels.autoReplyTitle')}
                                    hint={t('channels.autoReplyHint')}
                                    ariaLabel={t('channels.autoReplyAria', {
                                        channel: meta.label,
                                    })}
                                    checked={!!cfg.autoReply}
                                    onChange={(v) => toggleChannel(c, { autoReply: v })}
                                />
                            )}
                            {!meta.supportsAuto && (
                                <p className="text-neutral-500">
                                    <span className="text-caption">{t('channels.callNote')}</span>
                                </p>
                            )}
                            {c === 'WHATSAPP' && cfg.enabled && (
                                <p className="flex items-start gap-2 rounded-lg bg-warning-50 p-2 text-warning-700">
                                    <FileText size={14} className="mt-0.5 shrink-0" />
                                    <span className="text-caption">
                                        {t('channels.whatsappNote')}
                                    </span>
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const audienceStep = (
        <div className="flex flex-col gap-4">
            <StepLead>
                {t('audience.intro', {
                    batches: batchesLabel.toLowerCase(),
                    audiences: audiencesLabel.toLowerCase(),
                })}
            </StepLead>
            <StepSection icon={GraduationCap} title={batchesLabel}>
                <PackageSelector
                    instituteId={instituteId}
                    multiSelect
                    initialPackageSessionIds={batchIds}
                    onChange={({ packageSessionIds }) => setBatchIds(packageSessionIds ?? [])}
                />
            </StepSection>
            <StepSection
                icon={ListBullets}
                title={audiencesLabel}
                hint={t('audience.audiencesHint')}
            >
                <MultiSelect
                    options={campaignOptions}
                    selected={audienceIds}
                    onChange={setAudienceIds}
                    placeholder={t('audience.select', {
                        audiences: audiencesLabel.toLowerCase(),
                    })}
                />
            </StepSection>
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <span className="font-bold tabular-nums text-neutral-900">
                    <span className="text-h3">{audienceCount}</span>
                </span>
                <span className="text-neutral-500">
                    <span className="text-body">
                        {t('audience.count', { count: audienceCount })}
                    </span>
                </span>
            </div>
        </div>
    );

    const cadenceStep = (
        <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                    <MyInput
                        label={t('cadence.recheck')}
                        required
                        inputType="number"
                        inputPlaceholder="72"
                        input={cadenceHours}
                        onChangeFunction={(e) => setCadenceHours(e.target.value)}
                    />
                    <p className="text-caption text-neutral-500">{t('cadence.recheckHint')}</p>
                </div>
                <div>
                    <label className="mb-1 block text-subtitle font-regular">
                        {t('cadence.timezone')}
                    </label>
                    <SearchableSelect
                        options={TIMEZONE_OPTIONS.map((o: { label: string; value: string }) => ({
                            label: o.label,
                            value: o.value,
                        }))}
                        value={timezone}
                        onChange={setTimezone}
                    />
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-subtitle font-regular">{t('cadence.quietHours')}</label>
                <div className="flex flex-wrap items-end gap-3">
                    <HourSelect
                        label={t('cadence.from')}
                        value={quietStart}
                        onChange={setQuietStart}
                    />
                    <HourSelect label={t('cadence.to')} value={quietEnd} onChange={setQuietEnd} />
                </div>
                <div className="flex flex-col gap-1" aria-hidden>
                    <div className="flex gap-0.5">
                        {hours.map((h) => (
                            <span
                                key={h}
                                title={`${String(h).padStart(2, '0')}:00`}
                                className={cn(
                                    'h-6 flex-1 rounded-sm',
                                    isQuiet(h) ? 'bg-neutral-700' : 'bg-success-100'
                                )}
                            />
                        ))}
                    </div>
                    <div className="flex gap-0.5 text-neutral-400">
                        {hours.map((h) => (
                            <span key={h} className="flex-1">
                                <span className="text-caption">{h % 3 === 0 ? h : ''}</span>
                            </span>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-neutral-500">
                        <span className="flex items-center gap-1.5">
                            <span className="size-3 rounded-sm bg-neutral-700" />
                            <span className="text-caption">{t('cadence.legendQuiet')}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="size-3 rounded-sm bg-success-100" />
                            <span className="text-caption">{t('cadence.legendOpen')}</span>
                        </span>
                    </div>
                </div>
                <p className="text-caption text-neutral-500">{t('cadence.quietHint')}</p>
            </div>

            <StepSection icon={ShieldCheck} title={t('autonomy.title')} hint={t('autonomy.hint')}>
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <MyInput
                            label={t('autonomy.firstN')}
                            inputType="number"
                            inputPlaceholder={t('autonomy.firstNPlaceholder')}
                            input={firstN}
                            onChangeFunction={(e) => setFirstN(e.target.value)}
                        />
                        <p className="text-caption text-neutral-500">{t('autonomy.firstNHint')}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                        <MyInput
                            label={t('autonomy.holdout')}
                            inputType="number"
                            inputPlaceholder="0"
                            input={holdoutPct}
                            onChangeFunction={(e) => {
                                const v = e.target.value;
                                // Keep the field inside 0..100 so what's shown always matches what's sent.
                                if (v === '') return setHoldoutPct('');
                                const n = Number(v);
                                if (Number.isNaN(n)) return;
                                setHoldoutPct(String(Math.max(0, Math.min(100, n))));
                            }}
                        />
                        <p className="text-caption text-neutral-500">{t('autonomy.holdoutHint')}</p>
                    </div>
                </div>
            </StepSection>
        </div>
    );

    const reviewStep = (
        <div className="flex flex-col gap-4">
            <div className="grid gap-6 lg:grid-cols-5">
                <div className="lg:col-span-3">
                    <KeyValue label={t('review.name')}>
                        <b>{name}</b>
                    </KeyValue>
                    <KeyValue label={t('review.objective')}>{objective || '—'}</KeyValue>
                    <KeyValue label={t('review.language')}>
                        {languageOptions.find((l) => l.value === language)?.label ?? language}
                    </KeyValue>
                    <KeyValue label={t('review.dataPoints')}>
                        <span className="flex flex-wrap items-center gap-1.5">
                            <span>
                                {dataPoints.length
                                    ? dataPoints.map(dataPointLabel).join(', ')
                                    : t('review.dataPointsNone')}
                            </span>
                            {highSelected && consentHigh && (
                                <Chip
                                    icon={ShieldCheck}
                                    label={t('review.consentGiven')}
                                    className={SENSITIVITY_TINT.HIGH}
                                />
                            )}
                        </span>
                    </KeyValue>
                    <KeyValue label={t('review.channels')}>
                        <span className="flex flex-wrap gap-1.5">
                            {enabledChannelKeys.map((c) => (
                                <ChannelChip key={c} channel={c} label={channelMeta[c].label} />
                            ))}
                        </span>
                    </KeyValue>
                    <KeyValue label={t('review.audienceSources')}>{`${audienceCount}`}</KeyValue>
                    <KeyValue label={t('review.cadence')}>
                        {t('review.cadenceValue', { hours: cadenceHours })}
                    </KeyValue>
                    <KeyValue label={t('review.quietHours')}>
                        {`${quietStart}:00–${quietEnd}:00 ${timezone}`}
                    </KeyValue>
                    <KeyValue label={t('review.autoSendChannels')}>
                        {autoSendKeys.map((c) => channelMeta[c].label).join(', ') ||
                            t('review.autoSendNone')}
                    </KeyValue>
                    <KeyValue label={t('review.holdout')}>{`${holdoutValue}%`}</KeyValue>
                </div>
                <div className="lg:col-span-2">
                    <p className="mb-3 font-semibold uppercase tracking-wide text-neutral-500">
                        <span className="text-caption">{t('review.whatNext')}</span>
                    </p>
                    <ol className="flex flex-col">
                        {nextSteps.map((s, i) => (
                            <li key={s.key} className="flex gap-3">
                                <span className="flex flex-col items-center">
                                    <IconTile icon={s.icon} size="sm" tint={s.tint} />
                                    {i < nextSteps.length - 1 && (
                                        <span className="my-1 w-px flex-1 bg-neutral-200" />
                                    )}
                                </span>
                                <span className="flex min-w-0 flex-col pb-4">
                                    <span className="font-semibold text-neutral-800">
                                        <span className="text-body">
                                            {t(`review.next.${s.key}.title`)}
                                        </span>
                                    </span>
                                    <span className="text-neutral-500">
                                        <span className="text-caption">
                                            {t(`review.next.${s.key}.text`)}
                                        </span>
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-info-200 bg-info-50 p-3">
                <Info className="mt-0.5 size-4 shrink-0 text-info-600" />
                <p className="text-caption text-neutral-600">{t('review.draftNote')}</p>
            </div>
        </div>
    );

    const stepBodies = [
        basicsStep,
        dataPointsStep,
        channelsStep,
        audienceStep,
        cadenceStep,
        reviewStep,
    ];

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <div className="flex items-start gap-3">
                    <IconTile icon={Robot} size="lg" />
                    <div>
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h2">{t('pageTitle')}</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-body">{t('subtitle')}</span>
                        </p>
                    </div>
                </div>
                <Card className="flex flex-col overflow-hidden rounded-xl border-neutral-200 shadow-sm lg:flex-row">
                    <StepRail current={step} t={t} onGoTo={setStep} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex-1 p-5">{stepBodies[step]}</div>
                        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
                            <span className="me-auto text-neutral-500">
                                <span className="text-caption">
                                    {t('footer.step', {
                                        n: step + 1,
                                        total: STEP_KEYS.length,
                                        label: t(`steps.${STEP_KEYS[step]}`),
                                    })}
                                </span>
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="medium"
                                onClick={() => navigate({ to: '/engagement-engines' })}
                            >
                                {t('actions.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                disable={step === 0}
                                onClick={() => setStep((s) => Math.max(0, s - 1))}
                            >
                                {t('actions.back')}
                            </MyButton>
                            {step < STEP_KEYS.length - 1 ? (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    disable={!canProceed(step)}
                                    onClick={() => setStep((s) => s + 1)}
                                >
                                    {t('actions.continue')}
                                </MyButton>
                            ) : (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    disable={createEngine.isPending}
                                    onClick={submit}
                                >
                                    {createEngine.isPending
                                        ? t('actions.creating')
                                        : t('actions.create')}
                                </MyButton>
                            )}
                        </div>
                    </div>
                </Card>
            </div>
        </LayoutContainer>
    );
}

function HourSelect({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="w-28">
            <label className="mb-1 block text-caption text-neutral-500">{label}</label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                            {String(h).padStart(2, '0')}:00
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
