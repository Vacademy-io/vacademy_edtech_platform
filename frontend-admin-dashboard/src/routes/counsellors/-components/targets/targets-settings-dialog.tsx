import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Target, Users } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import {
    buildTargetMetricLabel,
    bulkApplyTargets,
    fetchTargetProgress,
    TARGET_METRICS,
    upsertCounsellorTarget,
    type TargetMetric,
    type TargetPeriodType,
} from '../../-services/counsellor-target-services';

interface DialogCounsellor {
    user_id: string;
    full_name: string | null;
}

const buildPeriods = (t: TFunction): { key: TargetPeriodType; label: string }[] => [
    { key: 'WEEK', label: t('periods.week') },
    { key: 'MONTH', label: t('periods.month') },
    { key: 'CUSTOM', label: t('periods.custom') },
];

/**
 * Set per-counsellor targets for a chosen metric + timeline. Supports a
 * one-shot "apply to everyone" (bulk) plus per-person overrides. Prefills the
 * current values from the same progress endpoint the dashboard uses.
 */
export function TargetsSettingsDialog({
    open,
    onOpenChange,
    instituteId,
    counsellors,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    counsellors: DialogCounsellor[];
    onSaved: () => void;
}) {
    const { t } = useTranslation('counsellorsTargetsSettingsDialog');
    const { t: tMetrics } = useTranslation('counsellorsTargetMetrics');
    const metricLabel = buildTargetMetricLabel(tMetrics);
    const queryClient = useQueryClient();
    const [metric, setMetric] = useState<TargetMetric>('CONVERSIONS');
    const [periodType, setPeriodType] = useState<TargetPeriodType>('MONTH');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [bulkValue, setBulkValue] = useState('');
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const ids = useMemo(() => counsellors.map((c) => c.user_id), [counsellors]);
    const customIncomplete = periodType === 'CUSTOM' && (!from || !to);

    // Prefill the current target for the selected metric+period, batched.
    const prefillQuery = useQuery({
        queryKey: ['target-prefill', instituteId, metric, periodType, from, to, ids],
        enabled: open && !!instituteId && ids.length > 0 && !customIncomplete,
        staleTime: 0,
        queryFn: () =>
            fetchTargetProgress({
                institute_id: instituteId,
                counsellor_user_ids: ids,
                period_type: periodType,
                from_date: from || undefined,
                to_date: to || undefined,
            }),
    });

    // Map the prefill (target values only) into the editable draft whenever the
    // selection changes. Rows with no configured target start blank.
    const initialByUser = useMemo(() => {
        const map: Record<string, number> = {};
        for (const row of prefillQuery.data?.rows ?? []) {
            const item = row.items.find((i) => i.metric === metric && i.target_value != null);
            if (item?.target_value != null) map[row.counsellor_user_id] = item.target_value;
        }
        return map;
    }, [prefillQuery.data, metric]);

    useEffect(() => {
        const next: Record<string, string> = {};
        for (const id of ids) {
            next[id] = initialByUser[id] != null ? String(initialByUser[id]) : '';
        }
        setDraft(next);
    }, [initialByUser, ids]);

    const rangePayload = () =>
        periodType === 'CUSTOM' ? { period_start: from, period_end: to } : {};

    async function handleApplyToAll() {
        const val = Number(bulkValue);
        if (!Number.isFinite(val) || val < 0) {
            toast.error(t('toast.invalidBulkValue'));
            return;
        }
        if (customIncomplete) {
            toast.error(t('toast.pickDateRange'));
            return;
        }
        setSaving(true);
        try {
            await bulkApplyTargets({
                institute_id: instituteId,
                counsellor_user_ids: ids,
                metric,
                period_type: periodType,
                target_value: val,
                ...rangePayload(),
            });
            setDraft(Object.fromEntries(ids.map((id) => [id, String(val)])));
            await queryClient.invalidateQueries({ queryKey: ['target-prefill'] });
            onSaved();
            toast.success(t('toast.appliedSuccess', { count: ids.length }));
        } catch (e) {
            toast.error(errMsg(e) ?? t('toast.applyError'));
        } finally {
            setSaving(false);
        }
    }

    async function handleSave() {
        if (customIncomplete) {
            toast.error(t('toast.pickDateRange'));
            return;
        }
        // Only persist rows that changed to a valid number.
        const changed = ids.filter((id) => {
            const raw = draft[id];
            if (raw == null || raw.trim() === '') return false;
            const num = Number(raw);
            if (!Number.isFinite(num) || num < 0) return false;
            return num !== initialByUser[id];
        });
        if (changed.length === 0) {
            toast.info(t('toast.noChanges'));
            return;
        }
        setSaving(true);
        try {
            await Promise.all(
                changed.map((id) =>
                    upsertCounsellorTarget({
                        institute_id: instituteId,
                        counsellor_user_id: id,
                        metric,
                        period_type: periodType,
                        target_value: Number(draft[id]),
                        ...rangePayload(),
                    })
                )
            );
            await queryClient.invalidateQueries({ queryKey: ['target-prefill'] });
            onSaved();
            toast.success(t('toast.savedSuccess', { count: changed.length }));
        } catch (e) {
            toast.error(errMsg(e) ?? t('toast.saveError'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-screen w-full flex-col gap-0 p-0 sm:max-w-2xl">
                <DialogHeader className="border-b border-neutral-200 px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-h4">
                        <Target size={18} className="text-primary-500" /> {t('title')}
                    </DialogTitle>
                </DialogHeader>

                {/* Metric + period controls */}
                <div className="flex flex-wrap items-end gap-3 border-b border-neutral-100 px-5 py-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-caption text-neutral-500">{t('metric')}</span>
                        <Select value={metric} onValueChange={(v) => setMetric(v as TargetMetric)}>
                            <SelectTrigger className="h-9 w-44 bg-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TARGET_METRICS.map((m) => (
                                    <SelectItem key={m} value={m}>
                                        {metricLabel[m]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-caption text-neutral-500">{t('timeline')}</span>
                        <Select
                            value={periodType}
                            onValueChange={(v) => setPeriodType(v as TargetPeriodType)}
                        >
                            <SelectTrigger className="h-9 w-52 bg-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {buildPeriods(t).map((p) => (
                                    <SelectItem key={p.key} value={p.key}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                    {periodType === 'CUSTOM' && (
                        <div className="flex items-end gap-1.5">
                            <label className="flex flex-col gap-1">
                                <span className="text-caption text-neutral-500">{t('from')}</span>
                                <input
                                    type="date"
                                    value={from}
                                    onChange={(e) => setFrom(e.target.value)}
                                    className="h-9 rounded-md border border-neutral-300 px-2 text-caption"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-caption text-neutral-500">{t('to')}</span>
                                <input
                                    type="date"
                                    value={to}
                                    onChange={(e) => setTo(e.target.value)}
                                    className="h-9 rounded-md border border-neutral-300 px-2 text-caption"
                                />
                            </label>
                        </div>
                    )}
                </div>

                {/* Bulk apply */}
                <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-5 py-3">
                    <Users size={16} className="text-neutral-400" />
                    <span className="text-caption text-neutral-600">
                        {t('applyToAll.label', { count: ids.length })}
                    </span>
                    <input
                        type="number"
                        min={0}
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        placeholder={t('applyToAll.placeholder')}
                        className="h-9 w-24 rounded-md border border-neutral-300 px-2 text-body"
                    />
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={saving || customIncomplete || bulkValue.trim() === ''}
                        onClick={handleApplyToAll}
                    >
                        {t('applyToAll.button')}
                    </MyButton>
                </div>

                {/* Per-counsellor overrides */}
                <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
                    {customIncomplete ? (
                        <div className="py-8 text-center text-subtitle text-neutral-400">
                            {t('list.customIncomplete')}
                        </div>
                    ) : prefillQuery.isLoading ? (
                        <div className="py-8 text-center text-subtitle text-neutral-400">
                            {t('list.loading')}
                        </div>
                    ) : counsellors.length === 0 ? (
                        <div className="py-8 text-center text-subtitle text-neutral-400">
                            {t('list.empty')}
                        </div>
                    ) : (
                        <ul className="flex flex-col divide-y divide-neutral-100">
                            {counsellors.map((c) => (
                                <li
                                    key={c.user_id}
                                    className="flex items-center justify-between gap-3 py-2"
                                >
                                    <span className="truncate text-body text-neutral-800">
                                        {c.full_name || t('list.unnamed')}
                                    </span>
                                    <input
                                        type="number"
                                        min={0}
                                        value={draft[c.user_id] ?? ''}
                                        onChange={(e) =>
                                            setDraft((d) => ({ ...d, [c.user_id]: e.target.value }))
                                        }
                                        placeholder={t('list.noValuePlaceholder')}
                                        className="h-9 w-24 rounded-md border border-neutral-300 px-2 text-end text-body"
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter className="border-t border-neutral-200 px-5 py-3">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('footer.close')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={saving || customIncomplete}
                        onClick={handleSave}
                    >
                        {saving ? t('footer.saving') : t('footer.save')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function errMsg(e: unknown): string | undefined {
    return (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
}
