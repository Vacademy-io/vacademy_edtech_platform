import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ProductLocale } from '@/routes/commerce/-shared/catalogue-types';

/**
 * Small building blocks shared by the catalogue screens (products,
 * collections, import): a section card, a label-and-select that is not part of
 * a react-hook-form form, and the admin's own language.
 */

/** The language the admin reads the app in, as one of the two product languages. */
export function useAdminLanguage(): ProductLocale {
    const { i18n } = useTranslation('commerce');
    return (i18n.language ?? '').toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export function SectionCard({
    id,
    title,
    description,
    actions,
    children,
    className,
}: {
    /** Anchor for "go to field" links from the publish blockers. */
    id?: string;
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            id={id}
            className={cn(
                'flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-card p-4',
                className
            )}
        >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <h3 className="text-subtitle font-medium text-foreground">{title}</h3>
                    {description && (
                        <p className="text-caption text-muted-foreground">{description}</p>
                    )}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    );
}

export interface PlainOption {
    value: string;
    label: string;
}

/** Value of the "nothing chosen" row; Radix Select does not allow an empty value. */
const NONE = '__none__';

/**
 * A labelled select outside a form (filters, the bulk bar, grid cells). With
 * `noneLabel` the first row clears the choice.
 */
export function PlainSelect({
    label,
    hideLabel,
    value,
    onChange,
    options,
    placeholder,
    noneLabel,
    disabled,
    className,
    invalid,
}: {
    label: string;
    /** Keep the label for screen readers only (a grid cell under a column header). */
    hideLabel?: boolean;
    value: string;
    onChange: (value: string) => void;
    options: PlainOption[];
    placeholder?: string;
    noneLabel?: string;
    disabled?: boolean;
    className?: string;
    invalid?: boolean;
}) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
            {!hideLabel && <span className="text-caption text-muted-foreground">{label}</span>}
            <Select
                value={value || (noneLabel ? NONE : undefined)}
                onValueChange={(next) => onChange(next === NONE ? '' : next)}
                disabled={disabled}
            >
                <SelectTrigger
                    aria-label={label}
                    aria-invalid={invalid || undefined}
                    className={cn('h-9 w-full', invalid && 'border-danger-600')}
                >
                    <SelectValue placeholder={placeholder ?? label} />
                </SelectTrigger>
                <SelectContent>
                    {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/** A field's error line; `role="alert"` so a screen reader hears it. */
export const FieldError = ({ message }: { message?: string | null }) =>
    message ? (
        <p role="alert" className="text-caption text-danger-600">
            {message}
        </p>
    ) : null;
