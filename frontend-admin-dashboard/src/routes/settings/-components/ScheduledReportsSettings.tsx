import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SettingsPageShell, SettingToggleRow } from '@/components/settings/shell';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { MyInput } from '@/components/design-system/input';
import { MyTable } from '@/components/design-system/table';
import { MyDialog } from '@/components/design-system/dialog';
import type { ColumnDef } from '@tanstack/react-table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ScopePicker, RecipientPicker } from './ReportPickers';
import {
    EMPTY_REPORT_SETTING,
    fetchReportSetting,
    fetchRunRecipients,
    fetchRuns,
    fetchSections,
    newSchedule,
    previewReport,
    previewScope,
    runReportNow,
    saveReportSetting,
    type ReportSchedule,
    type ReportSettingConfig,
    type PreviewResult,
    type ReportRun,
    type ReportRunRecipient,
    type ScopePreview,
} from '../-services/scheduled-reports-service';

/** Names this screen generates itself, and may therefore replace. */
function defaultNames(t: TFunction) {
    return [t('defaultNames.daily'), t('defaultNames.weekly'), t('defaultNames.monthly')];
}

function defaultNameFor(t: TFunction, frequency: ReportSchedule['frequency']) {
    return frequency === 'daily'
        ? t('defaultNames.daily')
        : frequency === 'monthly'
          ? t('defaultNames.monthly')
          : t('defaultNames.weekly');
}

function isDefaultName(t: TFunction, name: string) {
    return defaultNames(t).includes((name ?? '').trim());
}

/**
 * Hand the rendered report to the browser as a file.
 *
 * The preview iframe is `sandbox=""`, which blocks downloads started inside it —
 * so the blob is built and clicked here in the parent document instead. The URL is
 * revoked on a later tick because revoking it synchronously can cancel the
 * download before the browser has read it.
 */
