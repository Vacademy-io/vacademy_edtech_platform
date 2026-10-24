import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { ArrowClockwise, Info, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SectionCardProps {
    title: string;
    description?: string;
    Icon?: Icon;
    /** Rendered in place of the icon — e.g. a step number. */
    badge?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    /** Adds a danger outline when the section holds a blocking error. */
    invalid?: boolean;
    /** DOM id, so a progress step or "Edit" link can scroll to this card. */
    id?: string;
}

export function SectionCard({
    title,
    description,
    Icon: SectionIcon,
    badge,
    action,
    children,
    className,
    invalid,
    id,
}: SectionCardProps) {
    return (
        <Card
            id={id}
            className={cn(
                'rounded-xl border-neutral-200 bg-white shadow-sm transition-colors',
                invalid && 'border-danger-400',
                className
            )}
        >
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
                <div className="flex min-w-0 items-start gap-3">
                    {badge}
                    {!badge && SectionIcon && (
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <SectionIcon className="size-5" weight="duotone" />
                        </span>
                    )}
                    <div className="min-w-0">
                        <CardTitle className="text-subtitle font-semibold">{title}</CardTitle>
                        {description && (
                            <CardDescription className="mt-1 text-caption">
                                {description}
                            </CardDescription>
                        )}
                    </div>
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </CardHeader>
            <CardContent className="space-y-4">{children}</CardContent>
        </Card>
    );
}

export function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <p className="flex items-start gap-1 text-caption text-danger-600">
            <WarningCircle className="mt-0.5 size-3.5 shrink-0" weight="fill" />
            <span>{message}</span>
        </p>
    );
}

export function FieldHint({ children }: { children: ReactNode }) {
    return <p className="text-caption text-muted-foreground">{children}</p>;
}

interface IssueSummaryProps {
    blockers: string[];
    warnings: string[];
    /** Only render blockers once the user has tried to move on. */
    showBlockers: boolean;
}

export function IssueSummary({ blockers, warnings, showBlockers }: IssueSummaryProps) {
    const { t } = useTranslation('announcementCreatePrimitives');
    const visibleBlockers = showBlockers ? blockers : [];
    if (visibleBlockers.length === 0 && warnings.length === 0) return null;

    return (
        <div className="space-y-3">
            {visibleBlockers.length > 0 && (
                <div
                    role="alert"
                    className="rounded-md border border-danger-400 bg-danger-50 p-3 text-caption text-danger-600"
                >
                    <p className="flex items-center gap-2 font-semibold">
                        <WarningCircle className="size-4 shrink-0" weight="fill" />
                        {t('issueSummary.title', { count: visibleBlockers.length })}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-6">
                        {visibleBlockers.map((issue) => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                </div>
            )}
            {warnings.length > 0 && (
                <div className="rounded-md border border-warning-400 bg-warning-50 p-3 text-caption text-warning-600">
                    <p className="flex items-center gap-2 font-semibold">
                        <Info className="size-4 shrink-0" weight="fill" />
                        {t('issueSummary.worthChecking')}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-6">
                        {warnings.map((issue) => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

interface LoadFailureProps {
    message: string;
    onRetry?: () => void;
    className?: string;
}

/** Shown instead of an empty list when a lookup fails, so the user can recover without a reload. */
export function LoadFailure({ message, onRetry, className }: LoadFailureProps) {
    const { t } = useTranslation('announcementCreatePrimitives');
    return (
        <div
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger-400 bg-danger-50 p-3',
                className
            )}
        >
            <p className="flex items-start gap-2 text-caption text-danger-600">
                <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
                <span>{message}</span>
            </p>
            {onRetry && (
                <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                    <ArrowClockwise className="mr-1 size-4" />
                    {t('retry')}
                </MyButton>
            )}
        </div>
    );
}

interface EmptyStateProps {
    Icon?: Icon;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
}

export function EmptyState({
    Icon: EmptyIcon,
    title,
    description,
    action,
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center',
                className
            )}
        >
            {EmptyIcon && <EmptyIcon className="size-8 text-muted-foreground" weight="duotone" />}
            <p className="text-body font-semibold text-foreground">{title}</p>
            {description && (
                <p className="max-w-md text-caption text-muted-foreground">{description}</p>
            )}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}

/** Small labelled key/value used across the review step and preview rail. */
export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-caption font-semibold text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-body text-foreground">{children}</dd>
        </div>
    );
}
