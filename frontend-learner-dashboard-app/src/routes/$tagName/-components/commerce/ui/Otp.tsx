/**
 * The phone field (+91, ten digits, numeric keypad) and the WhatsApp code step of the buying
 * pages. The code is sent and checked by admin_core (/otp/request, /otp/verify); a fresh
 * Turnstile token goes with each send when the shop has the bot check on. Nothing here signs
 * the shopper into the learner app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { WhatsappLogo } from '@phosphor-icons/react';
import { CommerceApiError } from '../api/client';
import type { CheckoutConfig, OtpPurpose, OtpVerified } from '../api/types';
import type { MessageKey } from '../i18n';
import { spacedMobile, typedMobile } from '../logic/checkout';
import { sendCommerceEvent } from '../logic/events';
import { CheckoutUnavailableError, Field, clock, codeLengthOf, useChallenge, useSecondsLeft } from './buy-common';
import { useCommerceSite } from './site';

export const PhoneField: React.FC<{
    value: string;
    onChange(next: string): void;
    error?: string | null;
    hint?: string | null;
    disabled?: boolean;
    fieldRef?: React.Ref<HTMLInputElement>;
    after?: React.ReactNode;
    label?: string;
}> = ({ value, onChange, error, hint, disabled, fieldRef, after, label }) => {
    const { t } = useCommerceSite();
    return (
        <Field
            label={label || t('form.phone')}
            prefix="+91"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={14}
            value={value}
            onChange={(event) => onChange(typedMobile(event.target.value))}
            error={error}
            hint={hint}
            disabled={disabled}
            fieldRef={fieldRef}
            after={after}
        />
    );
};

const OTP_ERRORS: Record<string, MessageKey> = {
    otp_invalid: 'otp.error.invalid',
    otp_locked: 'otp.error.locked',
    bot_check_failed: 'otp.error.bot',
    otp_unavailable: 'otp.error.unavailable',
    invalid_request: 'form.error.phone',
};

const otpErrorKey = (error: unknown): MessageKey => {
    if (error instanceof CheckoutUnavailableError) return 'checkout.unavailable';
    if (error instanceof CommerceApiError) {
        if (OTP_ERRORS[error.code]) return OTP_ERRORS[error.code]!;
        if (error.kind === 'rate_limited') return 'otp.error.wait';
        if (error.kind === 'network') return 'error.network';
        if (error.status === 503) return 'otp.error.unavailable';
    }
    return 'error.generic';
};

/**
 * "Send code on WhatsApp" → code entry with a resend timer → verified. `phone` is the ten
 * digits of the field above it; changing the number starts over.
 */
