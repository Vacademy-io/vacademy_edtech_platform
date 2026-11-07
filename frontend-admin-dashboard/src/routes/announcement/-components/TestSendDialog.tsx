import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, PaperPlaneTilt, XCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import {
    AnnouncementService,
    type TestSendRequest,
    type TestSendResult,
} from '@/services/announcement';
import { FieldError, FieldHint } from '../create/-components/primitives';

/** Per-browser convenience: the addresses used for the last test, so the next one is one click. */
const STORAGE_KEY = 'announcement_test_send_emails';
const MAX_EMAILS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialEmails(): string {
    try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) return saved;
    } catch {
        // Storage can be blocked; fall through to the signed-in user's address.
    }
    const token = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken)) as
        | { email?: string }
        | undefined;
    return token?.email ?? '';
}

const splitEmails = (raw: string) =>
    Array.from(
        new Set(
            raw
                .split(/[\s,;]+/)
                .map((e) => e.trim())
                .filter(Boolean)
        )
    );

/**
 * Sends the email as it stands in the form to a few addresses. `buildPayload` is read at send
 * time so the test always reflects the latest edits; it returns null when there is nothing
 * sendable yet (the caller explains why via `blockedReason`).
 */
export function TestSendDialog({
    open,
    onOpenChange,
    buildPayload,
    blockedReason,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    buildPayload: () => Omit<TestSendRequest, 'emails'> | null;
    blockedReason?: string | null;
}) {
    const { t } = useTranslation('announcementCampaignTools');
    const [raw, setRaw] = useState('');
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState<TestSendResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setRaw(initialEmails());
        setResults(null);
        setError(null);
    }, [open]);

    const emails = useMemo(() => splitEmails(raw), [raw]);
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    const inputError =
        invalid.length > 0
            ? t('testSend.invalidEmails', { emails: invalid.join(', ') })
            : emails.length > MAX_EMAILS
              ? t('testSend.tooMany', { max: MAX_EMAILS })
              : null;

    const handleSend = async () => {
        setError(null);
        setResults(null);
        const payload = buildPayload();
        if (!payload) return;
        setSending(true);
        try {
            const response = await AnnouncementService.testSend({ ...payload, emails });
            setResults(response.results ?? []);
            try {
                window.localStorage.setItem(STORAGE_KEY, emails.join(', '));
            } catch {
                // Remembering the addresses is a nicety only.
            }
        } catch (err) {
            const typed = err as { response?: { data?: { message?: string } }; message?: string };
            setError(typed?.response?.data?.message || typed?.message || t('testSend.failed'));
        } finally {
            setSending(false);
        }
    };

    const canSend = !blockedReason && emails.length > 0 && !inputError && !sending;

    return (
        <MyDialog
            heading={t('testSend.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('testSend.close')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!canSend}
                        onClick={() => void handleSend()}
                    >
                        <PaperPlaneTilt className="me-1 size-4" />
                        {sending ? t('testSend.sending') : t('testSend.send')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-700">{t('testSend.description')}</p>

                {blockedReason && (
                    <p className="rounded-md border border-warning-400 bg-warning-50 p-3 text-caption text-warning-600">
                        {blockedReason}
                    </p>
                )}

                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="announcement-test-emails">{t('testSend.emailsLabel')}</Label>
                    <Textarea
                        id="announcement-test-emails"
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        placeholder={t('testSend.emailsPlaceholder')}
                        rows={3}
                        disabled={sending}
                    />
                    {inputError ? (
                        <FieldError message={inputError} />
                    ) : (
                        <FieldHint>{t('testSend.emailsHint', { max: MAX_EMAILS })}</FieldHint>
                    )}
                </div>

                {error && (
                    <p className="rounded-md border border-danger-400 bg-danger-50 p-3 text-caption text-danger-600">
                        {error}
                    </p>
                )}

                {results && (
                    <ul className="flex flex-col gap-2" aria-live="polite">
                        {results.map((r) => (
                            <li
                                key={r.email}
                                className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-caption"
                            >
                                {r.sent ? (
                                    <CheckCircle
                                        className="mt-0.5 size-4 shrink-0 text-success-600"
                                        weight="fill"
                                    />
                                ) : (
                                    <XCircle
                                        className="mt-0.5 size-4 shrink-0 text-danger-600"
                                        weight="fill"
                                    />
                                )}
                                <div className="min-w-0">
                                    <p className="truncate font-semibold text-neutral-800">
                                        {r.email}
                                    </p>
                                    <p className={r.sent ? 'text-neutral-600' : 'text-danger-600'}>
                                        {r.sent
                                            ? r.matchedUser
                                                ? t('testSend.sentMatched')
                                                : t('testSend.sentUnmatched')
                                            : r.error || t('testSend.failed')}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
}
