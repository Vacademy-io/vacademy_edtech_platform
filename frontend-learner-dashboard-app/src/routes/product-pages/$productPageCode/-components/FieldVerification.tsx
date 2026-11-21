import { useEffect, useRef, useState } from 'react';
import { CheckCircle, SpinnerGap } from '@phosphor-icons/react';
import type { FieldVerificationConfig } from '@/components/common/enroll-by-invite/-utils/custom-field-helpers';
import {
    checkVerificationCode,
    sendVerificationCode,
} from '../-services/field-verification-service';

/**
 * Proof-of-ownership gate for one form field.
 *
 * Sits under the input it guards and moves through three states: ask to send a
 * code, take the code, done. It owns none of the form's data — the parent keeps
 * the VALUE that was verified (not a boolean), which is what lets an edited
 * number re-arm the gate instead of sailing through on a stale tick.
 *
 * Nothing here knows it is verifying a phone: the channel comes from the
 * field's own config, so a second channel only needs a branch in the service.
 */

/** Long enough to stop double-taps and template spam, short enough not to strand
 *  someone whose first message genuinely never arrived. */
const RESEND_SECONDS = 30;

interface Props {
    verification: FieldVerificationConfig & { channel: 'WHATSAPP' };
    /** Current field value, already formatted by the input (E.164 for phones). */
    value: string;
    instituteId: string;
    label: string;
    verified: boolean;
    onVerified: (verifiedValue: string) => void;
    disabled?: boolean;
}

const CHANNEL_NAME: Record<'WHATSAPP', string> = { WHATSAPP: 'WhatsApp' };

/** Digits only — a dial code alone ("+91") is not a number worth sending to. */
const isSendable = (value: string) => value.replace(/[^0-9]/g, '').length >= 8;

export const FieldVerification = ({
    verification,
    value,
    instituteId,
    label,
    verified,
    onVerified,
    disabled,
}: Props) => {
    const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState<'send' | 'check' | null>(null);
    const [error, setError] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const codeInputRef = useRef<HTMLInputElement>(null);

    const channelName = CHANNEL_NAME[verification.channel];

    // Editing the value abandons the code that was sent to the old one.
    useEffect(() => {
        setCodeSentTo((sentTo) => (sentTo && sentTo !== value ? null : sentTo));
        setCode('');
        setError('');
    }, [value]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    const send = async () => {
        setError('');
        setBusy('send');
        try {
            await sendVerificationCode({
                channel: verification.channel,
                value,
                instituteId,
                templateName: verification.templateName,
                languageCode: verification.languageCode,
            });
            setCodeSentTo(value);
            setCooldown(RESEND_SECONDS);
            // The code is the only thing left to do — put the cursor in it.
            setTimeout(() => codeInputRef.current?.focus(), 0);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not send the code.');
        } finally {
            setBusy(null);
        }
    };

    const check = async () => {
        setError('');
        setBusy('check');
        try {
            const ok = await checkVerificationCode({
                channel: verification.channel,
                value,
                code: code.trim(),
            });
            if (ok) onVerified(value);
            else setError('That code is not right. Check the message and try again.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not check that code.');
        } finally {
            setBusy(null);
        }
    };

    if (verified) {
        return (
            <p className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                <CheckCircle className="size-4" weight="fill" aria-hidden="true" />
                {label} verified on {channelName}
            </p>
        );
    }

    const spinner = <SpinnerGap className="size-3.5 animate-spin" aria-hidden="true" />;

    return (
        <div className="space-y-2">
            {codeSentTo !== value ? (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={send}
                        disabled={disabled || busy !== null || !isSendable(value)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy === 'send' && spinner}
                        Send code on {channelName}
                    </button>
                    <span className="text-xs text-gray-500">
                        {isSendable(value)
                            ? `We'll message a code to confirm this ${label.toLowerCase()}.`
                            : `Enter your ${label.toLowerCase()} to get a code.`}
                    </span>
                </div>
            ) : (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-600">
                        Code sent on {channelName} to <span className="font-medium">{value}</span>.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            ref={codeInputRef}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (code.trim()) void check();
                                }
                            }}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="Enter code"
                            aria-label={`Code sent on ${channelName}`}
                            className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        />
                        <button
                            type="button"
                            onClick={check}
                            disabled={busy !== null || !code.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {busy === 'check' && spinner}
                            Verify
                        </button>
                        <button
                            type="button"
                            onClick={send}
                            disabled={busy !== null || cooldown > 0}
                            className="text-xs font-semibold text-gray-500 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
                        >
                            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                        </button>
                    </div>
                </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
};

export default FieldVerification;