function downloadPreview(html: string | null) {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-preview-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Full-size view, for a report too tall to read in a dialog. */
function openPreviewInTab(t: TFunction, html: string | null) {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) toast.error(t('toasts.popupBlocked'));
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Scheduled Reports — push reporting configuration.
 *
 * Two things here are load-bearing rather than decorative:
 *
 * 1. **Sections are offered only when the institute has data for them.**
 *    Institutes differ wildly in shape — one runs 1,500 live sessions and no
 *    chatbot, another has 67,000 progress rows and one live session. Letting an
 *    admin tick a section that can only ever render empty is a bad first run, so
 *    availability comes from the server and unavailable sections are disabled.
 *
 * 2. **Fan-out is previewed before saving.** Scope multiplies everything: at a
 *    real institute "every batch" resolves to 661 documents per run, and daily
 *    that is ~20,000 generations a month — each of which bills. The admin is
 *    shown that number before they commit to it, not afterwards on the ledger.
 */

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const SCOPE_VALUES = ['INSTITUTE', 'BATCH', 'SUBJECT', 'FACULTY'] as const;
const ROLES = ['ADMIN', 'TEACHER', 'EVALUATOR'];

/**
 * Delivery history columns. Read-only — the audit view, not an editing surface.
 *
 * A factory rather than a const because the last column opens the per-recipient
 * detail, and "who actually received this, and did it land" is the half of the
 * audit that matters when someone asks why they did not get their report.
 */
const makeRunColumns = (
    t: TFunction,
    onInspect: (run: ReportRun) => void
): ColumnDef<ReportRun>[] => [
    {
        accessorKey: 'createdAt',
        header: t('history.columns.when'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
    { accessorKey: 'scopeLabel', header: t('history.columns.report') },
    {
        accessorKey: 'status',
        header: t('history.columns.status'),
        cell: ({ row }) =>
            row.original.skipReason
                ? t('history.statusWithSkipReason', {
                      status: row.original.status,
                      skipReason: row.original.skipReason,
                  })
                : row.original.status,
    },
    { accessorKey: 'recipientCount', header: t('history.columns.recipients') },
    { accessorKey: 'namedLearners', header: t('history.columns.learnersNamed') },
    {
        id: 'detail',
        header: '',
        cell: ({ row }) => (
            <MyButton buttonType="text" onClick={() => onInspect(row.original)}>
                {t('history.columns.whoReceivedIt')}
            </MyButton>
        ),
    },
];
/** Mirrors ReportingScopeResolver.MAX_DOCUMENTS_PER_RUN — the server refuses above this. */
const MAX_DOCS_PER_RUN = 50;

export default function ScheduledReportsSettings() {
    const { t } = useTranslation('settingsScheduledReports');
    const [config, setConfig] = useState<ReportSettingConfig>(EMPTY_REPORT_SETTING);
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState<Record<string, ScopePreview | null>>({});
    const [inspecting, setInspecting] = useState<ReportRun | null>(null);
    const [recipients, setRecipients] = useState<ReportRunRecipient[] | null>(null);
    const [recipientsError, setRecipientsError] = useState<string | null>(null);

    const SCOPES = SCOPE_VALUES.map((v) => ({ v, label: t(`scopes.${v}`) }));

    const inspectRun = async (run: ReportRun) => {
        setInspecting(run);
        setRecipients(null);
        setRecipientsError(null);
        try {
            setRecipients(await fetchRunRecipients(run.id));
        } catch {
            // Distinguish "failed to load" from "nobody received it" — a run that
            // legitimately reached zero people looks identical otherwise.
            setRecipientsError(t('toasts.recipientsLoadError'));
        }
    };
    const [rendered, setRendered] = useState<PreviewResult | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const { data: stored, isLoading } = useQuery({
        queryKey: ['report-setting'],
        queryFn: fetchReportSetting,
    });
    const {
        data: sections = [],
        isLoading: sectionsLoading,
        error: sectionsError,
    } = useQuery({
        queryKey: ['report-sections'],
        queryFn: fetchSections,
    });
    const {
        data: runs = [],
        refetch: refetchRuns,
        isLoading: runsLoading,
        error: runsError,
    } = useQuery({
        queryKey: ['report-runs'],
        queryFn: fetchRuns,
    });

    useEffect(() => {
        if (stored) setConfig(stored);
    }, [stored]);

    const availableSections = useMemo(() => sections.filter((s) => s.available), [sections]);

    function patchSchedule(id: string, patch: Partial<ReportSchedule>) {
        setConfig((c) => ({
            ...c,
            schedules: c.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }));
        // Any change to scope or frequency invalidates the fan-out estimate.
        setPreview((p) => ({ ...p, [id]: null }));
    }

    async function runPreview(schedule: ReportSchedule) {
        try {
            const p = await previewScope(schedule);
            setPreview((prev) => ({ ...prev, [schedule.id]: p }));
        } catch {
            toast.error(t('toasts.previewScopeError'));
        }
    }

    async function handlePreview(schedule: ReportSchedule) {
        setBusyId(schedule.id);
        try {
            setRendered(await previewReport(schedule));
        } catch {
            toast.error(t('toasts.previewBuildError'));
        } finally {
            setBusyId(null);
        }
    }

    async function handleRunNow(schedule: ReportSchedule) {
        // Real emails to real people — make the blast radius explicit before it
        // happens, not afterwards in the audit log.
        const who =
            schedule.recipients.roles.length > 0
                ? t('confirmSend.roleAudience', {
                      roles: schedule.recipients.roles.map((r) => t(`roles.${r}`)).join('/'),
                  })
                : t('confirmSend.selectedAudience', {
                      count: schedule.recipients.userIds.length,
                  });
        if (
            !window.confirm(
                t('confirmSend.message', {
                    name: schedule.name,
                    who,
                })
            )
        ) {
            return;
        }
        setBusyId(schedule.id);
        try {
            toast.success(await runReportNow(schedule));
            refetchRuns();
        } catch {
            toast.error(t('toasts.sendError'));
        } finally {
            setBusyId(null);
        }
    }

    async function handleSave() {
        // Refuse to save a schedule that would fan out past the server cap —
        // saving it would simply fail every run, silently, forever.
        for (const s of config.schedules) {
            const p = preview[s.id];
            if (p?.exceedsCap) {
                toast.error(
                    t('validation.exceedsCap', {
                        name: s.name,
                        documentsPerRun: p.documentsPerRun,
                        max: MAX_DOCS_PER_RUN,
                    })
                );
                return;
            }
            if (s.sections.length === 0) {
                toast.error(t('validation.noSections', { name: s.name }));
                return;
            }
            if (s.recipients.roles.length === 0 && s.recipients.userIds.length === 0) {
                toast.error(t('validation.noRecipients', { name: s.name }));
                return;
            }
        }
        setSaving(true);
        try {
            await saveReportSetting(config);
            toast.success(t('toasts.saveSuccess'));
            refetchRuns();
        } catch {
            toast.error(t('toasts.saveError'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <SettingsPageShell
            title={t('page.title')}
            description={t('page.description')}
            maxWidth="max-w-5xl"
            actions={
                <MyButton onClick={handleSave} disabled={saving || isLoading}>
                    {saving ? t('page.saving') : t('page.save')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-6">
                <SettingToggleRow
                    label={t('toggles.enable.label')}
                    description={t('toggles.enable.description')}
                    control={
                        <Switch
                            checked={config.enabled}
                            onCheckedChange={(v) => setConfig((c) => ({ ...c, enabled: v }))}
                        />
                    }
                />

                <SettingToggleRow
                    label={t('toggles.timezone.label')}
                    description={t('toggles.timezone.description')}
                    control={
                        <MyInput
                            inputType="text"
                            className="w-56"
                            input={config.timezone}
                            onChangeFunction={(e) =>
                                setConfig((c) => ({ ...c, timezone: e.target.value }))
                            }
                        />
                    }
                />

                {config.schedules.map((s) => {
                    const p = preview[s.id];
                    return (
                        <div key={s.id} className="rounded-md border border-border p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <MyInput
                                    inputType="text"
                                    className="max-w-xs font-medium"
                                    input={s.name}
                                    onChangeFunction={(e) =>
                                        patchSchedule(s.id, { name: e.target.value })
                                    }
                                />
                                <div className="flex items-center gap-3">
                                    <Switch
                                        checked={s.enabled}
                                        onCheckedChange={(v) => patchSchedule(s.id, { enabled: v })}
                                    />
                                    <MyButton
                                        buttonType="text"
                                        onClick={() =>
                                            setConfig((c) => ({
                                                ...c,
                                                schedules: c.schedules.filter((x) => x.id !== s.id),
                                            }))
                                        }
                                    >
                                        {t('schedule.remove')}
                                    </MyButton>
                                </div>
                            </div>

                            {/* ── What goes in it ── */}
                            <p className="mb-2 text-caption font-medium text-neutral-600">
                                {t('schedule.sectionsLabel')}
                            </p>
                            <div className="mb-4 flex flex-col gap-2">
                                {sections.map((sec) => (
                                    <label
                                        key={sec.key}
                                        className={`flex items-start gap-2 text-body ${
                                            sec.available ? '' : 'opacity-50'
                                        }`}
                                    >
                                        <Checkbox
                                            className="mt-1"
                                            disabled={!sec.available}
                                            checked={s.sections.includes(sec.key)}
                                            onCheckedChange={(v) =>
                                                patchSchedule(s.id, {
                                                    sections: v
                                                        ? [...s.sections, sec.key]
                                                        : s.sections.filter((k) => k !== sec.key),
                                                })
                                            }
                                        />
                                        <span>
                                            {sec.title}
                                            {sec.identifying && (
                                                <Badge className="ml-2" variant="outline">
                                                    {t('schedule.namesLearnersBadge')}
                                                </Badge>
                                            )}
                                            {!sec.available && (
                                                <span className="ml-2 text-caption text-neutral-500">
                                                    {t('schedule.noDataBadge')}
                                                </span>
                                            )}
                                            <span className="block text-caption text-neutral-500">
                                                {sec.description}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                                {/* "The list is empty" and "the list failed to
                                    load" must not read the same. Saying no
                                    section has data when the request actually
                                    failed sends an admin looking for a data
                                    problem that does not exist. */}
                                {sectionsError ? (
                                    <p className="text-caption text-danger-600">
                                        {t('schedule.sectionsError')}
                                    </p>
                                ) : sectionsLoading ? (
                                    <p className="text-caption text-neutral-500">
                                        {t('schedule.sectionsLoading')}
                                    </p>
                                ) : (
                                    sections.length === 0 && (
                                        <p className="text-caption text-neutral-500">
                                            {t('schedule.noSectionsAvailable')}
                                        </p>
                                    )
                                )}
                            </div>

                            {/* ── When ── */}
                            <div className="mb-4 flex flex-wrap items-center gap-3">
                                <Select
                                    value={s.frequency}
                                    onValueChange={(v) =>
                                        patchSchedule(s.id, {
                                            frequency: v as ReportSchedule['frequency'],
                                            // The name is the document's heading, so a
                                            // schedule created as "Weekly digest" and
                                            // switched to daily would arrive contradicting
                                            // itself. Carry the default across, but never
                                            // clobber a name the admin actually chose.
                                            ...(isDefaultName(t, s.name)
                                                ? {
                                                      name: defaultNameFor(
                                                          t,
                                                          v as ReportSchedule['frequency']
                                                      ),
                                                  }
                                                : {}),
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="daily">{t('frequency.daily')}</SelectItem>
                                        <SelectItem value="weekly">
                                            {t('frequency.weekly')}
                                        </SelectItem>
                                        <SelectItem value="monthly">
                                            {t('frequency.monthly')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {s.frequency === 'weekly' && (
                                    <Select
                                        value={s.dayOfWeek}
                                        onValueChange={(v) => patchSchedule(s.id, { dayOfWeek: v })}
                                    >
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {DAYS.map((d) => (
                                                <SelectItem key={d} value={d}>
                                                    {t(`days.${d}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}

                                <MyInput
                                    inputType="number"
                                    className="w-24"
                                    input={String(s.hour)}
                                    onChangeFunction={(e) =>
                                        patchSchedule(s.id, {
                                            hour: Math.min(23, Math.max(0, Number(e.target.value))),
                                        })
                                    }
                                />
                                <span className="text-caption text-neutral-500">
                                    {t('schedule.hourSuffix', { timezone: config.timezone })}
                                </span>
                            </div>

                            {/* ── Scope, and the fan-out guard ── */}
                            <div className="mb-3 flex flex-wrap items-center gap-3">
                                <Select
                                    value={s.scopeType}
                                    onValueChange={(v) =>
                                        patchSchedule(s.id, {
                                            scopeType: v as ReportSchedule['scopeType'],
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-48">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {SCOPES.map((sc) => (
                                            <SelectItem key={sc.v} value={sc.v}>
                                                {sc.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <MyButton buttonType="secondary" onClick={() => runPreview(s)}>
                                    {t('schedule.checkReports')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    disabled={busyId === s.id || s.sections.length === 0}
                                    onClick={() => handlePreview(s)}
                                >
                                    {busyId === s.id ? t('schedule.building') : t('schedule.previewButton')}
                                </MyButton>
                                <MyButton
                                    buttonType="text"
                                    disabled={busyId === s.id || s.sections.length === 0}
                                    onClick={() => handleRunNow(s)}
                                >
                                    {t('schedule.sendNow')}
                                </MyButton>
                            </div>

                            <ScopePicker
                                scopeType={s.scopeType}
                                selected={s.scopeIds}
                                onChange={(ids) => patchSchedule(s.id, { scopeIds: ids })}
                            />

                            {p && (
                                <div
                                    className={`mb-4 rounded-md border p-3 text-body ${
                                        p.exceedsCap
                                            ? 'border-danger-500 bg-danger-50 text-danger-700'
                                            : 'border-border bg-neutral-50'
                                    }`}
                                >
                                    <b>{p.documentsPerRun}</b>{' '}
                                    {t('preview.reportsPerRun', { count: p.documentsPerRun })}{' '}
                                    <b>{p.runsPerMonth}</b> {t('preview.runsEqualsMonth')}{' '}
                                    <b>{p.documentsPerMonth}</b> {t('preview.aMonth')}
                                    {p.exceedsCap && (
                                        <span className="block">
                                            {t('preview.exceedsCap', { max: MAX_DOCS_PER_RUN })}
                                        </span>
                                    )}
                                    <span className="block">
                                        {p.creditsPerDocument === 0 ? (
                                            <>{t('preview.freeNoAi')}</>
                                        ) : (
                                            <>
                                                <b>{p.creditsPerDocument}</b>{' '}
                                                {t('preview.creditsPerReport')}
                                                {' → '}
                                                <b>{p.creditsPerRun}</b> {t('preview.perRun')}{' '}
                                                <b>{p.creditsPerMonth}</b>{' '}
                                                {t('preview.aMonthAiAnalysis')}
                                            </>
                                        )}
                                    </span>
                                    {p.sampleLabels?.length > 1 && (
                                        <span className="block text-caption text-neutral-500">
                                            {t('preview.exampleLabel')}{' '}
                                            {p.sampleLabels.slice(0, 3).join(', ')}…
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* ── Who ── */}
                            <p className="mb-2 text-caption font-medium text-neutral-600">
                                {t('schedule.sendToLabel')}
                            </p>
                            <div className="mb-2 flex flex-wrap gap-4">
                                {ROLES.map((r) => (
                                    <label key={r} className="flex items-center gap-2 text-body">
                                        <Checkbox
                                            checked={s.recipients.roles.includes(r)}
                                            onCheckedChange={(v) =>
                                                patchSchedule(s.id, {
                                                    recipients: {
                                                        ...s.recipients,
                                                        roles: v
                                                            ? [...s.recipients.roles, r]
                                                            : s.recipients.roles.filter(
                                                                  (x) => x !== r
                                                              ),
                                                    },
                                                })
                                            }
                                        />
                                        {t(`roles.${r}`)}
                                    </label>
                                ))}
                            </div>
                            {/* The one billable choice on this screen. */}
                            <div className="mb-3 rounded-md border border-border p-3">
                                <label className="flex items-start gap-2 text-body">
                                    <Checkbox
                                        checked={s.ai?.enabled ?? false}
                                        onCheckedChange={(v) =>
                                            patchSchedule(s.id, { ai: { enabled: Boolean(v) } })
                                        }
                                    />
                                    <span>
                                        {t('ai.label')}
                                        <Badge className="ml-2" variant="secondary">
                                            {t('ai.badge')}
                                        </Badge>
                                        <span className="block text-caption text-neutral-500">
                                            {t('ai.description')}
                                        </span>
                                    </span>
                                </label>
                            </div>

                            {/* The server refuses a run above this, BEFORE sending —
                                the only point at which refusing is still free. */}
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <span className="text-caption text-neutral-600">
                                    {t('creditCap.prefix')}
                                </span>
                                <MyInput
                                    inputType="number"
                                    input={
                                        s.creditCapPerRun === null ||
                                        s.creditCapPerRun === undefined
                                            ? ''
                                            : String(s.creditCapPerRun)
                                    }
                                    onChangeFunction={(e) => {
                                        const raw = e.target.value.trim();
                                        const n = Number(raw);
                                        patchSchedule(s.id, {
                                            creditCapPerRun:
                                                raw === '' || Number.isNaN(n) || n <= 0
                                                    ? null
                                                    : Math.floor(n),
                                        });
                                    }}
                                    inputPlaceholder={t('creditCap.placeholder')}
                                    className="w-28"
                                />
                                <span className="text-caption text-neutral-600">
                                    {t('creditCap.suffix')}
                                </span>
                            </div>

                            <RecipientPicker
                                selected={s.recipients.userIds}
                                onChange={(ids) =>
                                    patchSchedule(s.id, {
                                        recipients: { ...s.recipients, userIds: ids },
                                    })
                                }
                            />
                            <p className="mb-4 text-caption text-neutral-500">
                                {t('recipients.helperText')}
                            </p>

                            <SettingToggleRow
                                label={t('toggles.skip.label')}
                                description={t('toggles.skip.description')}
                                control={
                                    <Switch
                                        checked={s.skipIfNoData}
                                        onCheckedChange={(v) =>
                                            patchSchedule(s.id, { skipIfNoData: v })
                                        }
                                    />
                                }
                            />
                        </div>
                    );
                })}

                <MyButton
                    buttonType="secondary"
                    onClick={() =>
                        setConfig((c) => ({ ...c, schedules: [...c.schedules, newSchedule()] }))
                    }
                >
                    {t('addSchedule')}
                </MyButton>

                {/* ── Delivery history / audit ── */}
                <div>
                    <p className="mb-2 text-subtitle font-medium">{t('history.title')}</p>
                    {runsError ? (
                        <p className="text-caption text-danger-600">{t('history.loadError')}</p>
                    ) : runs.length === 0 && !runsLoading ? (
                        <p className="text-caption text-neutral-500">{t('history.empty')}</p>
                    ) : (
                        <MyTable<ReportRun>
                            data={{
                                content: runs,
                                total_pages: 1,
                                page_no: 0,
                                page_size: runs.length,
                                total_elements: runs.length,
                                last: true,
                            }}
                            columns={makeRunColumns(t, inspectRun)}
                            isLoading={runsLoading}
                            error={runsError}
                            currentPage={0}
                        />
                    )}
                </div>
            </div>

            {inspecting && (
                <MyDialog
                    heading={t('whoReceivedDialog.heading')}
                    open={true}
                    onOpenChange={() => setInspecting(null)}
                    dialogWidth="max-w-3xl"
                >
                    <div className="flex flex-col gap-3">
                        <p className="text-caption text-neutral-500">
                            {inspecting.scopeLabel || t('whoReceivedDialog.instituteReportFallback')}{' '}
                            · {new Date(inspecting.createdAt).toLocaleString()}
                            {inspecting.skipReason ? ` · ${inspecting.skipReason}` : ''}
                        </p>
                        {recipientsError && (
                            <p className="text-caption text-danger-600">{recipientsError}</p>
                        )}
                        {!recipientsError && recipients === null && (
                            <p className="text-caption text-neutral-500">
                                {t('whoReceivedDialog.loading')}
                            </p>
                        )}
                        {recipients?.length === 0 && (
                            <p className="text-body">{t('whoReceivedDialog.emptyState')}</p>
                        )}
                        {recipients && recipients.length > 0 && (
                            <div className="max-h-96 overflow-y-auto">
                                {recipients.map((r) => (
                                    <div
                                        key={r.id}
                                        className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-body"
                                    >
                                        <span className="min-w-48 truncate">
                                            {r.email || t('whoReceivedDialog.noEmail')}
                                        </span>
                                        <Badge variant="secondary">
                                            {r.role || t('whoReceivedDialog.unknownRole')}
                                        </Badge>
                                        <Badge
                                            variant={r.delivered ? 'secondary' : 'destructive'}
                                        >
                                            {r.delivered
                                                ? t('whoReceivedDialog.delivered')
                                                : t('whoReceivedDialog.notDelivered')}
                                        </Badge>
                                        {r.namedLearners ? (
                                            <span className="text-caption text-neutral-500">
                                                {t('whoReceivedDialog.namedLearners', {
                                                    count: r.namedLearners,
                                                })}
                                            </span>
                                        ) : null}
                                        {r.sectionsSent && (
                                            <span className="text-caption text-neutral-500">
                                                {r.sectionsSent}
                                            </span>
                                        )}
                                        {r.errorMessage && (
                                            <span className="text-caption text-danger-600">
                                                {r.errorMessage}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </MyDialog>
            )}

            {rendered && (
                <MyDialog
                    heading={t('reportPreviewDialog.heading')}
                    open={true}
                    onOpenChange={() => setRendered(null)}
                    dialogWidth="max-w-3xl"
                >
                    <div className="flex flex-col gap-3">
                        <p className="text-caption text-neutral-500">
                            {t('reportPreviewDialog.subtitle')}
                        </p>
                        {rendered.note && (
                            <p className="rounded-md border border-warning-500 bg-warning-50 p-2 text-caption text-warning-700">
                                {rendered.note}
                            </p>
                        )}
                        {rendered.html ? (
                            <>
                                <iframe
                                    title={t('reportPreviewDialog.iframeTitle')}
                                    className="h-96 w-full rounded-md border border-border bg-white"
                                    sandbox=""
                                    srcDoc={rendered.html}
                                />
                                <div className="flex justify-end gap-2">
                                    <MyButton
                                        buttonType="secondary"
                                        onClick={() => openPreviewInTab(t, rendered.html)}
                                    >
                                        {t('reportPreviewDialog.openInNewTab')}
                                    </MyButton>
                                    <MyButton
                                        buttonType="secondary"
                                        onClick={() => downloadPreview(rendered.html)}
                                    >
                                        {t('reportPreviewDialog.downloadHtml')}
                                    </MyButton>
                                </div>
                            </>
                        ) : (
                            <p className="text-body">{t('reportPreviewDialog.nothingToSend')}</p>
                        )}
                    </div>
                </MyDialog>
            )}
        </SettingsPageShell>
    );
}
