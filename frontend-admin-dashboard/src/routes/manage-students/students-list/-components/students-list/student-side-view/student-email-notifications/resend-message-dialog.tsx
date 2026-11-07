import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, CircleNotch, PencilSimple, WarningCircle } from '@phosphor-icons/react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { WhatsAppTemplatePreview } from '@/components/templates/WhatsAppTemplatePreview';
import { variableNameFor } from '@/components/templates/template-text';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import { resendCommunication } from '@/services/communication-resend-service';
import type { CommunicationItem } from '@/services/communication-timeline-service';
import { cn } from '@/lib/utils';

/**
 * Send a message from this student's timeline a second time.
 *
 * A resend is a real message to a real learner, so it never fires straight off the row's button:
 * this dialog shows what is about to go out, to whom, and asks. When the original send carried
 * template variables it also offers the only other thing an admin ever wants here — the same
 * template with different values (a corrected name, a new date) rather than a verbatim repeat.
 *
 * Both channels reuse the stored send rather than rebuilding it:
 *   - WhatsApp replays the template by name with the `bodyParams` the original send recorded.
 *   - Email replays the rendered HTML and the subject the send stored beside it.
 */

/** Placeholder shape the email send path interpolates — `{{word}}`, no inner spaces. */
const EMAIL_PLACEHOLDER_SOURCE = '\\{\\{(\\w+)\\}\\}';

/** Media header kinds the send API accepts; a TEXT/NONE header carries no URL to thread through. */
const MEDIA_HEADERS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

export type ResendMode = 'SAME' | 'EDIT';

/**
 * Why a row cannot be resent, or null when it can.
 *
 * 'inbound' is the only reason the timeline hides the button outright — resending a message the
 * learner sent us is not a thing anyone wants. Every other reason keeps the button on screen but
 * disabled, so an admin scanning the tab learns that resending exists and why this one row is
 * exempt, instead of finding nothing and assuming the feature is missing.
 */
export function resendBlockedReason(item: CommunicationItem): string | null {
    if (item.direction !== 'OUTBOUND') return 'inbound';
    if (item.channel === 'WHATSAPP') {
        // The send API only speaks templates. A free-text reply typed in the Inbox has no template
        // to replay, and WhatsApp would refuse it anyway outside the 24h session window.
        return item.templateName ? null : 'noTemplate';
    }
    if (item.channel === 'EMAIL') {
        return item.fullBody ? null : 'noBody';
    }
    return 'unsupportedChannel';
}

/**
 * The keys of `values` that fill the template's own placeholders — the ones Meta needs non-empty.
 * A send may carry extra keys the template never uses; those are left alone. Without the template
 * there is nothing to check against, so nothing is required.
 */
export function requiredVariableKeys(
    values: Record<string, string>,
    whatsappTemplate?: { bodyText?: string; bodyVariableNames?: string[] } | null
): string[] {
    const keys: string[] = [];
    for (const token of declaredTokens(whatsappTemplate?.bodyText)) {
        const key = keyForToken(values, token, whatsappTemplate?.bodyVariableNames);
        if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
}

export function canResend(item: CommunicationItem): boolean {
    return resendBlockedReason(item) === null;
}

/** Whether the row should carry a resend control at all, enabled or not. */
export function showsResendControl(item: CommunicationItem): boolean {
    return resendBlockedReason(item) !== 'inbound';
}

/** String values only — `bodyParams` arrives as unknown off the parsed message payload. */
function toStringMap(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') continue;
        out[key] = String(value);
    }
    return out;
}

/** How the send path matches a named variable to a template position (UnifiedSendService). */
const sendPathName = (name: string) =>
    name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');

/** The placeholders a WhatsApp template body declares, in order, each once. */
function declaredTokens(templateBody: string | undefined): string[] {
    const tokens: string[] = [];
    for (const match of (templateBody ?? '').matchAll(new RegExp(EMAIL_PLACEHOLDER_SOURCE, 'g'))) {
        if (match[1] && !tokens.includes(match[1])) tokens.push(match[1]);
    }
    return tokens;
}

/**
 * The key in `values` that fills a template placeholder: its position (`1`), or its name from
 * `bodyVariableNames` — the send path resolves both, so a send may have stored either.
 */
