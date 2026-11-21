import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { UploadFileInS3 } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    activeCustomFields,
    findActiveMode,
    offlinePaymentDetailsError,
    useOfflinePaymentModes,
    type OfflineExtraField,
    type OfflinePaymentDetails,
} from '@/services/offline-payment-modes';
import { useNumberingField, type NumberingTarget } from '@/services/numbering-field';

interface Props {
    value: OfflinePaymentDetails;
    onChange: (next: OfflinePaymentDetails) => void;
    /** Reports what blocks submitting (translated), or null; only on change. */
    onErrorChange?: (message: string | null) => void;
    /** Show a reference input (hide when the dialog already has its own). Default true. */
    showReference?: boolean;
    /** The dialog's own reference/transaction-id value, when `showReference` is false. */
    externalReference?: string | null;
    /** Show a payment-date input. Default false (most dialogs have their own or use today). */
    showDate?: boolean;
    /** Show a notes input. Default false. */
    showNotes?: boolean;
    /** Smaller text for dense panels (the Enroll wizard's fee panel). */
    compact?: boolean;
    instituteId?: string;
    /**
     * The enrolment / learner this payment is for. When given and the institute numbers
     * receipts by a field (e.g. branch), that field is asked on the enrolment's first payment
     * only; once pinned it is never asked again.
     */
    numbering?: NumberingTarget | null;
}

/**
 * Radix Select items cannot have an empty value, so an optional dropdown offers this as
 * "Not specified"; a required one is left at '' so its placeholder shows. Every
 * onValueChange ignores '' (Radix can emit it from its hidden native select inside a form).
 */
const NONE = '__none__';

/**
 * "How was it paid?" for every admin record-payment dialog: a mode dropdown from the
 * institute's offline payment modes (Settings → Payment Settings), then the mode's options
 * dropdown (the account the money went into, or the app), a reference labelled for the mode,
 * the mode's extra and custom fields (cheque date, bank, branch, cheque status ...) and an
 * optional proof upload. Optional unless the institute requires a mode.
 */
