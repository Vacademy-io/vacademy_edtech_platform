import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowBendUpLeft, PaperPlaneTilt, Trash, Warning } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import {
    getEmailConfigurations,
    type EmailConfiguration,
} from '@/services/email-configuration-service';
import { sendEmailReply, type EmailMessage } from '../../-services/email-inbox-api';
import { toast } from 'sonner';

interface Props {
    instituteId: string;
    toEmail: string;
    /** Display name of the recipient, when known. */
    toName?: string;
    /** Default subject (e.g. "Re: <last received subject>"). Empty string = no prefill. */
    defaultSubject?: string;
    onSent: (msg: EmailMessage) => void;
    /** Close without sending (the draft is discarded). */
    onDiscard: () => void;
}

/**
 * Gmail's inline reply: a card under the thread with the recipient, the sender to reply from,
 * the subject, and the message. Sends through one of the institute's configured senders.
 */
export function EmailReplyComposer({
    instituteId,
    toEmail,
    toName,
    defaultSubject = '',
    onSent,
    onDiscard,
}: Props) {
    const { t } = useTranslation('communicationEmailReplyComposer');
    const [senders, setSenders] = useState<EmailConfiguration[]>([]);
    const [loadingSenders, setLoadingSenders] = useState(false);
    const [from, setFrom] = useState<string>('');
    const [subject, setSubject] = useState(defaultSubject);
    const [editSubject, setEditSubject] = useState(false);
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);

    // Load senders once per institute. Filter out the platform-default fallback so admins
    // only see addresses they actually configured.
    useEffect(() => {
        if (!instituteId) return;
        let cancelled = false;
        setLoadingSenders(true);
        getEmailConfigurations()
            .then((cfgs) => {
                if (cancelled) return;
                const real = cfgs.filter(
                    (c) =>
                        !(
                            c.displayText?.includes('default') ||
                            c.description?.includes('Default platform sender')
                        )
                );
                setSenders(real);
                const first = real[0];
                if (first) setFrom((prev) => prev || first.email);
            })
            .catch((err) => console.error('Failed to load email senders', err))
            .finally(() => {
                if (!cancelled) setLoadingSenders(false);
            });
        return () => {
            cancelled = true;
        };
    }, [instituteId]);

    // A different conversation starts a fresh draft (never leak a reply across recipients).
    useEffect(() => {
        setSubject(defaultSubject);
        setEditSubject(false);
        setBody('');
    }, [toEmail, defaultSubject]);

    const disabled = senders.length === 0;

    const handleSend = async () => {
        if (!body.trim()) {
            toast.error(t('bodyEmpty'));
            return;
        }
        if (!from) {
            toast.error(t('pickSender'));
            return;
        }

        setSending(true);
        try {
            const sent = await sendEmailReply({
                instituteId,
                toEmail,
                fromEmail: from,
                subject: subject.trim() || undefined,
                body,
            });
            onSent(sent);
            setBody('');
            toast.success(sent.deliveryStatus === 'DEFERRED' ? t('replyQueued') : t('replySent'));
        } catch (err: unknown) {
            console.error('Send reply failed', err);
            const data = (err as { response?: { data?: { message?: string; error?: string } } })
                ?.response?.data;
            toast.error(data?.message || data?.error || t('failedToSendReply'));
        } finally {
            setSending(false);
        }
    };

    return (
        <section
            className="rounded-lg border border-neutral-200 bg-white shadow-md"
            aria-label={t('reply')}
        >
            <div className="space-y-1 border-b border-neutral-100 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2 text-neutral-600">
                    <ArrowBendUpLeft size={16} className="shrink-0 text-neutral-500" />
                    <span className="truncate">
                        {toName && toName !== toEmail ? `${toName} <${toEmail}>` : toEmail}
                    </span>
                </div>
                {!disabled && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-6">
                        <span className="text-xs text-neutral-500">{t('from')}</span>
                        <Select value={from} onValueChange={setFrom}>
                            <SelectTrigger className="h-7 w-auto min-w-0 max-w-full border-0 bg-neutral-50 px-2 text-xs shadow-none">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {senders.map((s) => (
                                    <SelectItem key={s.email} value={s.email} className="text-xs">
                                        {s.name ? `${s.name} <${s.email}>` : s.email}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {editSubject ? (
                            <Input
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder={t('subject')}
                                aria-label={t('subject')}
                                className="h-7 min-w-0 flex-1 px-2 text-xs"
                                autoFocus
                            />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setEditSubject(true)}
                                className="min-w-0 truncate text-xs text-neutral-500 hover:text-neutral-800 hover:underline"
                                title={t('editSubject')}
                            >
                                {subject || t('noSubject')}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {disabled ? (
                <p className="flex items-start gap-2 p-4 text-xs text-warning-700">
                    <Warning size={16} weight="fill" className="shrink-0 text-warning-600" />
                    {loadingSenders ? t('loadingSenders') : t('noSenderConfigured')}
                </p>
            ) : (
                <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !sending) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={t('writeReplyPlaceholder')}
                    rows={8}
                    className="resize-y rounded-none border-0 px-4 py-3 text-sm shadow-none focus-visible:ring-0"
                    autoFocus
                />
            )}

            <footer className="flex items-center justify-between gap-2 px-3 py-2.5">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSend}
                    disabled={sending || disabled || !body.trim()}
                    className="gap-1.5 rounded-full px-5"
                    title={t('sendShortcut')}
                >
                    <PaperPlaneTilt size={14} weight="fill" />
                    {sending ? t('sending') : t('send')}
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    onClick={onDiscard}
                    disabled={sending}
                    title={t('discard')}
                    aria-label={t('discard')}
                >
                    <Trash size={16} />
                </MyButton>
            </footer>
        </section>
    );
}
