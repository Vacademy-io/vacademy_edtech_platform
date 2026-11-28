/**
 * Add / edit one TENANT limit row. Saving is only offered after "Preview
 * impact" has been run for exactly the values on screen, so an admin always
 * sees what the rule would have done over the last 30 days before it exists.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformBrand } from '@/lib/platform-brand';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getAllRoles } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { NON_LEARNER_SYSTEM_ROLES } from '../../-constants/assistant-tools';
import { useUsageSummaryQuery } from '@/services/ai-credits/usage-v2';
import {
    KNOWN_FEATURE_GROUPS,
    LIMITABLE_ROLE_CLASSES,
    SCOPE_KINDS,
    SUBJECT_KINDS,
    TENANT_METRICS,
    TENANT_PERIODS,
    apiErrorMessage,
    cleanDraft,
    createLimitRow,
    normalizeRoleName,
    previewLimits,
    updateLimitRow,
    type LimitDraft,
    type LimitRow,
    type LimitsPreview,
} from '../../-services/ai-limits-service';
import { featureGroupLabel, prettyKey, roleClassLabel, roleLabel } from './limit-labels';
import { LimitPreviewPanel } from './LimitPreviewPanel';

/** Catalog options come from 90 days of usage (no tenant catalog endpoint). */
const OPTION_DAYS = 90;

const EMPTY_DRAFT: LimitDraft = {
    subject_kind: 'ROLE_CLASS',
    subject_value: 'LEARNER',
    per_member: true,
    scope_kind: 'ALL',
    scope_value: null,
    period: 'DAY',
    metric: 'CREDITS',
    soft_limit: null,
    hard_limit: null,
};

const draftFromRow = (row: LimitRow): LimitDraft => ({
    subject_kind: row.subject_kind,
    subject_value: row.subject_value,
    per_member: row.per_member,
    scope_kind: row.scope_kind,
    scope_value: row.scope_value,
    period: row.period,
    metric: row.metric,
    soft_limit: row.soft_limit,
    hard_limit: row.hard_limit,
});

const parseLimit = (s: string): number | null => {
    const v = s.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
};

/** SearchableSelect matches on label, so equal labels need telling apart. */
function uniqueLabels(options: SearchableSelectOption[]): SearchableSelectOption[] {
    const seen = new Map<string, number>();
    options.forEach((o) => seen.set(o.label, (seen.get(o.label) ?? 0) + 1));
    return options.map((o) =>
        (seen.get(o.label) ?? 0) > 1 ? { ...o, label: `${o.label} · ${o.value.slice(0, 8)}` } : o
    );
}