export function OfflinePaymentFields({
    value,
    onChange,
    onErrorChange,
    showReference = true,
    externalReference,
    showDate = false,
    showNotes = false,
    compact = false,
    instituteId,
    numbering,
}: Props) {
    const { t } = useTranslation('commonOfflinePaymentFields');
    const { data: modes, isLoading } = useOfflinePaymentModes(instituteId);
    const { data: numberingInfo } = useNumberingField(numbering, instituteId);
    const askNumbering = !!numberingInfo?.ask;
    const [uploading, setUploading] = useState(false);
    const [proofName, setProofName] = useState<string | null>(null);

    // Preselect what nothing has been chosen for yet (undefined) — also after a parent resets
    // the value on reopen: the institute's default mode, and the learner's own value of the
    // numbering field (profile or lead). Clearing a choice sets null, so this never fights the
    // admin. One effect, one onChange: two would each spread the same stale value and the
    // second would undo the first.
    useEffect(() => {
        const patch: Partial<OfflinePaymentDetails> = {};
        if (modes && value.mode === undefined) {
            patch.mode = findActiveMode(modes, modes.default_mode)?.code ?? null;
        }
        if (askNumbering && value.numbering_value === undefined) {
            const suggested = numberingInfo?.suggested;
            const match = numberingInfo?.options.find(
                (o) => !!suggested && o.toLowerCase() === suggested.trim().toLowerCase()
            );
            patch.numbering_value = match ?? (numberingInfo?.options.length ? null : (suggested ?? null));
        }
        if (Object.keys(patch).length) onChange({ ...value, ...patch });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modes, value.mode, askNumbering, numberingInfo, value.numbering_value]);

    const numberingMissing = askNumbering && !!numberingInfo?.required && !value.numbering_value?.trim();
    const errorKey = offlinePaymentDetailsError(
        showReference ? value : { ...value, reference: externalReference ?? null },
        modes
    );
    const errorText = numberingMissing
        ? t('errors.numberingRequired', { label: numberingInfo?.label || t('numberingLabel') })
        : errorKey
          ? t(errorKey)
          : null;
    // Report on mount and on every change, and clear on unmount: a parent that hides these
    // fields must not keep blocking on an error nobody can see any more.
    const reported = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (reported.current === errorText) return;
        reported.current = errorText;
        onErrorChange?.(errorText);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorText]);
    useEffect(
        () => () => onErrorChange?.(null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    if (isLoading || !modes) {
        return <p className="text-xs text-neutral-500">{t('loading')}</p>;
    }

    const activeModes = modes.modes.filter((m) => m.active);
    const mode = findActiveMode(modes, value.mode);
    const activeSubs = (mode?.sub_modes ?? []).filter((s) => s.active);
    const text = compact ? 'text-2xs' : 'text-xs';
    const set = (patch: Partial<OfflinePaymentDetails>) => onChange({ ...value, ...patch });
    const setExtra = (key: OfflineExtraField, v: string) => set({ extra: { ...(value.extra ?? {}), [key]: v } });
    const setCustom = (key: string, v: string) => set({ custom: { ...(value.custom ?? {}), [key]: v } });
    const customFields = activeCustomFields(mode);
    const requiredExtras = mode?.required_extra_fields ?? [];
    const today = new Date().toLocaleDateString('en-CA');
    const labelClass = cn('mb-1 block font-medium text-neutral-500', text);
    const triggerClass = cn('bg-white', compact ? 'h-8' : 'h-9', text);
    const star = <span className="text-danger-600"> *</span>;

    const uploadProof = async (file: File) => {
        const id = getCurrentInstituteId() ?? '';
        const fileId = await UploadFileInS3(file, setUploading, getUserId(), 'INSTITUTE', id, false);
        if (fileId) {
            setProofName(file.name);
            set({ proof_file_id: fileId });
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {askNumbering && (
                <div>
                    <Label className={labelClass}>
                        {numberingInfo?.label || t('numberingLabel')}
                        {numberingInfo?.required && star}
                    </Label>
                    {numberingInfo && numberingInfo.options.length > 0 ? (
                        <Select
                            value={value.numbering_value || (numberingInfo.required ? '' : NONE)}
                            onValueChange={(v) => v && set({ numbering_value: v === NONE ? null : v })}
                        >
                            <SelectTrigger
                                aria-label={numberingInfo.label || t('numberingLabel')}
                                className={cn(triggerClass, 'max-w-sm')}
                            >
                                <SelectValue placeholder={t('selectPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent className="z-popover-above-modal">
                                {!numberingInfo.required && <SelectItem value={NONE}>{t('notSpecified')}</SelectItem>}
                                {numberingInfo.options.map((o) => (
                                    <SelectItem key={o} value={o}>
                                        {o}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            value={value.numbering_value ?? ''}
                            onChange={(e) => set({ numbering_value: e.target.value })}
                            className={cn('max-w-sm', text)}
                        />
                    )}
                    <p className={cn('mt-1 text-neutral-500', compact ? 'text-2xs' : 'text-xs')}>
                        {t('numberingHint')}
                    </p>
                </div>
            )}
            <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-48 flex-1">
                    <Label className={labelClass}>
                        {t('modeLabel')}
                        {modes.require_mode && star}
                    </Label>
                    <Select
                        value={value.mode ?? (modes.require_mode ? '' : NONE)}
                        onValueChange={(v) =>
                            v && set({ mode: v === NONE ? null : v, sub_mode: null, extra: {}, custom: {} })
                        }
                    >
                        <SelectTrigger aria-label={t('modeLabel')} className={triggerClass}>
                            <SelectValue placeholder={t('modePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent className="z-popover-above-modal">
                            {!modes.require_mode && <SelectItem value={NONE}>{t('notSpecified')}</SelectItem>}
                            {activeModes
                                .filter((m) => m.code)
                                .map((m) => (
                                    <SelectItem key={m.code!} value={m.code!}>
                                        {m.label}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                </div>

                {mode && activeSubs.length > 0 && (
                    <div className="min-w-48 flex-1">
                        <Label className={labelClass}>
                            {mode.sub_mode_label || t('subModeLabel')}
                            {mode.sub_mode_required && star}
                        </Label>
                        <Select
                            value={value.sub_mode ?? (mode.sub_mode_required ? '' : NONE)}
                            onValueChange={(v) => v && set({ sub_mode: v === NONE ? null : v })}
                        >
                            <SelectTrigger aria-label={mode.sub_mode_label || t('subModeLabel')} className={triggerClass}>
                                <SelectValue placeholder={t('subModePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent className="z-popover-above-modal">
                                {!mode.sub_mode_required && <SelectItem value={NONE}>{t('notSpecified')}</SelectItem>}
                                {activeSubs
                                    .filter((sub) => sub.code)
                                    .map((sub) => (
                                        <SelectItem key={sub.code!} value={sub.code!}>
                                            {sub.label}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-start gap-3">
                {showReference && (
                    <div className="min-w-40 flex-1">
                        <Label className={labelClass}>
                            {mode?.reference_label || t('referenceLabel')}
                            {mode?.reference_required && star}
                        </Label>
                        <Input
                            value={value.reference ?? ''}
                            onChange={(e) => set({ reference: e.target.value })}
                            placeholder={t('referencePlaceholder')}
                            className={text}
                        />
                    </div>
                )}
                {showDate && (
                    <div>
                        <Label className={labelClass}>{t('dateLabel')}</Label>
                        <Input
                            type="date"
                            max={today}
                            value={value.payment_date ?? ''}
                            onChange={(e) => set({ payment_date: e.target.value || null })}
                            className={cn('w-40', text)}
                        />
                    </div>
                )}
                {(mode?.extra_fields ?? []).map((f) => (
                    <div key={f} className={f === 'cheque_date' ? '' : 'min-w-40 flex-1'}>
                        <Label className={labelClass}>
                            {t(`extra.${f}`)}
                            {requiredExtras.includes(f) && star}
                        </Label>
                        <Input
                            type={f === 'cheque_date' ? 'date' : 'text'}
                            value={value.extra?.[f] ?? ''}
                            onChange={(e) => setExtra(f, e.target.value)}
                            className={cn(f === 'cheque_date' ? 'w-40' : '', text)}
                        />
                    </div>
                ))}
                {customFields.map((f) => (
                    <div key={f.key!} className={f.type === 'DATE' ? '' : 'min-w-40 flex-1'}>
                        <Label className={labelClass}>
                            {f.label}
                            {f.required && star}
                        </Label>
                        {f.type === 'SELECT' ? (
                            <Select
                                value={value.custom?.[f.key!] || (f.required ? '' : NONE)}
                                onValueChange={(v) => v && setCustom(f.key!, v === NONE ? '' : v)}
                            >
                                <SelectTrigger aria-label={f.label} className={triggerClass}>
                                    <SelectValue placeholder={t('selectPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent className="z-popover-above-modal">
                                    {!f.required && <SelectItem value={NONE}>{t('notSpecified')}</SelectItem>}
                                    {(f.options ?? []).map((o) => (
                                        <SelectItem key={o} value={o}>
                                            {o}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input
                                type={f.type === 'DATE' ? 'date' : 'text'}
                                inputMode={f.type === 'NUMBER' ? 'decimal' : undefined}
                                value={value.custom?.[f.key!] ?? ''}
                                onChange={(e) =>
                                    f.type === 'NUMBER' && !/^-?\d*\.?\d*$/.test(e.target.value)
                                        ? undefined
                                        : setCustom(f.key!, e.target.value)
                                }
                                className={cn(f.type === 'DATE' ? 'w-40' : '', text)}
                            />
                        )}
                    </div>
                ))}
            </div>

            {showNotes && (
                <div>
                    <Label className={labelClass}>{t('notesLabel')}</Label>
                    <Input value={value.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className={text} />
                </div>
            )}

            {mode && (
                <div className={cn('flex flex-wrap items-center gap-2 text-neutral-600', text)}>
                    <label className="cursor-pointer font-medium text-primary-600 hover:underline">
                        {value.proof_file_id ? t('proof.replace') : t('proof.attach')}
                        {mode.proof_required && star}
                        <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadProof(file);
                                e.target.value = '';
                            }}
                        />
                    </label>
                    {uploading && <span>{t('proof.uploading')}</span>}
                    {!uploading && value.proof_file_id && (
                        <span>
                            {proofName ?? t('proof.attached')}{' '}
                            <button
                                type="button"
                                onClick={() => {
                                    setProofName(null);
                                    set({ proof_file_id: null });
                                }}
                                className="text-neutral-500 hover:underline"
                            >
                                {t('proof.remove')}
                            </button>
                        </span>
                    )}
                </div>
            )}

            {errorText && (
                <p role="alert" className={cn('font-medium text-danger-600', text)}>
                    {errorText}
                </p>
            )}
        </div>
    );
}
