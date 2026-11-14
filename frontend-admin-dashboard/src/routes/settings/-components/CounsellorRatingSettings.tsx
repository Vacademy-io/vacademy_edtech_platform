import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { COUNSELLOR_RATING_RECOMPUTE } from '@/constants/urls';
import { cn } from '@/lib/utils';
import {
    fetchWorkbenchConfig,
    updateWorkbenchConfig,
    type WorkbenchConfig,
} from '@/routes/counsellors/-services/counsellor-workbench-services';

/**
 * Plain-English rating-strategy editor. Hides the raw "window / weight /
 * velocity" jargon behind sentences and presets; "Advanced" still exposes
 * every knob for power admins.
 *
 * Persists into LEAD_SETTING.workbench.rating via the
 * /counsellor-workbench/config endpoint — no dedicated table.
 */
export function CounsellorRatingSettings() {
    const { t } = useTranslation('settingsCounsellorRating');
    const instituteId = getInstituteId();
    const [draft, setDraft] = useState<WorkbenchConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [recomputing, setRecomputing] = useState(false);
    const [advanced, setAdvanced] = useState(false);

    const query = useQuery({
        queryKey: ['workbench-config', instituteId],
        enabled: !!instituteId,
        queryFn: () => fetchWorkbenchConfig(instituteId!),
    });

    useEffect(() => {
        if (query.data) setDraft({ ...query.data });
    }, [query.data]);

    const presets = useMemo(() => buildPresets(t), [t]);

    if (!draft) {
        return (
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
                <h3 className="text-h4 font-medium text-neutral-900">{t('header.title')}</h3>
                <p className="text-subtitle text-neutral-500">{t('loading')}</p>
            </section>
        );
    }

    async function handleSave() {
        if (!draft) return;
        setSaving(true);
        try {
            await updateWorkbenchConfig({ ...draft });
            toast.success(t('toasts.saved'));
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toasts.saveFailed'));
        } finally {
            setSaving(false);
        }
    }

    async function handleRecompute() {
        if (!instituteId) return;
        setRecomputing(true);
        try {
            const { data } = await authenticatedAxiosInstance.post<{ affected: number }>(
                COUNSELLOR_RATING_RECOMPUTE(instituteId)
            );
            toast.success(t('toasts.recomputed', { count: data.affected }));
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toasts.recomputeFailed'));
        } finally {
            setRecomputing(false);
        }
    }

    const isAutomatic = (draft.strategy_type ?? 'STRATEGY_BASED') === 'STRATEGY_BASED';
    // Slider position 0..100 → conversion-weight 0..1. We mirror this onto
    // velocity-weight (= 1 - conversion) so the two always sum to 1.
    const closingPct = Math.round((draft.w_conversion ?? 0.6) * 100);

    function applyPreset(p: Preset) {
        setDraft({
            ...draft!,
            strategy_type: 'STRATEGY_BASED',
            window_days: p.windowDays,
            min_sample_size: p.minSample,
            w_conversion: p.wConversion,
            w_velocity: 1 - p.wConversion,
            ideal_velocity_hours: p.idealHours,
            worst_velocity_hours: p.worstHours,
        });
    }

    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-h4 font-medium text-neutral-900">
                        {t('header.title')}
                    </h3>
                    <p className="text-caption text-neutral-500">
                        {t('header.subtitle')}
                    </p>
                </div>
                <MyButton buttonType="secondary" onClick={handleRecompute} disable={recomputing}>
                    {recomputing ? t('actions.refreshing') : t('actions.refreshScores')}
                </MyButton>
            </div>

            {/* ── Strategy choice as natural-language radios ────────── */}
            <div className="mb-4 space-y-2">
                <RadioRow
                    selected={isAutomatic}
                    onSelect={() => setDraft({ ...draft, strategy_type: 'STRATEGY_BASED' })}
                    title={t('strategy.automatic.title')}
                    description={t('strategy.automatic.description')}
                />
                <RadioRow
                    selected={!isAutomatic}
                    onSelect={() => setDraft({ ...draft, strategy_type: 'STATIC' })}
                    title={t('strategy.manual.title')}
                    description={t('strategy.manual.description')}
                />
            </div>

            {isAutomatic && (
                <>
                    {/* ── Presets ───────────────────────────────────── */}
                    <div className="mb-4">
                        <div className="mb-2 text-caption font-medium text-neutral-700">
                            {t('presets.heading')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {presets.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => applyPreset(p)}
                                    className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-caption font-medium text-neutral-700 hover:border-primary-200 hover:bg-primary-50"
                                    title={p.description}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ── Sentence-style controls ───────────────────── */}
                    <div className="space-y-4 rounded-md border border-neutral-100 bg-neutral-50 p-3">
                        <SentenceField label={t('fields.startingScore.label')}>
                            <NumberInline
                                value={draft.starting_rating ?? 0}
                                min={0}
                                max={100}
                                onChange={(v) => setDraft({ ...draft, starting_rating: v })}
                            />
                        </SentenceField>

                        <SentenceField label={t('fields.windowDays.label')}>
                            <NumberInline
                                value={draft.window_days ?? 90}
                                min={1}
                                max={365}
                                onChange={(v) => setDraft({ ...draft, window_days: v })}
                            />
                            <span className="text-body text-neutral-700">
                                {t('fields.windowDays.suffix')}
                            </span>
                        </SentenceField>

                        <SentenceField label={t('fields.minSample.label')}>
                            <NumberInline
                                value={draft.min_sample_size ?? 5}
                                min={1}
                                max={50}
                                onChange={(v) => setDraft({ ...draft, min_sample_size: v })}
                            />
                            <span className="text-body text-neutral-700">
                                {t('fields.minSample.suffix')}
                            </span>
                        </SentenceField>

                        <BalanceSlider
                            value={closingPct}
                            onChange={(pct) =>
                                setDraft({
                                    ...draft,
                                    w_conversion: pct / 100,
                                    w_velocity: 1 - pct / 100,
                                })
                            }
                        />

                        <div className="space-y-1">
                            <div className="text-caption font-medium text-neutral-700">
                                {t('fields.fastHeading')}
                            </div>
                            <SentenceField label={t('fields.idealVelocity.label')}>
                                <NumberInline
                                    value={draft.ideal_velocity_hours ?? 24}
                                    min={1}
                                    max={168}
                                    onChange={(v) => setDraft({ ...draft, ideal_velocity_hours: v })}
                                />
                                <span className="text-body text-neutral-700">
                                    {t('fields.idealVelocity.suffix')}
                                </span>
                            </SentenceField>
                            <SentenceField label={t('fields.worstVelocity.label')}>
                                <NumberInline
                                    value={
                                        Math.round((draft.worst_velocity_hours ?? 720) / 24)
                                    }
                                    min={1}
                                    max={120}
                                    onChange={(days) =>
                                        setDraft({ ...draft, worst_velocity_hours: days * 24 })
                                    }
                                />
                                <span className="text-body text-neutral-700">
                                    {t('fields.worstVelocity.suffix')}
                                </span>
                            </SentenceField>
                        </div>

                        <button
                            type="button"
                            className="text-caption font-medium text-primary-600 hover:underline"
                            onClick={() => setAdvanced((v) => !v)}
                        >
                            {advanced ? t('actions.hideAdvanced') : t('actions.showAdvanced')}
                        </button>

                        {advanced && (
                            <div className="grid grid-cols-2 gap-3 rounded-md border border-neutral-200 bg-white p-3">
                                <AdvancedNum
                                    label={t('advanced.wConversion')}
                                    value={draft.w_conversion ?? 0.6}
                                    step={0.05}
                                    onChange={(v) =>
                                        setDraft({
                                            ...draft,
                                            w_conversion: v,
                                            w_velocity: 1 - v,
                                        })
                                    }
                                />
                                <AdvancedNum
                                    label={t('advanced.wVelocity')}
                                    value={draft.w_velocity ?? 0.4}
                                    step={0.05}
                                    onChange={(v) =>
                                        setDraft({
                                            ...draft,
                                            w_velocity: v,
                                            w_conversion: 1 - v,
                                        })
                                    }
                                />
                                <AdvancedNum
                                    label={t('advanced.idealVelocityHours')}
                                    value={draft.ideal_velocity_hours ?? 24}
                                    onChange={(v) =>
                                        setDraft({ ...draft, ideal_velocity_hours: v })
                                    }
                                />
                                <AdvancedNum
                                    label={t('advanced.worstVelocityHours')}
                                    value={draft.worst_velocity_hours ?? 720}
                                    onChange={(v) =>
                                        setDraft({ ...draft, worst_velocity_hours: v })
                                    }
                                />
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="mt-4 flex justify-end">
                <MyButton buttonType="primary" onClick={handleSave} disable={saving}>
                    {saving ? t('actions.saving') : t('actions.save')}
                </MyButton>
            </div>
        </section>
    );
}

// ─── Subcomponents ────────────────────────────────────────────

function RadioRow({
    selected,
    onSelect,
    title,
    description,
}: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    description: string;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                selected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 bg-white hover:border-primary-200 hover:bg-neutral-50'
            )}
        >
            <span
                className={cn(
                    'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary-500' : 'border-neutral-300'
                )}
            >
                {selected && <span className="size-2 rounded-full bg-primary-500" />}
            </span>
            <span className="flex-1">
                <span className="block text-body font-medium text-neutral-900">{title}</span>
                <span className="block text-caption text-neutral-500">{description}</span>
            </span>
        </button>
    );
}

