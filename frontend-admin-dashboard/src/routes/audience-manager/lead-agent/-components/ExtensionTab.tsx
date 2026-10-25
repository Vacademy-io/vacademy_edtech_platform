import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy, Desktop, PuzzlePiece, WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { formatNumber, formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import type { LeadAgentWorker } from '../-types';
import { usePairWorker, useRevokeWorker, useWorkers } from '../-hooks/use-lead-agent';
import { apiErrorMessage } from '../-services/lead-agent-api';

// Message types of the extension's pairing bridge (lead-agent-extension/content-pair.js).
const MSG = {
    PING: 'VACADEMY_LEAD_AGENT_PING',
    PRESENT: 'VACADEMY_LEAD_AGENT_PRESENT',
    PAIR: 'VACADEMY_LEAD_AGENT_PAIR',
    PAIRED: 'VACADEMY_LEAD_AGENT_PAIRED',
} as const;

/** Pages the extension accepts pairing messages from (PAIR_PAGE_HOSTS in lead-agent-extension/lib.js). */
const canAutoPair = () => {
    const { protocol, hostname } = window.location;
    return (
        (protocol === 'https:' && hostname === 'dash.vacademy.io') ||
        (protocol === 'http:' && hostname === 'localhost')
    );
};

const ONLINE_MS = 90_000;
const isOnline = (w: LeadAgentWorker) =>
    w.online || (!!w.last_seen_at && Date.now() - new Date(w.last_seen_at).getTime() < ONLINE_MS);

type PairResult = {
    ok: boolean;
    institute_name?: string | null;
    user_name?: string | null;
    needs_site_access?: boolean;
    error?: string | null;
};

function useExtensionPresence() {
    const [state, setState] = useState<{ installed: boolean | null; version: string | null }>({
        installed: null,
        version: null,
    });
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.source !== window || e.origin !== window.location.origin) return;
            const d = e.data as { type?: string; version?: string } | null;
            if (d?.type === MSG.PRESENT) {
                setState({
                    installed: true,
                    version: typeof d.version === 'string' ? d.version : null,
                });
            }
        };
        window.addEventListener('message', onMessage);
        window.postMessage({ type: MSG.PING }, window.location.origin);
        const t = window.setTimeout(
            () => setState((s) => (s.installed === null ? { installed: false, version: null } : s)),
            1500
        );
        return () => {
            window.removeEventListener('message', onMessage);
            window.clearTimeout(t);
        };
    }, []);
    return state;
}

