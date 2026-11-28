import type { ReactNode } from 'react';
import { Check, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { FieldError, FieldHint } from '../../create/-components/primitives';

interface StepBadgeProps {
    step: number;
    /** Danger styling once the user has tried to send and this section still blocks it. */
    invalid?: boolean;
    /** Success styling when the section is complete and clean. */
    done?: boolean;
}

/** Numbered marker for each section. Purely visual — sections are never gated. */
export function StepBadge({ step, invalid, done }: StepBadgeProps) {
    return (
        <span
            aria-hidden
            className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-subtitle font-semibold transition-colors',
                invalid
                    ? 'bg-danger-50 text-danger-600'
                    : done
                      ? 'bg-success-50 text-success-600'
                      : 'bg-primary-50 text-primary-500'
            )}
        >
            {invalid ? (
                <WarningCircle className="size-5" weight="fill" />
            ) : done ? (
                <Check className="size-5" weight="bold" />
            ) : (
                step
            )}
        </span>
    );
}

interface FieldProps {
    label: string;
    hint?: string;
    /** Trailing element on the label row — a counter, a link, a chip. */
    trailing?: ReactNode;
    required?: boolean;
    error?: string;
    htmlFor?: string;
    children: ReactNode;
    className?: string;
}

/** Label + control + hint/error, laid out the same way on every section. */
export function Field({
    label,
    hint,
    trailing,
    required,
    error,
    htmlFor,
    children,
    className,
}: FieldProps) {
    return (
        <div className={cn('space-y-1', className)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={htmlFor} className="text-caption font-semibold">
                    {label}
                    {required && <span className="text-danger-600"> *</span>}
                </Label>
                {trailing}
            </div>
            {children}
            {error ? <FieldError message={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
        </div>
    );
}

interface CharCountProps {
    value: number;
    /** Warn (not block) past this. */
    soft: number;
}

export function CharCount({ value, soft }: CharCountProps) {
    return (
        <span
            className={cn(
                'text-caption tabular-nums',
                value > soft ? 'text-warning-600' : 'text-muted-foreground'
            )}
        >
            {value}/{soft}
        </span>
    );
}

/**
 * Placeholders the notification service substitutes per recipient at send time
 * (AnnouncementDeliveryService.buildTokenMap). Kept to the ones an admin can reason about.
 */
export const EMAIL_VARIABLES = [
    { token: '{{name}}', key: 'name' },
    { token: '{{first_name}}', key: 'firstName' },
    { token: '{{email}}', key: 'email' },
    { token: '{{username}}', key: 'username' },
    { token: '{{password}}', key: 'password' },
    { token: '{{mobile_number}}', key: 'mobile' },
    { token: '{{institute_email}}', key: 'instituteEmail' },
    { token: '{{current_date}}', key: 'currentDate' },
    { token: '{{current_time}}', key: 'currentTime' },
] as const;