interface Props {
    instituteId: string;
    open: boolean;
    /** null = add a new row. */
    row: LimitRow | null;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

export function LimitRowDialog({ instituteId, open, row, onOpenChange, onSaved }: Props) {
    const { t } = useTranslation('settingsAiLimits');
    const brand = usePlatformBrand(instituteId);
    const [draft, setDraft] = useState<LimitDraft>(EMPTY_DRAFT);
    const [softText, setSoftText] = useState('');
    const [hardText, setHardText] = useState('');
    const [reason, setReason] = useState('');
    const [typedUseCase, setTypedUseCase] = useState(false);
    // The preview is tied to the exact draft it was run for (key), so a late
    // answer for an older draft can never be shown against newer values.
    const [preview, setPreview] = useState<{
        key: string;
        loading: boolean;
        data: LimitsPreview | null;
        error: string | null;
    } | null>(null);
    const [saving, setSaving] = useState(false);
    const fieldId = useId();

    // Reset the form whenever the dialog opens.
    useEffect(() => {
        if (!open) return;
        const d = row ? draftFromRow(row) : EMPTY_DRAFT;
        setDraft(d);
        setSoftText(d.soft_limit === null ? '' : String(d.soft_limit));
        setHardText(d.hard_limit === null ? '' : String(d.hard_limit));
        setReason('');
        setTypedUseCase(false);
        setPreview(null);
    }, [open, row]);

    const usersQ = useUsageSummaryQuery(instituteId, OPTION_DAYS, 'user', 'list', open);
    const useCasesQ = useUsageSummaryQuery(instituteId, OPTION_DAYS, 'use_case', 'list', open);
    const groupsQ = useUsageSummaryQuery(instituteId, OPTION_DAYS, 'feature_group', 'list', open);
    const rolesQ = useQuery({
        queryKey: ['custom-roles'],
        queryFn: getAllRoles,
        enabled: open,
        retry: false,
    });

    const roleOptions = useMemo<SearchableSelectOption[]>(() => {
        const names = new Set<string>(NON_LEARNER_SYSTEM_ROLES.map(normalizeRoleName));
        names.add('STUDENT');
        for (const r of (rolesQ.data as Array<{ name?: string }> | undefined) ?? []) {
            if (r?.name) names.add(normalizeRoleName(r.name));
        }
        if (row?.subject_kind === 'ROLE' && row.subject_value) names.add(row.subject_value);
        return Array.from(names)
            .sort()
            .map((n) => ({ value: n, label: roleLabel(n) }));
    }, [rolesQ.data, row]);

    const userOptions = useMemo<SearchableSelectOption[]>(() => {
        const opts = (usersQ.data?.rows ?? [])
            .filter((r) => !!r.key)
            .map((r) => ({ value: r.key, label: r.label || r.key }));
        if (
            row?.subject_kind === 'USER' &&
            row.subject_value &&
            !opts.some((o) => o.value === row.subject_value)
        ) {
            opts.unshift({
                value: row.subject_value,
                label: row.subject_label || row.subject_value,
            });
        }
        return uniqueLabels(opts);
    }, [usersQ.data, row]);

    const groupOptions = useMemo<SearchableSelectOption[]>(() => {
        const labels = new Map<string, string>();
        KNOWN_FEATURE_GROUPS.forEach((g) => labels.set(g, featureGroupLabel(t, g)));
        (groupsQ.data?.rows ?? []).forEach((r) => {
            if (r.key && r.key !== 'platform')
                labels.set(r.key, r.label || featureGroupLabel(t, r.key));
        });
        if (row?.scope_kind === 'GROUP' && row.scope_value && !labels.has(row.scope_value)) {
            labels.set(row.scope_value, row.scope_label || featureGroupLabel(t, row.scope_value));
        }
        return uniqueLabels(Array.from(labels, ([value, label]) => ({ value, label })));
    }, [groupsQ.data, row, t]);

    const useCaseOptions = useMemo<SearchableSelectOption[]>(() => {
        const opts = (useCasesQ.data?.rows ?? [])
            .filter((r) => !!r.key && r.key !== 'unknown')
            .map((r) => ({ value: r.key, label: r.label || prettyKey(r.key) }));
        if (
            row?.scope_kind === 'USE_CASE' &&
            row.scope_value &&
            !opts.some((o) => o.value === row.scope_value)
        ) {
            opts.unshift({
                value: row.scope_value,
                label: row.scope_label || prettyKey(row.scope_value),
            });
        }
        return uniqueLabels(opts);
    }, [useCasesQ.data, row]);

    const set = <K extends keyof LimitDraft>(k: K, v: LimitDraft[K]) =>
        setDraft((d) => ({ ...d, [k]: v }));

    const soft = parseLimit(softText);
    const hard = parseLimit(hardText);
    const current: LimitDraft = cleanDraft({ ...draft, soft_limit: soft, hard_limit: hard });
    const currentKey = JSON.stringify(current);

    // ---- validation ----
    const errors: string[] = [];
    if (current.subject_kind !== 'INSTITUTE' && !current.subject_value)
        errors.push(t('dialog.errors.subject'));
    if (current.scope_kind !== 'ALL' && !current.scope_value) errors.push(t('dialog.errors.scope'));
    if (Number.isNaN(soft) || Number.isNaN(hard)) errors.push(t('dialog.errors.number'));
    else {
        if ((soft !== null && soft < 0) || (hard !== null && hard < 0))
            errors.push(t('dialog.errors.negative'));
        if (soft !== null && hard !== null && soft > hard)
            errors.push(t('dialog.errors.softAboveHard'));
        if (soft === null && hard === null && current.subject_kind !== 'USER')
            errors.push(t('dialog.errors.noLimit'));
    }
    const valid = errors.length === 0;
    const previewDone = preview?.key === currentKey && !preview.loading;
    const canSave = valid && previewDone && reason.trim().length > 0 && !saving;

    const runPreview = () => {
        if (!valid) return;
        const key = currentKey;
        setPreview({ key, loading: true, data: null, error: null });
        previewLimits(instituteId, [{ ...current, ...(row ? { id: row.id } : {}) }])
            .then((data) =>
                setPreview((p) => (p?.key === key ? { key, loading: false, data, error: null } : p))
            )
            .catch((err) =>
                setPreview((p) =>
                    p?.key === key
                        ? {
                              key,
                              loading: false,
                              data: null,
                              error: apiErrorMessage(err) || t('preview.unavailable'),
                          }
                        : p
                )
            );
    };
    const previewForDraft = preview?.key === currentKey ? preview : null;

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            if (row) await updateLimitRow(instituteId, row.id, current, reason.trim());
            // (PATCH carries the soft / hard limit only; the other fields are locked below.)
            else await createLimitRow(instituteId, current, reason.trim());
            toast.success(row ? t('toasts.rowUpdated') : t('toasts.rowCreated'));
            onSaved();
            onOpenChange(false);
        } catch (err) {
            toast.error(apiErrorMessage(err) || t('toasts.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const isRole = draft.subject_kind === 'ROLE' || draft.subject_kind === 'ROLE_CLASS';
    // An existing row only takes new soft / hard numbers (contract N5 PATCH).
    const fixed = !!row;
    const unit = draft.metric === 'COUNT' ? t('unit.requests') : t('unit.credits');

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={row ? t('dialog.editTitle') : t('dialog.addTitle')}
            dialogWidth="max-w-3xl"
            footerLeft={
                !previewDone && valid ? (
                    <span className="text-caption text-neutral-500">
                        {t('dialog.previewFirst')}
                    </span>
                ) : null
            }
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={runPreview}
                        disable={!valid || !!previewForDraft?.loading}
                    >
                        {t('actions.previewImpact')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onClick={save} disable={!canSave}>
                        {saving ? t('actions.saving') : t('actions.save')}
                    </MyButton>
                </>
            }
        >
            <div className="space-y-5">
                {fixed && (
                    <p className="rounded-lg bg-neutral-50 p-3 text-caption text-neutral-600">
                        {t('dialog.editNote')}
                    </p>
                )}
                {/* Who */}
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label>{t('dialog.subjectKind')}</Label>
                        <Select
                            value={draft.subject_kind}
                            disabled={fixed}
                            onValueChange={(v) =>
                                setDraft((d) => ({
                                    ...d,
                                    subject_kind: v as LimitDraft['subject_kind'],
                                    subject_value: v === 'ROLE_CLASS' ? 'LEARNER' : null,
                                }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SUBJECT_KINDS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`subjectKind.${k}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        {draft.subject_kind === 'ROLE_CLASS' && (
                            <>
                                <Label>{t('dialog.roleClass')}</Label>
                                <Select
                                    value={draft.subject_value ?? ''}
                                    onValueChange={(v) => set('subject_value', v)}
                                    disabled={fixed}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('dialog.pick')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LIMITABLE_ROLE_CLASSES.map((rc) => (
                                            <SelectItem key={rc} value={rc}>
                                                {roleClassLabel(t, rc)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </>
                        )}
                        {draft.subject_kind === 'ROLE' && (
                            <>
                                <Label>{t('dialog.role')}</Label>
                                <SearchableSelect
                                    options={roleOptions}
                                    value={draft.subject_value ?? ''}
                                    onChange={(v) => set('subject_value', v)}
                                    disabled={fixed}
                                    placeholder={t('dialog.pick')}
                                    searchPlaceholder={t('dialog.search')}
                                    emptyText={t('dialog.noMatches')}
                                    portal={false}
                                />
                                <p className="text-caption text-neutral-500">
                                    {t('dialog.roleHint', brand.vars)}
                                </p>
                            </>
                        )}
                        {draft.subject_kind === 'USER' && (
                            <>
                                <Label>{t('dialog.user')}</Label>
                                <SearchableSelect
                                    options={userOptions}
                                    value={draft.subject_value ?? ''}
                                    onChange={(v) => set('subject_value', v)}
                                    disabled={fixed}
                                    placeholder={
                                        usersQ.isLoading
                                            ? t('dialog.loading')
                                            : t('dialog.pickUser')
                                    }
                                    searchPlaceholder={t('dialog.searchUser')}
                                    emptyText={t('dialog.noUsers')}
                                    portal={false}
                                />
                                <p className="text-caption text-neutral-500">
                                    {t('dialog.userHint')}
                                </p>
                            </>
                        )}
                        {draft.subject_kind === 'INSTITUTE' && (
                            <p className="pt-6 text-caption text-neutral-500">
                                {t('dialog.instituteHint')}
                            </p>
                        )}
                    </div>
                </div>

                {isRole && (
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-700">
                                {t('dialog.perMember')}
                            </div>
                            <div className="text-caption text-neutral-500">
                                {draft.per_member
                                    ? t('dialog.perMemberOn')
                                    : t('dialog.perMemberOff')}
                            </div>
                        </div>
                        <Switch
                            checked={draft.per_member}
                            onCheckedChange={(v) => set('per_member', v)}
                            disabled={fixed}
                        />
                    </div>
                )}

                {/* What */}
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label>{t('dialog.scopeKind')}</Label>
                        <Select
                            value={draft.scope_kind}
                            disabled={fixed}
                            onValueChange={(v) =>
                                setDraft((d) => ({
                                    ...d,
                                    scope_kind: v as LimitDraft['scope_kind'],
                                    scope_value: null,
                                }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SCOPE_KINDS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`scopeKind.${k}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        {draft.scope_kind === 'GROUP' && (
                            <>
                                <Label>{t('dialog.group')}</Label>
                                <SearchableSelect
                                    options={groupOptions}
                                    value={draft.scope_value ?? ''}
                                    onChange={(v) => set('scope_value', v)}
                                    disabled={fixed}
                                    placeholder={t('dialog.pick')}
                                    searchPlaceholder={t('dialog.search')}
                                    emptyText={t('dialog.noMatches')}
                                    portal={false}
                                />
                            </>
                        )}
                        {draft.scope_kind === 'USE_CASE' && (
                            <>
                                <Label>{t('dialog.useCase')}</Label>
                                {typedUseCase ? (
                                    <Input
                                        disabled={fixed}
                                        value={draft.scope_value ?? ''}
                                        onChange={(e) =>
                                            set(
                                                'scope_value',
                                                e.target.value.trim().toLowerCase() || null
                                            )
                                        }
                                        placeholder={t('dialog.useCaseKeyPlaceholder')}
                                    />
                                ) : (
                                    <SearchableSelect
                                        options={useCaseOptions}
                                        value={draft.scope_value ?? ''}
                                        onChange={(v) => set('scope_value', v)}
                                        disabled={fixed}
                                        placeholder={
                                            useCasesQ.isLoading
                                                ? t('dialog.loading')
                                                : t('dialog.pick')
                                        }
                                        searchPlaceholder={t('dialog.search')}
                                        emptyText={t('dialog.noUseCases')}
                                        portal={false}
                                    />
                                )}
                                {!fixed && (
                                    <button
                                        type="button"
                                        className="text-caption text-primary-500 hover:underline"
                                        onClick={() => setTypedUseCase((v) => !v)}
                                    >
                                        {typedUseCase
                                            ? t('dialog.pickFromList')
                                            : t('dialog.typeKey')}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* How much */}
                <div className="grid gap-3 sm:grid-cols-4">
                    <div className="space-y-1.5">
                        <Label>{t('dialog.period')}</Label>
                        <Select
                            value={draft.period}
                            onValueChange={(v) => set('period', v as LimitDraft['period'])}
                            disabled={fixed}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TENANT_PERIODS.map((p) => (
                                    <SelectItem key={p} value={p}>
                                        {t(`period.${p}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>{t('dialog.metric')}</Label>
                        <Select
                            value={draft.metric}
                            onValueChange={(v) => set('metric', v as LimitDraft['metric'])}
                            disabled={fixed}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TENANT_METRICS.map((m) => (
                                    <SelectItem key={m} value={m}>
                                        {t(`metric.${m}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={`${fieldId}-soft`}>{t('dialog.soft', { unit })}</Label>
                        <Input
                            id={`${fieldId}-soft`}
                            inputMode="decimal"
                            value={softText}
                            onChange={(e) => setSoftText(e.target.value)}
                            placeholder={t('dialog.optional')}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={`${fieldId}-hard`}>{t('dialog.hard', { unit })}</Label>
                        <Input
                            id={`${fieldId}-hard`}
                            inputMode="decimal"
                            value={hardText}
                            onChange={(e) => setHardText(e.target.value)}
                            placeholder={t('dialog.optional')}
                        />
                    </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-neutral-50 p-3 text-caption text-neutral-600">
                    <Info className="mt-0.5 size-4 shrink-0 text-primary-500" />
                    <span>
                        {t('dialog.limitsHelp')}
                        {hard === 0 && <strong className="block">{t('dialog.hardZero')}</strong>}
                        {current.subject_kind === 'USER' && hard === null && (
                            <strong className="block">{t('dialog.userExempt')}</strong>
                        )}
                    </span>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor={`${fieldId}-reason`}>{t('dialog.reason')}</Label>
                    <Textarea
                        id={`${fieldId}-reason`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('dialog.reasonPlaceholder')}
                        rows={2}
                        maxLength={500}
                    />
                </div>

                {!valid && (softText || hardText || draft.subject_value || draft.scope_value) && (
                    <ul className="list-inside list-disc text-caption text-danger-600">
                        {errors.map((e) => (
                            <li key={e}>{e}</li>
                        ))}
                    </ul>
                )}

                <LimitPreviewPanel
                    preview={previewForDraft?.data ?? null}
                    isLoading={!!previewForDraft?.loading}
                    error={previewForDraft?.error ?? null}
                />
            </div>
        </MyDialog>
    );
}
