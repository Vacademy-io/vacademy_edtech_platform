/**
 * Password and email OTP, with the request shapes of the admin login form. Google
 * and the other routes are behind "Other ways", which goes to /login on this host;
 * the teacher scans again afterwards.
 */
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { loginOtp, loginPassword, requestOtp, type LoginResponse } from '../lib/api';
import { completeSignIn } from '../lib/auth';
import { PhoneApiError } from '../lib/http';
import { fill, useStrings } from '../strings';
import { TextField } from './fields';
import { ActionButton } from './ui';

const LOGIN_PATH = '/login';

type Mode = 'password' | 'otp-email' | 'otp-code';

function failureText(error: unknown, s: ReturnType<typeof useStrings>, refused: string): string {
    if (error instanceof PhoneApiError) {
        if (error.kind === 'network') return s.noConnection;
        if (error.kind === 'busy') return s.busy;
        // 510 and 511 are how this backend refuses an authentication.
        const status = error.status ?? 500;
        if (status < 500 || status === 510 || status === 511) return refused;
    }
    return s.signInUnavailable;
}

export function SignInForm({
    instituteId,
    instituteName,
}: {
    instituteId?: string | null;
    instituteName?: string | null;
}) {
    const s = useStrings();
    const [mode, setMode] = useState<Mode>('password');
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const passwordSchema = useMemo(
        () =>
            z.object({
                username: z.string().trim().min(1, s.enterUsername),
                password: z.string().min(1, s.enterPassword),
            }),
        [s]
    );
    const emailSchema = useMemo(
        () => z.object({ email: z.string().trim().email(s.enterEmail) }),
        [s]
    );
    const otpSchema = useMemo(
        () =>
            z.object({
                otp: z
                    .string()
                    .trim()
                    .regex(/^\d{6}$/, s.enterOtp),
            }),
        [s]
    );

    const passwordForm = useForm<z.infer<typeof passwordSchema>>({
        resolver: zodResolver(passwordSchema),
        defaultValues: { username: '', password: '' },
    });
    const emailForm = useForm<z.infer<typeof emailSchema>>({
        resolver: zodResolver(emailSchema),
        defaultValues: { email: '' },
    });
    const otpForm = useForm<z.infer<typeof otpSchema>>({
        resolver: zodResolver(otpSchema),
        defaultValues: { otp: '' },
    });

    const finish = (response: LoginResponse): void => {
        if (response.session_limit_exceeded) {
            window.location.assign(LOGIN_PATH);
            return;
        }
        if (!response.accessToken) {
            setError(s.signInUnavailable);
            return;
        }
        completeSignIn(response.accessToken, response.refreshToken);
    };

    const run = async (action: () => Promise<void>, refused: string): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (failure) {
            setError(failureText(failure, s, refused));
        } finally {
            setBusy(false);
        }
    };

    const submitPassword = passwordForm.handleSubmit((values) =>
        run(async () => {
            finish(await loginPassword(values.username, values.password, instituteId));
        }, s.wrongCredentials)
    );

    const sendCode = (address: string) =>
        run(async () => {
            await requestOtp(address, instituteId);
            setEmail(address);
            otpForm.reset({ otp: '' });
            setMode('otp-code');
        }, s.otpNotSent);

    const submitEmail = emailForm.handleSubmit((values) => sendCode(values.email));

    const submitOtp = otpForm.handleSubmit((values) =>
        run(async () => {
            finish(await loginOtp(email, values.otp, instituteId));
        }, s.otpWrong)
    );

    const switchMode = (next: Mode) => {
        setError(null);
        setMode(next);
    };

    return (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-4" data-state="sign-in">
            <header className="flex flex-col gap-1">
                <h1 className="text-h3 text-foreground">
                    {instituteName ? fill(s.signInAt, { institute: instituteName }) : s.signInTitle}
                </h1>
                <p className="text-body text-muted-foreground">{s.signInHint}</p>
            </header>

            {mode === 'password' && (
                <Form {...passwordForm}>
                    <form onSubmit={submitPassword} noValidate className="flex flex-col gap-4">
                        <TextField
                            control={passwordForm.control}
                            name="username"
                            label={s.username}
                            autoComplete="username"
                            autoCapitalize="none"
                        />
                        <TextField
                            control={passwordForm.control}
                            name="password"
                            label={s.password}
                            type="password"
                            autoComplete="current-password"
                        />
                        <ActionButton type="submit" disable={busy}>
                            {busy ? s.signingIn : s.signIn}
                        </ActionButton>
                    </form>
                </Form>
            )}

            {mode === 'otp-email' && (
                <Form {...emailForm}>
                    <form onSubmit={submitEmail} noValidate className="flex flex-col gap-4">
                        <TextField
                            control={emailForm.control}
                            name="email"
                            label={s.email}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            autoCapitalize="none"
                        />
                        <ActionButton type="submit" disable={busy}>
                            {busy ? s.sendingCode : s.sendCode}
                        </ActionButton>
                    </form>
                </Form>
            )}

            {mode === 'otp-code' && (
                <Form {...otpForm}>
                    <form onSubmit={submitOtp} noValidate className="flex flex-col gap-4">
                        <p className="text-body text-muted-foreground">
                            {fill(s.otpSent, { email })}
                        </p>
                        <TextField
                            control={otpForm.control}
                            name="otp"
                            label={s.otp}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                        />
                        <ActionButton type="submit" disable={busy}>
                            {busy ? s.verifying : s.verifyCode}
                        </ActionButton>
                        <ActionButton text disable={busy} onClick={() => void sendCode(email)}>
                            {s.sendAgain}
                        </ActionButton>
                    </form>
                </Form>
            )}

            {error && (
                <p role="alert" data-state="sign-in-error" className="text-body text-danger-600">
                    {error}
                </p>
            )}

            <div className="flex flex-col gap-1">
                <ActionButton
                    text
                    onClick={() => switchMode(mode === 'password' ? 'otp-email' : 'password')}
                >
                    {mode === 'password' ? s.useOtp : s.usePassword}
                </ActionButton>
                <ActionButton text onClick={() => window.location.assign(LOGIN_PATH)}>
                    {s.otherWays}
                </ActionButton>
            </div>
        </section>
    );
}
