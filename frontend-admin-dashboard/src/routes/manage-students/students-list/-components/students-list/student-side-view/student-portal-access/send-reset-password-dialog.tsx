import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, LinkSimple, Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { CredentialDeliveryModePicker } from '@/components/templates/CredentialDeliveryModePicker';
import { useCredentialDeliveryChoice } from '@/components/templates/use-credential-delivery-choice';
import {
    getPasswordResetLink,
    getPasswordResetTemplateConfig,
    sendPasswordResetEmail,
    setPasswordResetTemplateConfig,
    type PasswordResetLink,
} from '@/services/learner-password-reset';
import { buildSampleResetPasswordTemplate } from './sample-reset-password-template';

interface SendResetPasswordDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string;
    /** Only used by the system-default path, where a workflow may be bound to the send. */
    packageId?: string;
    learnerName?: string;
}

/**
 * "Send Reset Password Email", with the choice of body in front of it.
 *
 * <p>The dialog also surfaces the reset link itself, in two forms. The learner's own link is here
 * because an admin on a support call often just needs to read it out rather than send anything.
 * The `{username}` form is here because the same link is the integration point: a third-party
 * system (an LMS, a CRM, their own mailer) can substitute its own usernames into it and produce
 * working links without calling us per user — which is only possible because the link is
 * deliberately predictable rather than a one-time token.
 */
