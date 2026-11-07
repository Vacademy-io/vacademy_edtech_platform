import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Key, LinkSimple, Spinner, WhatsappLogo } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { PaperPdfOptions } from '../../-services/paper-service';
import type { PublishedPaperLink } from '../../-types/paper';

type Variant = PublishedPaperLink['variant'];

interface PaperShareDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Publishes one variant and returns its link. */
    onPublish: (options: PaperPdfOptions) => Promise<PublishedPaperLink>;
    /** Links already made for this paper, so re-opening shows them at once. */
    existing?: Partial<Record<Variant, PublishedPaperLink>>;
    /** Prefilled WhatsApp message; the link is appended. */
    shareTitle?: string;
}

const formatSize = (bytes: number): string =>
    bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * "Share link" for a generated paper.
 *
 * Publishing puts the PDF behind a public URL: anyone holding the link can
 * download it, which is what a teacher wants for the class group — and
 * exactly why the answer-key variant is a separate link with its own
 * warning. Links persist on the paper's history row, so the dialog shows an
 * existing link instead of minting a second one.
 */
export const PaperShareDialog = ({
    open,
    onOpenChange,
    onPublish,
    existing,
    shareTitle,
}: PaperShareDialogProps) => {
    const { t } = useTranslation('knowledgeBasePaperDownload');
    const [variant, setVariant] = useState<Variant>('question_paper');
    const [links, setLinks] = useState<Partial<Record<Variant, PublishedPaperLink>>>(
        existing ?? {}
    );
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (open) {
            setLinks(existing ?? {});
            setCopied(false);
        }
    }, [open, existing]);

    const link = links[variant];

    const publish = async () => {
        setBusy(true);
        try {
            const created = await onPublish({ includeAnswerKey: variant === 'with_answer_key' });
            setLinks((prev) => ({ ...prev, [created.variant]: created }));
            setCopied(false);
        } catch {
            toast.error(t('share.failed'));
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
            toast.success(t('share.copied'));
        } catch {
            toast.error(t('share.copyFailed'));
        }
    };

    const whatsapp = () => {
        if (!link) return;
        const text = `${shareTitle ?? link.title}\n${link.url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };

    return (
        <MyDialog
            heading={t('share.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
        >
            <div className="flex flex-col gap-4 p-6">
                <p className="text-body text-neutral-600">{t('share.description')}</p>

                <RadioGroup
                    value={variant}
                    onValueChange={(v) => {
                        setVariant(v as Variant);
                        setCopied(false);
                    }}
                    className="flex flex-col gap-2"
                >
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 has-[[data-state=checked]]:border-primary-500">
                        <RadioGroupItem value="question_paper" className="mt-0.5" />
                        <span className="flex flex-col">
                            <span className="text-body font-medium text-neutral-700">
                                {t('questionPaper')}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t('share.questionPaperHint')}
                            </span>
                        </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 has-[[data-state=checked]]:border-primary-500">
                        <RadioGroupItem value="with_answer_key" className="mt-0.5" />
                        <span className="flex flex-col">
                            <span className="flex items-center gap-1.5 text-body font-medium text-neutral-700">
                                <Key className="size-4 text-warning-600" />
                                {t('withAnswerKey')}
                            </span>
                            <span className="text-caption text-warning-700">
                                {t('share.answerKeyHint')}
                            </span>
                        </span>
                    </label>
                </RadioGroup>

                {link ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-success-200 bg-success-50 p-3">
                        <p className="flex items-center gap-1.5 text-caption font-medium text-success-700">
                            <LinkSimple className="size-4" />
                            {t('share.ready', { size: formatSize(link.size_bytes) })}
                        </p>
                        <div className="flex items-center gap-2">
                            <p
                                className="min-w-0 flex-1 select-all break-all rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-caption text-neutral-700"
                                aria-label={t('share.linkLabel')}
                            >
                                {link.url}
                            </p>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={copy}
                                className="shrink-0"
                            >
                                {copied ? (
                                    <Check className="mr-1 size-4" />
                                ) : (
                                    <Copy className="mr-1 size-4" />
                                )}
                                {copied ? t('share.copiedButton') : t('share.copy')}
                            </MyButton>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={whatsapp}
                            >
                                <WhatsappLogo className="mr-1 size-4" />
                                {t('share.whatsapp')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                disable={busy}
                                onClick={publish}
                            >
                                {busy ? <Spinner className="mr-1 size-4 animate-spin" /> : null}
                                {busy ? t('share.publishing') : t('share.republish')}
                            </MyButton>
                        </div>
                    </div>
                ) : (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={busy}
                        onClick={publish}
                        className="self-start"
                    >
                        {busy ? (
                            <Spinner className="mr-1 size-4 animate-spin" />
                        ) : (
                            <LinkSimple className="mr-1 size-4" />
                        )}
                        {busy ? t('share.publishing') : t('share.createLink')}
                    </MyButton>
                )}
            </div>
        </MyDialog>
    );
};
