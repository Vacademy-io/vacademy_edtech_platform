/**
 * Settings → AI → Limits (admins only). Contract N5:
 *  - mode: Off (nothing checked) / Preview (SHADOW: decisions logged, nothing
 *    blocked) / Enforce (only once the platform unlocked it for the institute);
 *  - the institute's own limit rows (add / edit / remove, each with a reason and
 *    a 30-day "Preview impact" first) and the platform's rows, read-only;
 *  - live meters for the current day / week / month window;
 *  - an effective-limits lookup for one member.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformBrand } from '@/lib/platform-brand';
import { toast } from 'sonner';
import {
    Gauge,
    Lock,
    PencilSimple,
    Plus,
    ShieldCheck,
    Trash,
    Warning,
    Eye,
    Power,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { formatDate } from '@/lib/formatters';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    LIMITS_MODES,
    TENANT_PERIODS,
    apiErrorMessage,
    deleteLimitRow,
    updateLimitsPolicy,
    useInvalidateLimits,
    useLimitsQuery,
    useLimitsUsageQuery,
    type LimitPeriod,
    type LimitRow,
    type LimitsMode,
    type LimitsPolicy,
} from '../../-services/ai-limits-service';
import { amount, limitCell, scopeText, subjectText, unitText } from './limit-labels';
import { LimitRowDialog } from './LimitRowDialog';
import { EffectiveLimitsCard } from './EffectiveLimitsCard';

const MODE_ICON = { OFF: Power, SHADOW: Eye, ENFORCE: ShieldCheck } as const;

// ---------------------------------------------------------------------------
// Mode / policy
// ---------------------------------------------------------------------------

function PolicyCard({
    instituteId,
    policy,
    enforceGloballyEnabled,
    onSaved,
}: {
    instituteId: string;
    policy: LimitsPolicy;
    enforceGloballyEnabled: boolean;
    onSaved: () => void;
}) {
    const { t } = useTranslation('settingsAiLimits');
    const brand = usePlatformBrand();
    const [mode, setMode] = useState<LimitsMode>(policy.mode);
    const [notify, setNotify] = useState(policy.notify_admins_on_soft);
    const [showNumbers, setShowNumbers] = useState(policy.show_numbers_to_learners);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    // Keyed on the values, not the object: a background refetch returns a new
    // object and must not wipe an edit in progress.
    useEffect(() => {
        setMode(policy.mode);
        setNotify(policy.notify_admins_on_soft);
        setShowNumbers(policy.show_numbers_to_learners);
    }, [policy.mode, policy.notify_admins_on_soft, policy.show_numbers_to_learners]);

    const dirty =
        mode !== policy.mode ||
        notify !== policy.notify_admins_on_soft ||
        showNumbers !== policy.show_numbers_to_learners;

    const save = async () => {
        if (!dirty || !reason.trim()) return;
        setSaving(true);
        try {
            await updateLimitsPolicy(instituteId, {
                mode,
                notify_admins_on_soft: notify,
                show_numbers_to_learners: showNumbers,
                reason: reason.trim(),
            });
            toast.success(t('toasts.policySaved'));
            setReason('');
            onSaved();
        } catch (err) {
            toast.error(apiErrorMessage(err) || t('toasts.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-5 text-primary-500" />
                    {t('mode.title')}
                </CardTitle>
                <CardDescription>{t('mode.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div
                    role="radiogroup"
                    aria-label={t('mode.title')}
                    className="grid gap-3 md:grid-cols-3"
                >
                    {LIMITS_MODES.map((m) => {
                        const Icon = MODE_ICON[m];
                        const locked = m === 'ENFORCE' && !policy.tenant_may_enforce;
                        const selected = mode === m;
                        const option = (
                            <button
                                key={m}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={locked}
                                onClick={() => setMode(m)}
                                className={cn(
                                    'flex h-full w-full flex-col items-start gap-1.5 rounded-lg border p-3 text-start transition-colors',
                                    selected
                                        ? 'border-primary-500 bg-primary-50'
                                        : 'border-neutral-200 bg-white hover:border-primary-200',
                                    locked &&
                                        'cursor-not-allowed opacity-60 hover:border-neutral-200'
                                )}
                            >
                                <span className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                                    <Icon
                                        className="size-4"
                                        weight={selected ? 'fill' : 'regular'}
                                    />
                                    {t(`mode.${m}.label`)}
                                    {locked && <Lock className="size-3.5 text-neutral-500" />}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`mode.${m}.help`)}
                                </span>
                            </button>
                        );
                        return locked ? (
                            <Tooltip key={m}>
                                <TooltipTrigger asChild>
                                    <span className="block">{option}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {t('mode.enforceLocked', brand.vars)}
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            option
                        );
                    })}
                </div>

                {!policy.tenant_may_enforce && (
                    <p className="text-caption text-neutral-500">
                        {t('mode.enforceLockedNote', brand.vars)}
                    </p>
                )}
                {!enforceGloballyEnabled && mode === 'ENFORCE' && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                        <Warning className="mt-0.5 size-4 shrink-0" />
                        {t('mode.globallyPaused')}
                    </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-700">
                                {t('mode.notify')}
                            </div>
                            <div className="text-caption text-neutral-500">
                                {t('mode.notifyHelp')}
                            </div>
                        </div>
                        <Switch checked={notify} onCheckedChange={setNotify} />
                    </div>
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-700">
                                {t('mode.showNumbers')}
                            </div>
                            <div className="text-caption text-neutral-500">
                                {t('mode.showNumbersHelp')}
                            </div>
                        </div>
                        <Switch checked={showNumbers} onCheckedChange={setShowNumbers} />
                    </div>
                </div>

                {dirty && (
                    <div className="space-y-2">
                        <Label>{t('dialog.reason')}</Label>
                        <Textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('mode.reasonPlaceholder')}
                            rows={2}
                            maxLength={500}
                        />
                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => {
                                    setMode(policy.mode);
                                    setNotify(policy.notify_admins_on_soft);
                                    setShowNumbers(policy.show_numbers_to_learners);
                                    setReason('');
                                }}
                            >
                                {t('actions.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={save}
                                disable={!reason.trim() || saving}
                            >
                                {saving ? t('actions.saving') : t('actions.save')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Current usage meters
// ---------------------------------------------------------------------------

function UsageMetersCard({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsAiLimits');
    const [period, setPeriod] = useState<LimitPeriod>('DAY');
    const usageQ = useLimitsUsageQuery(instituteId, period);

    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Gauge className="size-5 text-primary-500" />
                            {t('usage.title')}
                        </CardTitle>
                        <CardDescription>{t('usage.description')}</CardDescription>
                    </div>
                    <div className="flex gap-1 rounded-full border border-neutral-200 p-0.5">
                        {TENANT_PERIODS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPeriod(p)}
                                className={cn(
                                    'rounded-full px-3 py-1 text-caption font-medium transition-colors',
                                    period === p
                                        ? 'bg-primary-500 text-white'
                                        : 'text-neutral-600 hover:bg-neutral-100'
                                )}
                            >
                                {t(`periodShort.${p}`)}
                            </button>
                        ))}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {usageQ.isLoading && (
                    <p className="text-sm text-neutral-500">{t('dialog.loading')}</p>
                )}
                {usageQ.isError && (
                    <p className="text-sm text-danger-600">
                        {apiErrorMessage(usageQ.error) || t('usage.failed')}
                    </p>
                )}
                {usageQ.data && usageQ.data.length === 0 && (
                    <p className="text-sm text-neutral-500">{t('usage.empty')}</p>
                )}
                {usageQ.data && usageQ.data.length > 0 && (
                    <ul className="space-y-3">
                        {usageQ.data.map((m) => {
                            const used = m.metric === 'COUNT' ? m.count_used : m.credits_used;
                            const cap = m.hard ?? m.soft;
                            const pct =
                                m.pct ?? (cap && cap > 0 ? Math.round((used / cap) * 100) : null);
                            const bar =
                                pct === null
                                    ? '[&>div]:bg-neutral-300'
                                    : pct >= 100
                                      ? '[&>div]:bg-danger-500'
                                      : m.soft !== null && used >= m.soft
                                        ? '[&>div]:bg-warning-500'
                                        : '[&>div]:bg-primary-500';
                            return (
                                <li key={`${m.key}-${m.period}`} className="space-y-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                        <span className="font-medium text-neutral-700">
                                            {m.label}
                                        </span>
                                        <span className="text-caption text-neutral-500">
                                            {t('usage.line', {
                                                credits: amount(m.credits_used),
                                                requests: amount(m.count_used),
                                            })}
                                            {m.hard !== null &&
                                                ` · ${t('usage.hard', { value: `${amount(m.hard)} ${unitText(t, m.metric)}` })}`}
                                            {m.soft !== null &&
                                                ` · ${t('usage.soft', { value: amount(m.soft) })}`}
                                            {pct !== null && ` · ${pct}%`}
                                        </span>
                                    </div>
                                    <Progress
                                        value={Math.min(100, Math.max(0, pct ?? 0))}
                                        className={cn('h-2 bg-neutral-100', bar)}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Rows tables
// ---------------------------------------------------------------------------

function RowsTable({
    rows,
    readOnly,
    onEdit,
    onDelete,
}: {
    rows: LimitRow[];
    readOnly: boolean;
    onEdit?: (row: LimitRow) => void;
    onDelete?: (row: LimitRow) => void;
}) {
    const { t } = useTranslation('settingsAiLimits');
    const brand = usePlatformBrand();
    return (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('table.appliesTo')}</TableHead>
                        <TableHead>{t('table.feature')}</TableHead>
                        <TableHead>{t('table.period')}</TableHead>
                        <TableHead className="text-end">{t('table.soft')}</TableHead>
                        <TableHead className="text-end">{t('table.hard')}</TableHead>
                        <TableHead>{t('table.reason')}</TableHead>
                        {!readOnly && (
                            <TableHead className="text-end">{t('table.actions')}</TableHead>
                        )}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => (
                        <TableRow key={r.id} className={readOnly ? 'bg-neutral-50' : undefined}>
                            <TableCell className="text-sm">
                                <span className="flex items-center gap-1.5 font-medium text-neutral-800">
                                    {readOnly && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Lock
                                                    className="size-3.5 shrink-0 text-neutral-500"
                                                    aria-label={t(
                                                        'platform.lockedTooltip',
                                                        brand.vars
                                                    )}
                                                />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {t('platform.lockedTooltip', brand.vars)}
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                    {subjectText(t, r)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`subjectKind.${r.subject_kind}`, {
                                        defaultValue: r.subject_kind,
                                    })}
                                </span>
                            </TableCell>
                            <TableCell className="text-sm">{scopeText(t, r)}</TableCell>
                            <TableCell className="text-sm">
                                {t(`period.${r.period}`, { defaultValue: r.period })}
                                <span className="block text-caption text-neutral-500">
                                    {unitText(t, r.metric)}
                                </span>
                            </TableCell>
                            <TableCell className="text-end text-sm">
                                {limitCell(t, r.soft_limit, false)}
                            </TableCell>
                            <TableCell className="text-end text-sm font-medium">
                                {limitCell(t, r.hard_limit, true)}
                            </TableCell>
                            <TableCell className="max-w-xs text-caption text-neutral-500">
                                <span className="line-clamp-2" title={r.reason ?? undefined}>
                                    {r.reason || '—'}
                                </span>
                                {(r.updated_at || r.created_at) && (
                                    <span className="block">
                                        {formatDate((r.updated_at || r.created_at) as string)}
                                    </span>
                                )}
                            </TableCell>
                            {!readOnly && (
                                <TableCell className="text-end">
                                    <div className="flex justify-end gap-1">
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="icon"
                                            onClick={() => onEdit?.(r)}
                                            aria-label={t('actions.edit')}
                                        >
                                            <PencilSimple className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="icon"
                                            onClick={() => onDelete?.(r)}
                                            aria-label={t('actions.delete')}
                                        >
                                            <Trash className="size-4 text-danger-600" />
                                        </MyButton>
                                    </div>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function DeleteRowDialog({
    instituteId,
    row,
    onClose,
    onDeleted,
}: {
    instituteId: string;
    row: LimitRow | null;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const { t } = useTranslation('settingsAiLimits');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (row) setReason('');
    }, [row]);

    const confirm = async () => {
        if (!row || !reason.trim()) return;
        setBusy(true);
        try {
            await deleteLimitRow(instituteId, row.id, reason.trim());
            toast.success(t('toasts.rowDeleted'));
            onDeleted();
            onClose();
        } catch (err) {
            toast.error(apiErrorMessage(err) || t('toasts.deleteFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <MyDialog
            open={!!row}
            onOpenChange={(o) => !o && onClose()}
            heading={t('delete.title')}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={confirm}
                        disable={!reason.trim() || busy}
                    >
                        {busy ? t('actions.deleting') : t('actions.delete')}
                    </MyButton>
                </>
            }
        >
            {row && (
                <div className="space-y-3">
                    <p className="text-sm text-neutral-600">
                        {t('delete.body', {
                            subject: subjectText(t, row),
                            feature: scopeText(t, row),
                        })}
                    </p>
                    <div className="space-y-1.5">
                        <Label>{t('dialog.reason')}</Label>
                        <Textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('dialog.reasonPlaceholder')}
                            rows={2}
                            maxLength={500}
                        />
                    </div>
                </div>
            )}
        </MyDialog>
    );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AiLimitsSection() {
    const { t } = useTranslation('settingsAiLimits');
    const brand = usePlatformBrand();
    const instituteId = getInstituteId() ?? '';
    const limitsQ = useLimitsQuery(instituteId);
    const invalidate = useInvalidateLimits(instituteId);
    const [editing, setEditing] = useState<{ open: boolean; row: LimitRow | null }>({
        open: false,
        row: null,
    });
    const [deleting, setDeleting] = useState<LimitRow | null>(null);

    const data = limitsQ.data;

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <Gauge className="size-5 text-primary-500" weight="fill" />
                    <h3 className="text-h3 font-semibold text-neutral-700">{t('heading')}</h3>
                </div>
                <p className="text-body text-neutral-500">{t('description')}</p>
            </div>

            {limitsQ.isLoading && <p className="text-sm text-neutral-500">{t('dialog.loading')}</p>}
            {limitsQ.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                    <Warning className="mt-0.5 size-4 shrink-0" />
                    <span>{apiErrorMessage(limitsQ.error) || t('loadFailed')}</span>
                </div>
            )}

            {data && (
                <>
                    <PolicyCard
                        instituteId={instituteId}
                        policy={data.policy}
                        enforceGloballyEnabled={data.enforce_globally_enabled}
                        onSaved={invalidate}
                    />

                    <Card className="border-neutral-200 shadow-sm">
                        <CardHeader>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-1.5">
                                    <CardTitle className="text-base">{t('rows.title')}</CardTitle>
                                    <CardDescription>{t('rows.description')}</CardDescription>
                                </div>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => setEditing({ open: true, row: null })}
                                >
                                    <Plus className="size-4" />
                                    {t('actions.addLimit')}
                                </MyButton>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {data.policy.mode === 'OFF' && data.rows.length > 0 && (
                                <p className="rounded-lg bg-neutral-50 p-3 text-caption text-neutral-600">
                                    {t('rows.offNote')}
                                </p>
                            )}
                            {data.rows.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                                    {t('rows.empty')}
                                </div>
                            ) : (
                                <RowsTable
                                    rows={data.rows}
                                    readOnly={false}
                                    onEdit={(row) => setEditing({ open: true, row })}
                                    onDelete={setDeleting}
                                />
                            )}

                            {data.platform_rows.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                                        <Lock className="size-4 text-neutral-500" />
                                        {t('platform.title', brand.vars)}
                                    </div>
                                    <p className="text-caption text-neutral-500">
                                        {t('platform.description')}
                                    </p>
                                    <RowsTable rows={data.platform_rows} readOnly />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <UsageMetersCard instituteId={instituteId} />
                    <EffectiveLimitsCard instituteId={instituteId} />

                    <LimitRowDialog
                        instituteId={instituteId}
                        open={editing.open}
                        row={editing.row}
                        onOpenChange={(open) => setEditing((s) => ({ ...s, open }))}
                        onSaved={invalidate}
                    />
                    <DeleteRowDialog
                        instituteId={instituteId}
                        row={deleting}
                        onClose={() => setDeleting(null)}
                        onDeleted={invalidate}
                    />
                </>
            )}
        </div>
    );
}
