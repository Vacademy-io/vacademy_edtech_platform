/** Small building blocks shared by the screens. Everything is token-based, for dark mode. */
import type { ReactNode } from 'react';
import { CheckCircle, CircleNotch, Info, WarningCircle, WifiSlash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { useStrings } from '../strings';

type Tone = 'info' | 'danger' | 'warning' | 'success' | 'offline';

const TONE_ICON: Record<Tone, ReactNode> = {
    info: <Info className="size-10 text-info-600" />,
    danger: <WarningCircle className="size-10 text-danger-600" />,
    warning: <WarningCircle className="size-10 text-warning-600" />,
    success: <CheckCircle className="size-10 text-success-600" />,
    offline: <WifiSlash className="size-10 text-muted-foreground" />,
};

/** A whole-screen state: what happened, and what to do about it. */
export function StateCard({
    tone,
    title,
    body,
    children,
    testId,
}: {
    tone: Tone;
    title: string;
    body?: string;
    children?: ReactNode;
    testId?: string;
}) {
    return (
        <section
            data-state={testId}
            className="flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center"
        >
            {TONE_ICON[tone]}
            <h1 className="text-h3 text-foreground">{title}</h1>
            {body && <p className="text-body text-muted-foreground">{body}</p>}
            {children && <div className="flex w-full flex-col gap-3 pt-2">{children}</div>}
        </section>
    );
}

export function Spinner({ label, testId }: { label?: string; testId?: string }) {
    const s = useStrings();
    return (
        <div
            role="status"
            data-state={testId ?? 'loading'}
            className="flex flex-col items-center gap-3 py-12 text-muted-foreground"
        >
            <CircleNotch className="size-10 animate-spin text-primary-500" />
            <p className="text-body">{label ?? s.loading}</p>
        </div>
    );
}

export function ActionButton({
    children,
    secondary,
    text,
    className,
    ...props
}: {
    children: ReactNode;
    secondary?: boolean;
    text?: boolean;
    className?: string;
    onClick?: () => void;
    type?: 'button' | 'submit';
    disable?: boolean;
    'aria-label'?: string;
}) {
    return (
        <MyButton
            type="button"
            scale="large"
            buttonType={text ? 'text' : secondary ? 'secondary' : 'primary'}
            className={cn(
                'w-full',
                secondary && 'phone-secondary-text hover:bg-accent',
                text && 'h-10 whitespace-normal underline',
                className
            )}
            {...props}
        >
            {children}
        </MyButton>
    );
}

/** Network, busy and generic failures with a retry. A retry of approve is safe for 60 s. */
export function FailureCard({
    kind,
    onRetry,
    children,
}: {
    kind: 'network' | 'busy' | 'error';
    onRetry: () => void;
    children?: ReactNode;
}) {
    const s = useStrings();
    const title = kind === 'network' ? s.noConnection : kind === 'busy' ? s.busy : s.genericError;
    const body =
        kind === 'network' ? s.noConnectionBody : kind === 'busy' ? s.busyBody : s.genericErrorBody;
    return (
        <StateCard
            tone={kind === 'network' ? 'offline' : 'warning'}
            title={title}
            body={body}
            testId={`failure-${kind}`}
        >
            <ActionButton onClick={onRetry}>{s.retry}</ActionButton>
            {children}
        </StateCard>
    );
}

/** Three large numbers. Selected state is only used where a separate Pair button confirms. */
export function NumberChoice({
    options,
    selected,
    disabled,
    onPick,
}: {
    options: number[];
    selected?: number | null;
    disabled?: boolean;
    onPick: (value: number) => void;
}) {
    return (
        <div className="grid grid-cols-3 gap-3" data-state="numbers">
            {options.map((value) => (
                <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected === value}
                    onClick={() => onPick(value)}
                    // Not cn(): tailwind-merge reads text-h1 as a colour and would drop it.
                    className={`phone-press h-24 rounded-lg border-2 text-h1 transition-colors disabled:opacity-50 ${
                        selected === value
                            ? 'border-primary-500 bg-primary-100 text-neutral-700'
                            : 'border-border bg-card text-foreground'
                    }`}
                >
                    {value}
                </button>
            ))}
        </div>
    );
}

export function Warning({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-md border border-warning-300 bg-warning-50 p-3 text-body text-neutral-700">
            {children}
        </p>
    );
}