export const OtpStep: React.FC<{
    purpose: OtpPurpose;
    phone: string;
    config: CheckoutConfig | undefined;
    onVerified(verified: OtpVerified, phone: string): void;
    /** The button reads "Verify with WhatsApp (recommended)" rather than plain. */
    recommended?: boolean;
    /** Start by sending at once (the server asked for the code). */
    autoSend?: boolean;
    sendLabel?: string;
}> = ({ purpose, phone, config, onVerified, recommended, autoSend, sendLabel }) => {
    const { t } = useCommerceSite();
    const { client } = useCommerceSite();
    const challenge = useChallenge(config);
    const [stage, setStage] = useState<'idle' | 'sending' | 'code' | 'verifying'>('idle');
    const [code, setCode] = useState('');
    const [error, setError] = useState<{ key: MessageKey; seconds?: number } | null>(null);
    const [resendAt, setResendAt] = useState<number | null>(null);
    const left = useSecondsLeft(resendAt);
    const codeRef = useRef<HTMLInputElement>(null);
    const length = codeLengthOf(config);
    const valid = /^[6-9]\d{9}$/.test(phone);
    const sentFor = useRef<string | null>(null);

    // Another number typed: the code sent to the old one means nothing.
    useEffect(() => {
        if (sentFor.current && sentFor.current !== phone) {
            sentFor.current = null;
            setStage('idle');
            setCode('');
            setError(null);
            setResendAt(null);
        }
    }, [phone]);

    const send = async (botRetry = false): Promise<void> => {
        if (!valid) {
            setError({ key: 'form.error.phone' });
            return;
        }
        setStage('sending');
        setError(null);
        try {
            const token = await challenge.get();
            const sent = await client.requestOtp({ phone: `+91${phone}`, purpose, ...(token ? { challenge_token: token } : {}) });
            sentFor.current = phone;
            setResendAt(Date.now() + Math.max(15, Number(sent.resend_after) || Number(config?.otp?.resend_after) || 60) * 1000);
            setStage('code');
            setCode('');
            window.setTimeout(() => codeRef.current?.focus(), 0);
        } catch (failure) {
            // A token is single use: one fresh try when the check refused it.
            if (!botRetry && failure instanceof CommerceApiError && failure.code === 'bot_check_failed') return send(true);
            setStage(sentFor.current === phone ? 'code' : 'idle');
            setError({ key: otpErrorKey(failure), seconds: failure instanceof CommerceApiError ? failure.retryAfter || undefined : undefined });
        }
    };

    const verify = async (value: string) => {
        if (value.length !== length || stage === 'verifying') return;
        setStage('verifying');
        setError(null);
        try {
            const verified = await client.verifyOtp({ phone: `+91${phone}`, code: value, purpose });
            if (purpose === 'CHECKOUT' || purpose === 'ACCOUNT') sendCommerceEvent({ name: 'login' });
            onVerified(verified, phone);
        } catch (failure) {
            setStage('code');
            setCode('');
            setError({ key: otpErrorKey(failure), seconds: failure instanceof CommerceApiError ? failure.retryAfter || undefined : undefined });
            codeRef.current?.focus();
        }
    };

    const autoSent = useRef(false);
    useEffect(() => {
        if (autoSend && valid && !autoSent.current && stage === 'idle') {
            autoSent.current = true;
            void send();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSend, valid]);

    const errorText = error ? (error.key === 'otp.error.wait' && error.seconds ? t('otp.error.waitFor', { seconds: error.seconds }) : t(error.key)) : null;

    if (stage === 'idle' || stage === 'sending') {
        return (
            <div className="flex flex-col gap-2">
                {challenge.host}
                <button
                    type="button"
                    className={recommended ? 'cmx-btn cmx-btn--whatsapp cmx-btn--block' : 'cmx-btn cmx-btn--outline cmx-btn--block'}
                    onClick={() => void send()}
                    disabled={stage === 'sending' || challenge.unavailable}
                    aria-busy={stage === 'sending'}
                >
                    <WhatsappLogo size={20} aria-hidden="true" />
                    {stage === 'sending' ? t('otp.sending') : sendLabel || (recommended ? t('otp.verifyRecommended') : t('otp.verify'))}
                </button>
                {challenge.unavailable && <p className="cmx-small cmx-bad">{t('checkout.unavailable')}</p>}
                {errorText && (
                    <p className="cmx-small cmx-bad" role="alert">
                        {errorText}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="cmx-otp flex flex-col gap-3">
            {challenge.host}
            <p className="cmx-small" role="status">
                {t('otp.sentTo', { phone: `+91 ${spacedMobile(phone)}` })}
            </p>
            <Field
                label={t('otp.codeLabel', { count: length })}
                fieldRef={codeRef}
                className="cmx-otp__code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={length}
                value={code}
                disabled={stage === 'verifying'}
                error={errorText}
                onChange={(event) => {
                    const next = event.target.value.replace(/\D/g, '').slice(0, length);
                    setCode(next);
                    if (next.length === length) void verify(next);
                }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    className="cmx-btn cmx-btn--primary"
                    onClick={() => void verify(code)}
                    disabled={code.length !== length || stage === 'verifying'}
                    aria-busy={stage === 'verifying'}
                >
                    {stage === 'verifying' ? t('otp.verifying') : t('otp.confirm')}
                </button>
                {left > 0 ? (
                    <span className="cmx-small cmx-muted" aria-live="off">
                        {t('otp.resendIn', { time: clock(left) })}
                    </span>
                ) : (
                    <button type="button" className="cmx-link" onClick={() => void send()}>
                        {t('otp.resend')}
                    </button>
                )}
            </div>
        </div>
    );
};
