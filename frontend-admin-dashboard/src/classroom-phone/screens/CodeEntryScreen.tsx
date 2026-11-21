/** The fallback when there is no QR: a typed code, then the normal approve screens. */
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { MySessionResponse } from '@/classroom-shared/apiTypes';
import { Form } from '@/components/ui/form';
import { TextField } from '../components/fields';
import { ActionButton, StateCard } from '../components/ui';
import { mySession, mySessionEnd } from '../lib/api';
import { useAuth } from '../lib/auth';
import { setRoute } from '../lib/route';
import { fill, useStrings } from '../strings';

/** Accepts K7QF-2M9X, lower case and spaces. The server also folds Crockford look-alikes. */
export const normaliseTypedCode = (value: string): string =>
    value.toUpperCase().replace(/[^0-9A-Z]/g, '');

export function CodeEntryScreen() {
    const s = useStrings();
    const { signedIn } = useAuth();

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

    const submit = form.handleSubmit((values) => {
        setRoute({ kind: 'approve', userCode: values.code });
    });

    return (
        <div className="flex flex-col gap-4">
            <section
                className="flex flex-col gap-4 rounded-lg border bg-card p-4"
                data-state="code-entry"
            >
                <h1 className="text-h3 text-foreground">{s.codeTitle}</h1>
                <Form {...form}>
                    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                        <TextField
                            control={form.control}
                            name="code"
                            label={s.codeLabel}
                            autoComplete="off"
                            autoCapitalize="characters"
                            maxLength={12}
                        />
                        <ActionButton type="submit">{s.continue}</ActionButton>
                    </form>
                </Form>
            </section>
            {signedIn && <RunningSession />}
        </div>
    );
}

/** For a phone that lost its remote token, or a teacher who walked away from a panel. */
function RunningSession() {
    const s = useStrings();
    const [session, setSession] = useState<MySessionResponse | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [ended, setEnded] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        mySession()
            .then((response) => {
                if (live) setSession(response);
            })
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, []);

    if (ended) return <StateCard tone="success" testId="session-ended" title={s.sessionEnded} />;
    if (!session) return null;

    const end = () => {
        setFailed(false);
        mySessionEnd()
            .then(() => setEnded(true))
            .catch(() => setFailed(true));
    };

    return (
        <section className="flex flex-col gap-2 rounded-lg border p-4" data-state="running-session">
            <h2 className="text-subtitle text-foreground">
                {fill(s.runningSessionTitle, { room: session.room_name ?? s.aRoom })}
            </h2>
            <p className="text-body text-muted-foreground">{s.runningSessionBody}</p>
            {confirming ? (
                <>
                    <p className="text-body text-foreground">{s.signOutPanelConfirm}</p>
                    <ActionButton onClick={end}>{s.signOutPanelYes}</ActionButton>
                    <ActionButton secondary onClick={() => setConfirming(false)}>
                        {s.cancel}
                    </ActionButton>
                </>
            ) : (
                <ActionButton secondary onClick={() => setConfirming(true)}>
                    {s.signOutPanel}
                </ActionButton>
            )}
            {failed && (
                <p role="alert" className="text-body text-danger-600">
                    {s.noConnection}
                </p>
            )}
        </section>
    );
}
