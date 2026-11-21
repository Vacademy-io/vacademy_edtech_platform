/**
 * #installer: staff of an installer org add a school with the one-time code the school
 * gave them, then set up that school's panels from each panel's own code. A panel set up
 * this way waits for the school's admin to approve it before anyone can sign in on it.
 *
 * Whether this account is an installer is asked of the server (GET /partner/me). Any
 * other account sees a short refusal and can sign out to try another.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { PanelPartnerLinkRedeemResponse, PanelPartnerRef } from '@/classroom-shared/apiTypes';
import { Form } from '@/components/ui/form';
import { TextField } from '../components/fields';
import { SignedIn } from '../components/SignedIn';
import { ActionButton, FailureCard, Spinner, StateCard } from '../components/ui';
import { installerProbe, redeemPartnerCode } from '../lib/api';
import { errorCode, errorKind } from '../lib/http';
import { setRoute, type PhoneRoute } from '../lib/route';
import { fill, useStrings, type PhoneStrings } from '../strings';
import { normaliseTypedCode } from './CodeEntryScreen';

type Route = Extract<PhoneRoute, { kind: 'installer' }>;

type Failure = 'network' | 'busy' | 'error';

const failureOf = (error: unknown): Failure => {
    const kind = errorKind(error);
    return kind === 'network' ? 'network' : kind === 'busy' ? 'busy' : 'error';
};

/** A calendar day in the page's language. Display only: the server decides what is allowed. */
export const formatDay = (iso: string): string =>
    new Date(iso).toLocaleDateString(document.documentElement.lang || 'en');

export const schoolName = (name: string | null | undefined, s: PhoneStrings): string =>
    name?.trim() || s.schoolNameLoading;

export function NotInstallerCard({ onSignOutRetry }: { onSignOutRetry: () => void }) {
    const s = useStrings();
    return (
        <StateCard
            tone="danger"
            testId="not-installer"
            title={s.notInstallerTitle}
            body={s.notInstallerBody}
        >
            <ActionButton onClick={onSignOutRetry}>{s.signOutTryAnother}</ActionButton>
        </StateCard>
    );
}

type Stage =
    | { kind: 'loading' }
    | { kind: 'ready'; partner: PanelPartnerRef }
    | { kind: 'not-installer' }
    | { kind: 'failed'; failure: Failure };

export function InstallerScreen({
    route,
    onSignOutRetry,
}: {
    route: Route;
    onSignOutRetry: () => void;
}) {
    return (
        <SignedIn>
            <InstallerFlow route={route} onSignOutRetry={onSignOutRetry} />
        </SignedIn>
    );
}