function keyForToken(values: Record<string, string>, token: string, variableNames?: string[]) {
    if (token in values) return token;
    const name = sendPathName(variableNameFor(token, variableNames));
    return Object.keys(values).find((key) => sendPathName(key) === name);
}

/**
 * The variables the original send used, keyed exactly as it stored them.
 *
 * WhatsApp records them as a map on the send payload — positional (`1`) or named (`name`) — so
 * they come back with their values. Given the approved template, a placeholder the send stored
 * under neither key (a workflow node with no mapping stores `bodyParams: {}`) is added empty, for
 * the admin to fill in: otherwise there would be nothing to edit, and resending the same would
 * fail at Meta exactly as the original did.
 *
 * Email stores the body already rendered, so the only variables left are placeholders nothing
 * resolved at send time — those come back empty, for the admin to fill in on a resend.
 */
export function originalVariables(
    item: CommunicationItem,
    emailSubject: string,
    whatsappTemplate?: { bodyText?: string; bodyVariableNames?: string[] }
) {
    if (item.channel === 'WHATSAPP') {
        const params = toStringMap(item.metadata?.bodyParams);
        // Internal send-path keys, not template variables — they carry the media URL and button
        // link and are threaded through as options instead of shown as editable fields.
        const stored = Object.fromEntries(
            Object.entries(params).filter(([k]) => !k.startsWith('_'))
        );
        const namedSend = Object.keys(stored).some((key) => !/^\d+$/.test(key));
        const missing: Record<string, string> = {};
        for (const token of declaredTokens(whatsappTemplate?.bodyText)) {
            if (keyForToken(stored, token, whatsappTemplate?.bodyVariableNames)) continue;
            // Match the send's own style, so the resend is not half named, half positional.
            const name = variableNameFor(token, whatsappTemplate?.bodyVariableNames);
            missing[namedSend ? name : token] = '';
        }
        return { ...stored, ...missing };
    }

    const names = new Set<string>();
    for (const text of [emailSubject, item.fullBody ?? '']) {
        // A fresh regex per pass — a shared /g one carries lastIndex across calls.
        for (const match of text.matchAll(new RegExp(EMAIL_PLACEHOLDER_SOURCE, 'g'))) {
            if (match[1]) names.add(match[1]);
        }
    }
    return Object.fromEntries([...names].map((name) => [name, '']));
}

interface ResendMessageDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: CommunicationItem;
    instituteId: string;
    /** Subject to replay — the one the send stored, else the one the timeline displays. */
    emailSubject: string;
    userId?: string;
    recipientName?: string;
    /** Called after the provider accepted the resend, so the timeline can refetch. */
    onSent: () => void;
}