export const SendResetPasswordDialog = ({
    open,
    onOpenChange,
    userId,
    packageId,
    learnerName,
}: SendResetPasswordDialogProps) => {
    const { t } = useTranslation('manageStudentsSendResetPasswordDialog');
    const { t: tSampleTemplate } = useTranslation('manageStudentsSampleResetPasswordTemplate');
    const [linkInfo, setLinkInfo] = useState<PasswordResetLink | null>(null);
    const [isSending, setIsSending] = useState(false);
    // Internal, untranslated identifiers for "which field was just copied" — kept separate from
    // the translated labels shown in the UI/toasts so an equality check never breaks when the
    // display copy changes language.
    const [copiedField, setCopiedField] = useState<'resetLink' | 'linkPattern' | ''>('');

    const { mode, setMode, selectedTemplate, handleTemplateSelect } = useCredentialDeliveryChoice({
        enabled: open && !!userId,
        loadBoundTemplateId: async () =>
            (await getPasswordResetTemplateConfig('EMAIL')).template_id,
        saveBoundTemplateId: (templateId) => setPasswordResetTemplateConfig(templateId, 'EMAIL'),
    });

    // The link is per learner, so it is fetched here rather than in the shared hook. Only while
    // the dialog is open — the Portal Access panel renders this for every learner clicked through.
    useEffect(() => {
        if (!open || !userId) return;

        let cancelled = false;
        getPasswordResetLink(userId)
            .then((info) => {
                if (!cancelled) setLinkInfo(info);
            })
            .catch(() => {
                if (!cancelled) setLinkInfo(null);
            });

        return () => {
            cancelled = true;
        };
    }, [open, userId]);

    const handleCopy = async (value: string, fieldKey: 'resetLink' | 'linkPattern') => {
        const fieldLabel =
            fieldKey === 'resetLink'
                ? t('links.thisLearner.toastLabel')
                : t('links.thirdParty.toastLabel');
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(fieldKey);
            toast.success(t('toast.copied', { field: fieldLabel }));
            setTimeout(() => setCopiedField(''), 2000);
        } catch {
            toast.error(t('toast.copyFailed', { field: fieldLabel }));
        }
    };

    const handleSend = async () => {
        if (mode === 'TEMPLATE' && !selectedTemplate) {
            toast.error(t('toast.selectTemplate'));
            return;
        }

        setIsSending(true);
        try {
            const result = await sendPasswordResetEmail({
                userId,
                packageId,
                mode,
                templateId: mode === 'TEMPLATE' ? selectedTemplate?.id : undefined,
            });

            // A send can legitimately deliver nothing (no template bound, learner has no email),
            // so report what the backend actually did rather than a blanket success.
            if (result.sent_channels?.length) {
                toast.success(result.message || t('toast.sentDefault'));
                onOpenChange(false);
            } else {
                toast.error(result.message || t('toast.nothingSent'));
            }
        } catch (error) {
            console.error('Error sending reset password email:', error);
            toast.error(t('toast.sendFailed'));
        } finally {
            setIsSending(false);
        }
    };

    return (
        <MyDialog
            heading={t('dialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={isSending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={isSending}
                        onClick={handleSend}
                    >
                        {isSending ? t('actions.sending') : t('actions.send')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                {learnerName && (
                    <p className="text-sm text-neutral-600">
                        {t('sendingTo.prefix')}{' '}
                        <span className="font-medium">{learnerName}</span>
                        {linkInfo?.username ? ` (${linkInfo.username})` : ''}.
                    </p>
                )}

                <CredentialDeliveryModePicker
                    mode={mode}
                    onModeChange={setMode}
                    selectedTemplate={selectedTemplate}
                    onTemplateSelect={handleTemplateSelect}
                    defaultDescription={t('delivery.defaultDescription')}
                    templateDescription={t('delivery.templateDescription')}
                    buildSample={() => buildSampleResetPasswordTemplate(tSampleTemplate)}
                    disabled={isSending}
                />

                {/* Reset link — shown regardless of mode: an admin often just needs to read it
                    out, and the templated form is what a third-party system integrates against. */}
                <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-center gap-2">
                        <LinkSimple className="size-4 text-primary-500" />
                        <h4 className="text-xs font-semibold text-neutral-700">
                            {t('links.heading')}
                        </h4>
                    </div>

                    <CopyableLink
                        label={t('links.thisLearner.label')}
                        value={linkInfo?.reset_link ?? ''}
                        copied={copiedField === 'resetLink'}
                        onCopy={() => handleCopy(linkInfo?.reset_link ?? '', 'resetLink')}
                    />

                    <CopyableLink
                        label={t('links.thirdParty.label')}
                        value={linkInfo?.reset_link_template ?? ''}
                        copied={copiedField === 'linkPattern'}
                        onCopy={() =>
                            handleCopy(linkInfo?.reset_link_template ?? '', 'linkPattern')
                        }
                    />

                    <div className="flex items-start gap-2 rounded-md bg-primary-50/60 px-2 py-1.5">
                        <Info className="mt-0.5 size-3.5 shrink-0 text-primary-500" />
                        <p className="text-2xs leading-relaxed text-neutral-600">
                            {t('linkInfo.replacePrefix')}{' '}
                            <code className="rounded bg-white px-1">
                                {linkInfo?.username_placeholder ?? '{username}'}
                            </code>{' '}
                            {t('linkInfo.replaceSuffix')}{' '}
                            <code className="rounded bg-white px-1">
                                {'{{reset_password_link}}'}
                            </code>{' '}
                            {t('linkInfo.templateSuffix')}
                        </p>
                    </div>
                </div>
            </div>
        </MyDialog>
    );
};

const CopyableLink = ({
    label,
    value,
    copied,
    onCopy,
}: {
    label: string;
    value: string;
    copied: boolean;
    onCopy: () => void;
}) => {
    const { t } = useTranslation('manageStudentsSendResetPasswordDialog');

    return (
        <div className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                {label}
            </span>
            <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-neutral-100 px-2 py-1.5 text-2xs text-neutral-700">
                    {value || t('links.loadingPlaceholder')}
                </code>
                <button
                    type="button"
                    onClick={onCopy}
                    disabled={!value}
                    className="shrink-0 rounded-md p-1.5 hover:bg-neutral-200 disabled:opacity-40"
                    aria-label={t('links.copyAriaLabel', { label })}
                >
                    {copied ? (
                        <Check className="size-3.5 text-green-600" />
                    ) : (
                        <Copy className="size-3.5 text-neutral-500" />
                    )}
                </button>
            </div>
        </div>
    );
};