function InstallerFlow({ route, onSignOutRetry }: { route: Route; onSignOutRetry: () => void }) {
    const s = useStrings();
    const [stage, setStage] = useState<Stage>({ kind: 'loading' });
    const [linked, setLinked] = useState<PanelPartnerLinkRedeemResponse | null>(null);

    const load = useCallback(async () => {
        setStage({ kind: 'loading' });
        try {
            const partner = await installerProbe();
            setStage(partner ? { kind: 'ready', partner } : { kind: 'not-installer' });
        } catch (error) {
            // A refused sign-in: SignedIn shows the sign-in form in place of this flow.
            if (errorKind(error) === 'sign-in') return;
            setStage({ kind: 'failed', failure: failureOf(error) });
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    switch (stage.kind) {
        case 'loading':
            return <Spinner />;
        case 'not-installer':
            return <NotInstallerCard onSignOutRetry={onSignOutRetry} />;
        case 'failed':
            return <FailureCard kind={stage.failure} onRetry={() => void load()} />;
        case 'ready':
            break;
    }

    return (
        <div className="flex flex-col gap-4" data-state="installer">
            <div className="flex flex-col gap-1">
                <h1 className="text-h3 text-foreground">{s.installerTitle}</h1>
                <p className="text-body text-muted-foreground" data-state="installer-org">
                    {fill(s.installerFor, { partner: stage.partner.name })}
                </p>
            </div>

            {linked && (
                <section
                    className="flex flex-col gap-2 rounded-lg border border-success-300 bg-success-50 p-4"
                    data-state="installer-linked"
                    role="status"
                >
                    <h2 className="text-subtitle text-neutral-700">
                        {fill(s.schoolLinked, { school: schoolName(linked.institute_name, s) })}
                    </h2>
                    {linked.install_until && (
                        <p className="text-body text-neutral-700">
                            {fill(s.installUntil, { date: formatDay(linked.install_until) })}
                        </p>
                    )}
                    {route.resume && (
                        <ActionButton
                            onClick={() => setRoute({ kind: 'pair', code: route.resume ?? '' })}
                        >
                            {s.continuePanel}
                        </ActionButton>
                    )}
                </section>
            )}

            <AddSchool
                onAdded={setLinked}
                onNotInstaller={() => setStage({ kind: 'not-installer' })}
            />

            <CodeForm
                testId="installer-panel-code"
                title={s.panelCodeTitle}
                hint={s.panelCodeHint}
                label={s.panelCodeLabel}
                submitLabel={s.continue}
                onCode={(code) => setRoute({ kind: 'pair', code })}
            />
        </div>
    );
}

function AddSchool({
    onAdded,
    onNotInstaller,
}: {
    onAdded: (link: PanelPartnerLinkRedeemResponse) => void;
    onNotInstaller: () => void;
}) {
    const s = useStrings();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const redeem = async (code: string): Promise<boolean> => {
        setBusy(true);
        setError(null);
        try {
            onAdded(await redeemPartnerCode(code));
            return true;
        } catch (failure) {
            const kind = errorKind(failure);
            const code = errorCode(failure);
            if (kind === 'sign-in') return false;
            if (code === 'NOT_INSTALLER') onNotInstaller();
            else if (code === 'INVITE_INVALID' || code === 'NOT_FOUND') setError(s.schoolCodeWrong);
            else if (kind === 'network') setError(s.noConnection);
            else if (kind === 'busy') setError(s.busy);
            else setError(s.genericError);
            return false;
        } finally {
            setBusy(false);
        }
    };

    return (
        <CodeForm
            testId="installer-school-code"
            title={s.addSchoolTitle}
            hint={s.addSchoolHint}
            label={s.schoolCodeLabel}
            submitLabel={busy ? s.adding : s.addSchool}
            busy={busy}
            error={error}
            onCode={redeem}
        />
    );
}

/** An 8-character code typed by hand. The form clears once onCode reports success. */
function CodeForm({
    testId,
    title,
    hint,
    label,
    submitLabel,
    busy,
    error,
    onCode,
}: {
    testId: string;
    title: string;
    hint: string;
    label: string;
    submitLabel: string;
    busy?: boolean;
    error?: string | null;
    onCode: (code: string) => unknown;
}) {
    const s = useStrings();
    const schema = useMemo(
        () =>
            z.object({
                code: z
                    .string()
                    .transform(normaliseTypedCode)
                    .refine((value) => value.length === 8, s.codeInvalid),
            }),
        [s]
    );
    const form = useForm<{ code: string }>({
        resolver: zodResolver(schema),
        defaultValues: { code: '' },
    });
    const submit = form.handleSubmit(async ({ code }) => {
        if ((await onCode(code)) === true) form.reset();
    });

    return (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-4" data-state={testId}>
            <div className="flex flex-col gap-1">
                <h2 className="text-subtitle text-foreground">{title}</h2>
                <p className="text-body text-muted-foreground">{hint}</p>
            </div>
            <Form {...form}>
                <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                    <TextField
                        control={form.control}
                        name="code"
                        label={label}
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={12}
                    />
                    <ActionButton type="submit" disable={busy}>
                        {submitLabel}
                    </ActionButton>
                    {error && (
                        <p
                            role="alert"
                            data-state={`${testId}-error`}
                            className="text-body text-danger-600"
                        >
                            {error}
                        </p>
                    )}
                </form>
            </Form>
        </section>
    );
}
