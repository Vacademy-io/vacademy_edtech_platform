import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EnvelopeSimple, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import {
    AsyncSearchableSelect,
    type LoadOptionsResult,
} from '@/components/design-system/async-searchable-select';
import { fetchPaginatedBatches } from '@/routes/admin-package-management/-services/package-service';
import { batchLabel } from '@/routes/engagement/-components/BatchPickerDialog';
import { useBatchInfo } from '@/routes/engagement/-components/list/PlanListToolbar';
import {
    getPlanningRequests,
    sendPlanningEmailsNow,
    type PlanningRequestStatus,
} from '@/routes/engagement/-services/engagement-service';
import {
    normalizePlanningNudge,
    savePlanningNudge,
    type LoadedEngagementSettings,
    type PlanningNudge,
    type PlanningRunDays,
} from '../-services/engagement-settings';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const REMINDERS = [0, 12, 24, 48];
const RUN_DAYS: PlanningRunDays[] = ['MON_FRI', 'MON_SAT', 'ALL'];
const TASKS = [1, 2, 3, 4, 5];

const STATUS_TONE: Record<PlanningRequestStatus, string> = {
    SENT: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    SUBMITTED: 'border-primary-200 bg-primary-50 text-primary-500',
    DRAFTING: 'border-primary-200 bg-primary-50 text-primary-500',
    DRAFTED: 'border-success-200 bg-success-50 text-success-700',
    PUBLISHED: 'border-success-200 bg-success-50 text-success-700',
    FAILED: 'border-danger-200 bg-danger-50 text-danger-700',
    EXPIRED: 'border-neutral-200 bg-neutral-50 text-neutral-500',
};

