import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Warning, ArrowDown } from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    fetchInvoiceNumberingState,
    previewInvoiceNumbering,
    type InvoiceNumberingConfig,
} from './invoice-settings-service';

const CONFIRM_WORD = 'CHANGE';

interface Props {
    open: boolean;
    /** The strategy about to be saved. */
    next: InvoiceNumberingConfig;
    /** True when the format uses learner/course values, or the reset window changed. */
    requiresTypedConfirmation: boolean;
    saving: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Shown before saving a changed invoice-number strategy, whenever the institute already has
 * invoices.
 *
 * <p>The change is non-destructive by design — old invoices keep their numbers and the
 * counter continues rather than restarting — so the default gate is a single acknowledgement
 * checkbox. Type-to-confirm is reserved for the genuinely risky cases (learner-based tokens,
 * or changing when the counter resets), because the admins using this screen are
 * non-technical and a friction wall on every edit just trains people to click through.
 */
export function InvoiceNumberingChangeDialog({
    open,
    next,
    requiresTypedConfirmation,
    saving,
    onCancel,
    onConfirm,
}: Props) {
    const { t } = useTranslation('settingsInvoiceNumberingChangeDialog');
    const [acknowledged, setAcknowledged] = useState(false);
    const [typed, setTyped] = useState('');

    const { data: state } = useQuery({
        queryKey: ['invoice-numbering-state'],
        queryFn: fetchInvoiceNumberingState,
        enabled: open,
    });

    const { data: preview } = useQuery({
        queryKey: ['invoice-numbering-change-preview', next],
        queryFn: () => previewInvoiceNumbering(next),
        enabled: open,
    });

    useEffect(() => {
        if (open) {
            setAcknowledged(false);
            setTyped('');
        }
    }, [open]);

    const canConfirm = useMemo(
        () =>
            requiresTypedConfirmation
                ? typed.trim().toUpperCase() === CONFIRM_WORD
                : acknowledged,
        [acknowledged, requiresTypedConfirmation, typed]
    );

    const newExample = preview?.samples?.[0] ?? '—';
    const existingCount = state?.existingInvoiceCount ?? 0;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Before / after. Stacked, not side-by-side: an invoice number can run to
                        100 characters, and a two-column layout truncates exactly the value the
                        admin opened this dialog to check. */}
                    <div className="overflow-hidden rounded-md border border-neutral-200">
                        <div className="space-y-1 p-3">
                            <p className="text-caption font-medium uppercase tracking-wider text-neutral-400">
                                {t('before.label')}
                            </p>
                            {/* Deliberately NOT struck through — that would read as "this
                                invoice is void" rather than "this format is being replaced". */}
                            <code className="block break-all font-mono text-body text-neutral-600">
                                {state?.lastIssuedNumber || state?.currentExample || '—'}
                            </code>
                        </div>
                        <div className="flex items-center gap-2 border-t border-neutral-200 bg-primary-50 p-3">
                            <ArrowDown className="size-4 shrink-0 text-primary-500" />
                            <div className="min-w-0 flex-1 space-y-1">
                                <p className="text-caption font-medium uppercase tracking-wider text-primary-600">
                                    {t('after.label')}
                                </p>
                                <code className="block break-all font-mono text-body font-medium text-primary-700">
                                    {newExample}
                                </code>
                            </div>
                        </div>
                    </div>

                    <p className="text-caption text-neutral-600">
                        {existingCount > 0 ? (
                            <>
                                {t('impact.prefix')}{' '}
                                <span className="font-medium text-neutral-800">
                                    {existingCount.toLocaleString()}
                                </span>{' '}
                                {t('impact.suffix', { count: existingCount })}
                            </>
                        ) : (
                            <>{t('impact.none')}</>
                        )}
                    </p>

                    {requiresTypedConfirmation && (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                            <Warning
                                className="mt-0.5 size-4 shrink-0 text-warning-600"
                                weight="fill"
                            />
                            <p className="text-caption text-warning-700">{t('warning.text')}</p>
                        </div>
                    )}

                    {/* One gate, not two. The risky case escalates to type-to-confirm; the
                        ordinary case is a single checkbox. Asking for both just trains people
                        to click through. */}
                    {requiresTypedConfirmation ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="numbering-confirm" className="text-caption">
                                {t('confirm.instructionPrefix')}{' '}
                                <span className="font-mono font-medium">{CONFIRM_WORD}</span>{' '}
                                {t('confirm.instructionSuffix')}
                            </Label>
                            <Input
                                id="numbering-confirm"
                                value={typed}
                                autoComplete="off"
                                onChange={(e) => setTyped(e.target.value)}
                                placeholder={CONFIRM_WORD}
                            />
                        </div>
                    ) : (
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id="numbering-ack"
                                checked={acknowledged}
                                onCheckedChange={(checked) => setAcknowledged(checked === true)}
                            />
                            <Label
                                htmlFor="numbering-ack"
                                className="text-caption font-normal leading-snug text-neutral-600"
                            >
                                {t('checkbox.label')}
                            </Label>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={saving}>
                        {t('footer.cancel')}
                    </Button>
                    <Button onClick={onConfirm} disabled={!canConfirm || saving}>
                        {saving ? t('footer.saving') : t('footer.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