function PairPanel({ extensionInstalled }: { extensionInstalled: boolean | null }) {
    const pair = usePairWorker();
    const [label, setLabel] = useState('');
    const [token, setToken] = useState<string | null>(null);
    const [result, setResult] = useState<PairResult | null>(null);
    const [waiting, setWaiting] = useState(false);
    const timer = useRef<number | null>(null);
    const autoPair = canAutoPair();

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.source !== window || e.origin !== window.location.origin) return;
            const d = e.data as ({ type?: string } & PairResult) | null;
            if (d?.type !== MSG.PAIRED) return;
            if (timer.current) window.clearTimeout(timer.current);
            setWaiting(false);
            setResult({
                ok: !!d.ok,
                institute_name: d.institute_name ?? null,
                user_name: d.user_name ?? null,
                needs_site_access: !!d.needs_site_access,
                error: d.error ?? null,
            });
        };
        window.addEventListener('message', onMessage);
        return () => {
            window.removeEventListener('message', onMessage);
            if (timer.current) window.clearTimeout(timer.current);
        };
    }, []);

    const connect = async () => {
        setResult(null);
        const res = await pair.mutateAsync(label.trim() || undefined).catch(() => null);
        if (!res?.token) return;
        setToken(res.token);
        if (autoPair) {
            // Posted even when PING got no answer (an older extension); the code still works.
            window.postMessage(
                { type: MSG.PAIR, token: res.token, apiBase: AI_SERVICE_BASE_URL },
                window.location.origin
            );
            if (extensionInstalled) {
                setWaiting(true);
                timer.current = window.setTimeout(() => setWaiting(false), 15_000);
            }
        }
    };

    const copy = async () => {
        if (!token) return;
        try {
            await navigator.clipboard.writeText(token);
            toast.success('Code copied');
        } catch {
            toast.error('Could not copy. Select the code and copy it by hand.');
        }
    };

    return (
        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-title font-semibold text-neutral-800">Connect this computer</h2>
                <p className="text-body text-neutral-600">
                    In Local mode the agent reads websites through the Chrome extension on your
                    team’s computers. It works while Chrome is open, and only ever reads the pages
                    the agent asks for.
                </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                    <MyInput
                        label="Name for this computer (optional)"
                        input={label}
                        onChangeFunction={(e) => setLabel(e.target.value.slice(0, 120))}
                        inputPlaceholder="e.g. Sales desk 2"
                        className="sm:w-full"
                    />
                </div>
                <MyButton
                    type="button"
                    buttonType="primary"
                    disable={pair.isPending || waiting}
                    onClick={() => void connect()}
                    className="shrink-0"
                >
                    <Desktop className="size-4" />
                    {pair.isPending
                        ? 'Creating code…'
                        : waiting
                          ? 'Connecting…'
                          : 'Connect this computer'}
                </MyButton>
            </div>

            {token && (
                <div className="flex flex-col gap-2 rounded-md border border-primary-200 bg-primary-50 p-3">
                    <span className="text-caption font-semibold text-neutral-700">
                        Pairing code (shown once)
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <code className="min-w-0 flex-1 select-all break-all rounded-sm bg-card px-2 py-1 text-body text-neutral-800">
                            {token}
                        </code>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void copy()}
                        >
                            <Copy className="size-4" /> Copy
                        </MyButton>
                    </div>
                    <p className="text-caption text-neutral-600">
                        {autoPair && extensionInstalled
                            ? 'The extension on this computer is being connected. To connect another computer, open the extension there, paste this code and click Connect.'
                            : 'Open the extension (puzzle-piece icon in Chrome), paste this code and click Connect.'}
                    </p>
                </div>
            )}

            {result && (
                <div
                    role="status"
                    className={cn(
                        'flex items-start gap-2 rounded-md border p-3 text-body',
                        result.ok
                            ? 'border-success-300 bg-success-50 text-success-700'
                            : 'border-danger-200 bg-danger-50 text-danger-700'
                    )}
                >
                    {result.ok ? (
                        <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" />
                    ) : (
                        <WarningCircle className="mt-0.5 size-5 shrink-0" weight="fill" />
                    )}
                    <div className="flex flex-col gap-1">
                        <span>
                            {result.ok
                                ? `Connected${result.institute_name ? ` to ${result.institute_name}` : ''}.`
                                : result.error ||
                                  'The extension could not connect. Paste the code into it instead.'}
                        </span>
                        {result.ok && result.needs_site_access && (
                            <span className="text-caption">
                                One more step: open the extension and allow it to read websites.
                            </span>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

function InstallPanel({
    installed,
    version,
}: {
    installed: boolean | null;
    version: string | null;
}) {
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-card p-4 sm:p-6">
            <div className="flex items-center gap-2">
                <PuzzlePiece className="size-5 text-primary-500" weight="fill" />
                <h2 className="text-title font-semibold text-neutral-800">The extension</h2>
            </div>
            {installed === null ? (
                <Skeleton className="h-5 w-48" />
            ) : installed ? (
                <p className="flex items-center gap-2 text-body text-success-700">
                    <CheckCircle className="size-4" weight="fill" />
                    Extension installed{version ? ` (v${version})` : ''} in this browser.
                </p>
            ) : (
                <div className="flex flex-col gap-2 text-body text-neutral-700">
                    <p>Not found in this browser. To install it (Chrome 120 or newer):</p>
                    <ol className="list-decimal ps-5">
                        <li>
                            Get the <span className="font-semibold">lead-agent-extension</span>{' '}
                            folder from your Vacademy contact.
                        </li>
                        <li>
                            Open{' '}
                            <code className="rounded-sm bg-neutral-100 px-1">
                                chrome://extensions
                            </code>{' '}
                            and turn on <span className="font-semibold">Developer mode</span>.
                        </li>
                        <li>
                            Click <span className="font-semibold">Load unpacked</span> and choose
                            the folder.
                        </li>
                        <li>Pin the extension, then reload this page.</li>
                    </ol>
                </div>
            )}
        </section>
    );
}

function WorkersList() {
    const workers = useWorkers();
    const revoke = useRevokeWorker();
    const [revoking, setRevoking] = useState<LeadAgentWorker | null>(null);
    const list = workers.data ?? [];

    return (
        <section className="flex flex-col gap-3">
            <h2 className="text-title font-semibold text-neutral-800">Connected computers</h2>
            {workers.isLoading ? (
                <Skeleton className="h-24 w-full" />
            ) : workers.isError ? (
                <ErrorState
                    message={apiErrorMessage(
                        workers.error,
                        'Could not load the connected computers.'
                    )}
                    onRetry={() => void workers.refetch()}
                />
            ) : list.length === 0 ? (
                <EmptyState
                    icon={<Desktop className="size-8 text-neutral-400" />}
                    title="No computer connected"
                >
                    Connect one above to run agents in Local mode.
                </EmptyState>
            ) : (
                <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-card">
                    {list.map((w) => {
                        const online = isOnline(w);
                        return (
                            <li
                                key={w.id}
                                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="flex min-w-0 items-start gap-3">
                                    <span
                                        className={cn(
                                            'mt-2 size-2 shrink-0 rounded-full',
                                            online ? 'bg-success-500' : 'bg-neutral-300'
                                        )}
                                        aria-label={online ? 'Online' : 'Offline'}
                                    />
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate text-body font-semibold text-neutral-800">
                                            {w.label || 'Unnamed computer'}
                                        </span>
                                        <span className="text-caption text-neutral-500">
                                            {[
                                                online
                                                    ? 'Online'
                                                    : w.last_seen_at
                                                      ? `Last seen ${formatRelative(w.last_seen_at)}`
                                                      : 'Never connected',
                                                `${formatNumber(w.pages_today)} pages today`,
                                                w.version ? `v${w.version}` : null,
                                                w.user_id ? `user ${w.user_id.slice(0, 8)}` : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </div>
                                </div>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    disable={revoke.isPending}
                                    onClick={() => setRevoking(w)}
                                    className="self-start text-danger-600 sm:self-center"
                                >
                                    Revoke
                                </MyButton>
                            </li>
                        );
                    })}
                </ul>
            )}
            <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Disconnect {revoking?.label || 'this computer'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Its extension stops working for your institute straight away. You can
                            connect it again with a new code.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={revoke.isPending}
                            className="bg-danger-600 hover:bg-danger-500"
                            onClick={(e) => {
                                e.preventDefault();
                                if (!revoking) return;
                                revoke.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
                            }}
                        >
                            {revoke.isPending ? 'Disconnecting…' : 'Disconnect'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}

/** Pair the Chrome extension (Local mode) and manage the connected computers. */
export function ExtensionTab() {
    const presence = useExtensionPresence();
    return (
        <div className="flex flex-col gap-6">
            <InstallPanel installed={presence.installed} version={presence.version} />
            <PairPanel extensionInstalled={presence.installed} />
            <WorkersList />
        </div>
    );
}