function SentenceField({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-neutral-700">{label}</span>
            {children}
        </div>
    );
}

function NumberInline({
    value,
    min,
    max,
    onChange,
}: {
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
}) {
    return (
        <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-center text-body"
        />
    );
}

function BalanceSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (closingPct: number) => void;
}) {
    const { t } = useTranslation('settingsCounsellorRating');
    const closing = value;
    const speed = 100 - value;
    return (
        <div className="space-y-2">
            <div className="text-caption font-medium text-neutral-700">
                {t('balance.heading')}
            </div>
            <div className="flex items-center gap-3">
                <span className="text-caption text-neutral-500">{t('balance.closing')}</span>
                <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={value}
                    onChange={(e) => onChange(parseInt(e.target.value, 10))}
                    className="flex-1 accent-primary-500"
                    aria-label={t('balance.ariaLabel')}
                />
                <span className="text-caption text-neutral-500">{t('balance.speed')}</span>
            </div>
            <div className="text-center text-caption text-neutral-500">
                <span className="font-semibold text-neutral-700">{closing}%</span>{' '}
                {t('balance.closingLower')} ·{' '}
                <span className="font-semibold text-neutral-700">{speed}%</span>{' '}
                {t('balance.speedLower')}
            </div>
        </div>
    );
}

function AdvancedNum({
    label,
    value,
    step = 1,
    onChange,
}: {
    label: string;
    value: number;
    step?: number;
    onChange: (v: number) => void;
}) {
    return (
        <div>
            <label className="mb-1 block text-caption text-neutral-500">{label}</label>
            <input
                type="number"
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full rounded border border-neutral-300 px-2 py-1.5 text-body"
            />
        </div>
    );
}

// ─── Presets ──────────────────────────────────────────────────

interface Preset {
    id: string;
    label: string;
    description: string;
    windowDays: number;
    minSample: number;
    wConversion: number;
    idealHours: number;
    worstHours: number;
}

function buildPresets(t: TFunction): Preset[] {
    return [
        {
            id: 'balanced',
            label: t('presets.balanced.label'),
            description: t('presets.balanced.description'),
            windowDays: 90,
            minSample: 5,
            wConversion: 0.5,
            idealHours: 24,
            worstHours: 720,
        },
        {
            id: 'closers',
            label: t('presets.closers.label'),
            description: t('presets.closers.description'),
            windowDays: 90,
            minSample: 5,
            wConversion: 0.75,
            idealHours: 24,
            worstHours: 720,
        },
        {
            id: 'fast',
            label: t('presets.fast.label'),
            description: t('presets.fast.description'),
            windowDays: 60,
            minSample: 3,
            wConversion: 0.3,
            idealHours: 12,
            worstHours: 240,
        },
    ];
}