export function ResendMessageDialog({
    open,
    onOpenChange,
    item,
    instituteId,
    emailSubject,
    userId,
    recipientName,
    onSent,
}: ResendMessageDialogProps) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const isWhatsApp = item.channel === 'WHATSAPP';

    const [mode, setMode] = useState<ResendMode>('SAME');
    const [isSending, setIsSending] = useState(false);

    // The approved template, for the variable labels, the live preview, and the placeholders the
    // original send may have left out. Only WhatsApp has one; an email's body is stored already
    // rendered. A failed lookup is not fatal — the resend still works off the stored params, it
    // just shows the positional token as the field label.
    const { data: template } = useQuery({
        queryKey: ['wa-template-for-resend', instituteId, item.templateName],
        queryFn: async (): Promise<WhatsAppTemplateDTO | null> => {
            const all = await listTemplates(instituteId, 'WHATSAPP');
            return all.find((tpl) => tpl.name === item.templateName) ?? null;
        },
        enabled: open && isWhatsApp && !!instituteId && !!item.templateName,
        staleTime: 300000,
    });

    const initialVariables = useMemo(
        () => originalVariables(item, emailSubject, template ?? undefined),
        [item, emailSubject, template]
    );
    const variableKeys = Object.keys(initialVariables);
    const hasVariables = variableKeys.length > 0;
    const [values, setValues] = useState<Record<string, string>>(initialVariables);

    // WhatsApp variables the first send went out without. Meta rejects a template message with an
    // empty variable, so "resend the same" cannot work — go straight to editing them.
    const requiredKeys = isWhatsApp ? requiredVariableKeys(initialVariables, template) : [];
    const missingKeys = requiredKeys.filter((key) => !initialVariables[key]?.trim());
    const sameBlocked = missingKeys.length > 0;
    useEffect(() => {
        if (sameBlocked && mode === 'SAME') {
            setValues(initialVariables);
            setMode('EDIT');
        }
    }, [sameBlocked, mode, initialVariables]);

    const effectiveValues = mode === 'EDIT' ? values : initialVariables;
    const blankWhatsappVariables = requiredKeys.some((key) => !(effectiveValues[key] ?? '').trim());

    const labelFor = (key: string) =>
        isWhatsApp ? variableNameFor(key, template?.bodyVariableNames) : key;

    const handleSend = async () => {
        if (!instituteId) {
            toast.error(t('resend.noInstitute'));
            return;
        }
        if (!item.recipientInfo) {
            toast.error(t('resend.noRecipient'));
            return;
        }

        setIsSending(true);
        try {
            const variables = Object.keys(effectiveValues).length > 0 ? effectiveValues : undefined;
            const headerKind = (item.headerType ?? '').toUpperCase();
            const response = await resendCommunication({
                instituteId,
                channel: isWhatsApp ? 'WHATSAPP' : 'EMAIL',
                sourceLogId: item.id,
                recipient: item.recipientInfo,
                recipientUserId: userId,
                recipientName,
                variables,
                // The audit sentence distinguishes a duplicate from a correction.
                variablesChanged: mode === 'EDIT',
                ...(isWhatsApp
                    ? {
                          templateName: item.templateName!,
                          languageCode:
                              (item.metadata?.languageCode as string | undefined) ||
                              template?.language ||
                              'en',
                          // Meta rejects a media-header template that arrives without its header
                          // component, so replay the same attachment the original send carried.
                          ...(MEDIA_HEADERS.has(headerKind) && item.headerMediaUrl
                              ? { headerType: headerKind, headerUrl: item.headerMediaUrl }
                              : {}),
                      }
                    : { emailSubject, emailBody: item.fullBody ?? '' }),
            });

            // A refused recipient rides back inside a 200 with failed: 1, so the counts are the
            // truth here, not the promise resolving.
            if (response.failed > 0 || response.status === 'FAILED') {
                const reason = response.results?.find((r) => !r.success)?.error;
                toast.error(
                    reason ? t('resend.rejectedWithReason', { reason }) : t('resend.rejected')
                );
                return;
            }

            toast.success(isWhatsApp ? t('resend.whatsappQueued') : t('resend.emailSent'));
            onSent();
            onOpenChange(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('resend.failed'));
        } finally {
            setIsSending(false);
        }
    };

    const channelLabel = t(`channels.${item.channel}`);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                // A close mid-send would leave the admin with no idea whether it went. Hold it open.
                if (!isSending) onOpenChange(next);
            }}
        >
            {/* w-dialog-md, not max-w-*: DialogContent's base class sets a FIXED 400px width, so a
                max-width only raises a ceiling the dialog never reaches — it stayed 400px wide and
                cramped. max-h-dialog-tall caps the height so the footer stays on screen instead of
                being pushed past the fold. */}
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-sm">
                        <ArrowClockwise className="size-4 text-primary-500" />
                        {t('resend.title', { channel: channelLabel })}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        {t('resend.confirmQuestion', {
                            channel: channelLabel,
                            recipient: item.recipientInfo,
                        })}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {/* What is going out: template name for WhatsApp, subject line for email. */}
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5 text-xs">
                        <div className="flex gap-2">
                            <span className="shrink-0 font-medium text-neutral-500">
                                {isWhatsApp
                                    ? t('expandedDetail.templateLabel')
                                    : t('resend.subjectLabel')}
                            </span>
                            <span className="break-words font-medium text-neutral-800">
                                {isWhatsApp ? item.templateName : emailSubject}
                            </span>
                        </div>
                        <div className="mt-1 flex gap-2">
                            <span className="shrink-0 font-medium text-neutral-500">
                                {t('expandedDetail.toLabel')}
                            </span>
                            <span className="break-words text-neutral-700">
                                {item.recipientInfo}
                            </span>
                        </div>
                    </div>

                    {/* Preview first: in the default "resend the same" case it is the whole
                        answer to "are you sure", so it must not sit below the fold. WhatsApp
                        re-renders live off the values below; an email's body already went out
                        rendered, so that HTML is shown as-is. */}
                    {(isWhatsApp ? !!template : !!item.fullBody) && (
                        <div>
                            <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-neutral-500">
                                {t('resend.previewHeading')}
                            </p>
                            {/* Scrolls itself. A long template body (the UnlockX one runs to nine
                                lines) otherwise pushes the variable editor and the buttons below
                                the fold, and the admin never finds the controls they came for. */}
                            <div className="max-h-list-md overflow-y-auto">
                                {isWhatsApp ? (
                                    <WhatsAppTemplatePreview
                                        template={template!}
                                        values={effectiveValues}
                                        mediaUrl={item.headerMediaUrl}
                                    />
                                ) : (
                                    <div
                                        className="max-w-full rounded-md border border-neutral-200 p-2 text-xs text-neutral-800 [&_img]:max-w-full [&_table]:max-w-full"
                                        dangerouslySetInnerHTML={{ __html: item.fullBody! }}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Variables — the one thing worth changing on a resend. */}
                    {hasVariables && (
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-neutral-700">
                                {t('resend.hasVariables', { count: variableKeys.length })}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <ModeButton
                                    active={mode === 'SAME'}
                                    icon={<ArrowClockwise className="size-3.5" />}
                                    label={t('resend.modeSame')}
                                    hint={
                                        sameBlocked
                                            ? t('resend.modeSameBlockedHint', {
                                                  names: missingKeys.map(labelFor).join(', '),
                                              })
                                            : t('resend.modeSameHint')
                                    }
                                    disabled={sameBlocked}
                                    onClick={() => setMode('SAME')}
                                />
                                <ModeButton
                                    active={mode === 'EDIT'}
                                    icon={<PencilSimple className="size-3.5" />}
                                    label={t('resend.modeEdit')}
                                    hint={t('resend.modeEditHint')}
                                    onClick={() => {
                                        setValues(initialVariables);
                                        setMode('EDIT');
                                    }}
                                />
                            </div>

                            <div
                                className={cn(
                                    'grid gap-2 rounded-md border border-neutral-200 p-2.5',
                                    variableKeys.length > 1 && 'sm:grid-cols-2'
                                )}
                            >
                                {variableKeys.map((key) => (
                                    <div key={key} className="space-y-1">
                                        <Label className="text-2xs text-neutral-500">
                                            {labelFor(key)}
                                        </Label>
                                        {mode === 'EDIT' ? (
                                            <Input
                                                value={values[key] ?? ''}
                                                onChange={(e) =>
                                                    setValues((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.value,
                                                    }))
                                                }
                                                placeholder={t('resend.variablePlaceholder', {
                                                    name: labelFor(key),
                                                })}
                                                className="h-8 text-xs"
                                            />
                                        ) : (
                                            <p className="break-words rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-800">
                                                {initialVariables[key]?.trim() ||
                                                    t('resend.variableEmpty')}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {blankWhatsappVariables && (
                        <p className="flex items-start gap-1.5 text-2xs text-warning-700">
                            <WarningCircle className="mt-px size-3.5 shrink-0" />
                            {t('resend.variablesRequired')}
                        </p>
                    )}

                    <p className="flex items-start gap-1.5 text-2xs text-warning-700">
                        <WarningCircle className="mt-px size-3.5 shrink-0" />
                        {t('resend.deliveryCaveat')}
                    </p>
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-neutral-100 pt-4 sm:justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={isSending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('resend.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={isSending || blankWhatsappVariables}
                        onClick={() => void handleSend()}
                        className="flex items-center gap-1.5"
                    >
                        {isSending ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                        ) : (
                            <ArrowClockwise className="size-3.5" />
                        )}
                        {mode === 'EDIT' ? t('resend.confirmEdited') : t('resend.confirmSame')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ModeButton({
    active,
    icon,
    label,
    hint,
    disabled = false,
    onClick,
}: {
    active: boolean;
    icon: ReactNode;
    label: string;
    hint: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            disabled={disabled}
            className={cn(
                'flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-60',
                active
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
            )}
        >
            {/* A radio dot, not just a tinted border: this choice decides what actually gets sent. */}
            <span
                className={cn(
                    'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-primary-500' : 'border-neutral-300'
                )}
            >
                {active && <span className="size-1.5 rounded-full bg-primary-500" />}
            </span>
            <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-800">
                    {icon}
                    {label}
                </span>
                <span className="mt-0.5 block text-2xs text-neutral-500">{hint}</span>
            </span>
        </button>
    );
}
