import { useId, type ReactNode } from 'react';
import { get, useFormState, type Control, type FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ComposerForm } from '../forms/composer-schema';

/**
 * Small pieces the task editors share: the path type, a loose control for dynamic
 * sub-paths, inline error reading and the field chrome (label row, counter, error line).
 *
 * The editors address fields under one task with template paths
 * (`slots.2.items.4.question.options`). Typing each of those against the composer's
 * discriminated union would make every useController call resolve a deep union path,
 * so they go through `LooseControl` and type the values they read explicitly.
 */

/** One task inside the composer form: `slots.{day}.items.{task}`. */
export type ItemPath = `slots.${number}.items.${number}`;

export type LooseControl = Control<FieldValues>;

export function loose(control: Control<ComposerForm>): LooseControl {
    return control as unknown as LooseControl;
}

/** The array a task lives in (`slots.2.items`) and its index there. */
export function splitItemPath(name: ItemPath): { itemsPath: string; index: number } {
    const cut = name.lastIndexOf('.');
    return { itemsPath: name.slice(0, cut), index: Number(name.slice(cut + 1)) };
}

/** A field error's message, including an array's `root` error (zodResolver puts it there). */
export function errorText(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const node = error as { message?: unknown; root?: { message?: unknown } };
    if (typeof node.message === 'string' && node.message) return node.message;
    if (node.root && typeof node.root.message === 'string' && node.root.message) {
        return node.root.message;
    }
    return undefined;
}

/** The current error message (an i18n key, usually) at a path, or undefined. */
export function useFieldError(control: LooseControl, path: string): string | undefined {
    const { errors } = useFormState({ control, name: path });
    return errorText(get(errors, path));
}

/** Red inline message under a field. `message` is translated in the engagement namespace. */
export function FieldError({
    message,
    id,
    className,
}: {
    message?: string;
    id?: string;
    className?: string;
}) {
    const { t } = useTranslation('engagement');
    if (!message) return null;
    return (
        <p
            id={id}
            role="alert"
            className={cn('flex items-start gap-1 text-caption text-danger-600', className)}
        >
            <WarningCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t(message)}</span>
        </p>
    );
}

/** "12 / 200", turning to danger past the limit. Announced only by its field's label. */
export function CharCounter({
    length,
    max,
    className,
}: {
    length: number;
    max: number;
    className?: string;
}) {
    const over = length > max;
    return (
        <span
            aria-hidden
            className={cn(
                'shrink-0 text-caption tabular-nums',
                over ? 'font-semibold text-danger-600' : 'text-neutral-500',
                className
            )}
        >
            {length} / {max}
        </span>
    );
}

/**
 * A labelled block: label (and an optional right-side slot such as a counter), the
 * control, then a hint and an error. The control gets `id`, `aria-describedby` and
 * `aria-invalid` through the render prop.
 */
export function FieldBlock({
    label,
    hint,
    error,
    aside,
    children,
    className,
    required,
}: {
    label: ReactNode;
    hint?: ReactNode;
    error?: string;
    aside?: ReactNode;
    required?: boolean;
    className?: string;
    children: (a11y: {
        id: string;
        'aria-describedby'?: string;
        'aria-invalid'?: boolean;
    }) => ReactNode;
}) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
            <div className="flex items-end justify-between gap-2">
                <Label htmlFor={id} className="text-body font-medium text-neutral-700">
                    {label}
                    {required && (
                        <span className="ms-0.5 text-danger-600" aria-hidden>
                            *
                        </span>
                    )}
                </Label>
                {aside}
            </div>
            {children({
                id,
                'aria-describedby': describedBy || undefined,
                'aria-invalid': error ? true : undefined,
            })}
            {hint && (
                <p id={hintId} className="text-caption text-neutral-500">
                    {hint}
                </p>
            )}
            <FieldError id={errorId} message={error} />
        </div>
    );
}

/** A number input's value from a form number: NaN (an emptied field) shows as ''. */
export function numberInputValue(value: unknown): string | number {
    return typeof value === 'number' && Number.isFinite(value) ? value : '';
}

/** A number input's text as a form number: '' becomes NaN so zod reports it as missing. */
export function parseNumberInput(raw: string): number {
    return raw.trim() === '' ? Number.NaN : Number(raw);
}