function hourLabel(h: number, lang: string): string {
    return new Date(2000, 0, 1, h).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(isoDay: number, lang: string): string {
    // 3 Jan 2000 was a Monday.
    return new Date(2000, 0, 2 + isoDay).toLocaleDateString(lang, { weekday: 'long' });
}

/**
 * Settings → Daily Engagement → Weekly planning email. Saved separately from the cards
 * above (it writes the same ENGAGEMENT_SETTING blob, keeping every other key).
 */
export function PlanningEmailSettings({ loaded }: { loaded: LoadedEngagementSettings }) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.resolvedLanguage || i18n.language || 'en';
    const queryClient = useQueryClient();
    const saved = normalizePlanningNudge(loaded.extra.planningNudge);
    const [form, setForm] = useState<PlanningNudge>(saved);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        setForm(normalizePlanningNudge(loaded.extra.planningNudge));
        setDirty(false);
    }, [loaded]);

    const patch = (p: Partial<PlanningNudge>) => {
        setForm((f) => ({ ...f, ...p }));
        setDirty(true);
    };

    const save = useMutation({
        mutationFn: () => savePlanningNudge(loaded, form),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['engagement-settings'] });
            setDirty(false);
            toast.success(t('settings.saved'));
        },
        onError: () => toast.error(t('settings.saveError')),
    });

    const requests = useQuery({
        queryKey: ['engagement-planning-requests'],
        queryFn: getPlanningRequests,
        staleTime: 30_000,
    });

    const sendNow = useMutation({
        mutationFn: () => sendPlanningEmailsNow(),
        onSuccess: (r) => {
            toast.success(
                t('planningEmail.sendResult', {
                    count: r.sent,
                    asked: r.alreadyAsked,
                    planned: r.alreadyPlanned,
                })
            );
            void queryClient.invalidateQueries({ queryKey: ['engagement-planning-requests'] });
        },
        onError: () => toast.error(t('planningEmail.sendError')),
    });

    const fallback = t('batchPicker.courseFallback');
    const loadBatches = useCallback(
        async (query: string, page: number): Promise<LoadOptionsResult> => {
            const response = await fetchPaginatedBatches({
                page,
                size: 20,
                statuses: ['ACTIVE'],
                sortBy: 'package_name',
                sortDirection: 'ASC',
                ...(query ? { search: query } : {}),
            });
            return {
                options: (response.content ?? []).map((batch) => ({
                    value: batch.id,
                    label: batchLabel(batch, fallback),
                })),
                hasMore: Boolean(response.has_next),
            };
        },
        [fallback]
    );

    const rows = requests.data?.rows ?? [];
    const answered = rows.filter((r) => r.status !== 'SENT' && r.status !== 'EXPIRED').length;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <EnvelopeSimple size={18} aria-hidden /> {t('planningEmail.title')}
                    </CardTitle>
                    <CardDescription>{t('planningEmail.hint')}</CardDescription>
                </div>
                <MyButton
                    type="button"
                    scale="small"
                    disable={!dirty || save.isPending}
                    onClick={() => save.mutate()}
                >
                    {save.isPending ? t('settings.saving') : t('settings.save')}
                </MyButton>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex items-center gap-3">
                    <Switch
                        id="plan-email-on"
                        checked={form.enabled}
                        onCheckedChange={(v) => patch({ enabled: v })}
                    />
                    <Label htmlFor="plan-email-on">{t('planningEmail.enabled')}</Label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('planningEmail.sendDay')}>
                        <Select
                            value={String(form.sendDay)}
                            onValueChange={(v) => patch({ sendDay: Number(v) })}
                        >
                            <SelectTrigger aria-label={t('planningEmail.sendDay')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DAYS.map((d) => (
                                    <SelectItem key={d} value={String(d)}>
                                        {dayLabel(d, lang)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('planningEmail.sendHour')}>
                        <Select
                            value={String(form.sendHour)}
                            onValueChange={(v) => patch({ sendHour: Number(v) })}
                        >
                            <SelectTrigger aria-label={t('planningEmail.sendHour')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {HOURS.map((h) => (
                                    <SelectItem key={h} value={String(h)}>
                                        {hourLabel(h, lang)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('planningEmail.reminder')}>
                        <Select
                            value={String(form.reminderHours)}
                            onValueChange={(v) => patch({ reminderHours: Number(v) })}
                        >
                            <SelectTrigger aria-label={t('planningEmail.reminder')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(REMINDERS.includes(form.reminderHours)
                                    ? REMINDERS
                                    : [...REMINDERS, form.reminderHours]
                                ).map((h) => (
                                    <SelectItem key={h} value={String(h)}>
                                        {h === 0
                                            ? t('planningEmail.noReminder')
                                            : t('planningEmail.reminderAfter', { count: h })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('planningEmail.runDays')}>
                        <Select
                            value={form.runDays}
                            onValueChange={(v) => patch({ runDays: v as PlanningRunDays })}
                        >
                            <SelectTrigger aria-label={t('planningEmail.runDays')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {RUN_DAYS.map((d) => (
                                    <SelectItem key={d} value={d}>
                                        {t(`planningEmail.run.${d}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label={t('planningEmail.tasksPerDay')}>
                        <Select
                            value={String(form.tasksPerDay)}
                            onValueChange={(v) => patch({ tasksPerDay: Number(v) })}
                        >
                            <SelectTrigger aria-label={t('planningEmail.tasksPerDay')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TASKS.map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>

                <div className="flex items-start gap-3">
                    <Switch
                        id="plan-email-auto"
                        checked={form.autoPublish}
                        onCheckedChange={(v) => patch({ autoPublish: v })}
                        aria-describedby="plan-email-auto-hint"
                    />
                    <div>
                        <Label htmlFor="plan-email-auto">{t('planningEmail.autoPublish')}</Label>
                        <p id="plan-email-auto-hint" className="text-xs text-neutral-500">
                            {t('planningEmail.autoPublishHint')}
                        </p>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>{t('planningEmail.batches')}</Label>
                    <p className="text-xs text-neutral-500">
                        {form.packageSessionIds.length === 0
                            ? t('planningEmail.allBatches')
                            : t('planningEmail.someBatches', {
                                  count: form.packageSessionIds.length,
                              })}
                    </p>
                    {form.packageSessionIds.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                            {form.packageSessionIds.map((id) => (
                                <BatchChip
                                    key={id}
                                    id={id}
                                    onRemove={() =>
                                        patch({
                                            packageSessionIds: form.packageSessionIds.filter(
                                                (x) => x !== id
                                            ),
                                        })
                                    }
                                />
                            ))}
                        </ul>
                    )}
                    <div className="w-full sm:w-72">
                        <AsyncSearchableSelect
                            value=""
                            onChange={(value) => {
                                if (value && !form.packageSessionIds.includes(value)) {
                                    patch({
                                        packageSessionIds: [...form.packageSessionIds, value],
                                    });
                                }
                            }}
                            loadOptions={loadBatches}
                            placeholder={t('planningEmail.addBatch')}
                            searchPlaceholder={t('batchPicker.search')}
                            emptyText={t('batchPicker.noMatch')}
                            triggerClassName="h-9 border-neutral-300 text-body text-neutral-600"
                        />
                    </div>
                </div>

                <div className="space-y-3 border-t border-neutral-200 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-sm font-semibold text-neutral-900">
                                {t('planningEmail.weekTitle', {
                                    week: requests.data?.weekStart ?? '',
                                })}
                            </h3>
                            <p className="text-xs text-neutral-500">
                                {t('planningEmail.weekSummary', {
                                    count: rows.length,
                                    answered,
                                })}
                            </p>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={sendNow.isPending || dirty}
                            onClick={() => sendNow.mutate()}
                            title={dirty ? t('planningEmail.saveFirst') : undefined}
                        >
                            <PaperPlaneTilt size={16} aria-hidden />
                            {sendNow.isPending
                                ? t('planningEmail.sending')
                                : t('planningEmail.sendNow')}
                        </MyButton>
                    </div>
                    {rows.length > 0 && (
                        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                            {rows.map((r) => (
                                <li
                                    key={r.id}
                                    className="flex flex-wrap items-start gap-2 p-3 text-sm"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium text-neutral-900">
                                            {r.teacherName || t('planningEmail.unknownTeacher')}
                                            <span className="font-normal text-neutral-500">
                                                {' · '}
                                                {r.batchLabel || t('list.unknownBatch')}
                                            </span>
                                        </p>
                                        {r.topic && (
                                            <p className="line-clamp-2 text-xs text-neutral-600">
                                                {r.topic}
                                            </p>
                                        )}
                                        {r.status === 'FAILED' && r.error && (
                                            <p className="text-xs text-danger-600">{r.error}</p>
                                        )}
                                    </div>
                                    <Badge variant="outline" className={STATUS_TONE[r.status]}>
                                        {t(`planningEmail.status.${r.status}`)}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <span className="text-sm font-medium text-neutral-900">{label}</span>
            {children}
        </div>
    );
}

function BatchChip({ id, onRemove }: { id: string; onRemove: () => void }) {
    const { t } = useTranslation('engagement');
    const info = useBatchInfo(id);
    return (
        <li className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary-200 bg-primary-50 py-1 pe-1 ps-2 text-xs text-neutral-900">
            <span className="truncate">{info?.label || t('list.unknownBatch')}</span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={t('planningEmail.removeBatch')}
                className="flex size-6 items-center justify-center rounded text-neutral-600 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
                <X size={12} aria-hidden />
            </button>
        </li>
    );
}
