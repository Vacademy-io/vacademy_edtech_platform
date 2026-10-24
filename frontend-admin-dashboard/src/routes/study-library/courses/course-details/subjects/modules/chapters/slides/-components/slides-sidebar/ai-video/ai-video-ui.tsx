import type { ReactNode } from 'react';
import { Check, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { LmsVideoLayout } from '@/services/lms-ai-video';

/** "1 What to teach — 2 Format — 3 Review & create" with the current step highlighted. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
    return (
        <ol className="flex items-center gap-2" aria-label={steps[current]}>
            {steps.map((label, index) => {
                const done = index < current;
                const active = index === current;
                return (
                    <li
                        key={label}
                        className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
                        aria-current={active ? 'step' : undefined}
                    >
                        <span
                            className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                                active && 'bg-primary-500 text-white',
                                done && 'bg-primary-100 text-primary-600',
                                !active && !done && 'bg-muted text-muted-foreground'
                            )}
                        >
                            {done ? <Check className="size-3.5" weight="bold" /> : index + 1}
                        </span>
                        <span
                            className={cn(
                                'truncate text-sm',
                                active
                                    ? 'font-medium text-foreground'
                                    : 'hidden text-muted-foreground sm:inline'
                            )}
                        >
                            {label}
                        </span>
                        {index < steps.length - 1 && (
                            <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/** Small section heading with an optional helper line. */
export function SectionHeading({
    title,
    helper,
    action,
}: {
    title: string;
    helper?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
                <h3 className="text-sm font-medium text-foreground">{title}</h3>
                {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
            </div>
            {action}
        </div>
    );
}

export interface ChoiceOption<T extends string> {
    value: T;
    label: string;
    helper?: string;
    disabled?: boolean;
    /** Shown as the button's tooltip when disabled. */
    disabledReason?: string;
}

/** Segmented single choice (voice, length, quality). Arrow keys are not needed: each option is a button. */
export function ChoiceGroup<T extends string>({
    label,
    value,
    options,
    onChange,
    columns = 'auto',
}: {
    label: string;
    value: T;
    options: ChoiceOption<T>[];
    onChange: (value: T) => void;
    columns?: 'auto' | 'two' | 'three' | 'four';
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cn(
                'grid gap-2',
                columns === 'auto' && 'grid-flow-col',
                columns === 'two' && 'grid-cols-2',
                columns === 'three' && 'grid-cols-1 sm:grid-cols-3',
                columns === 'four' && 'grid-cols-2 sm:grid-cols-4'
            )}
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={option.disabled}
                        title={option.disabled ? option.disabledReason : undefined}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            'flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-start transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                            selected
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-border bg-card hover:border-primary-200 hover:bg-muted',
                            option.disabled && 'cursor-not-allowed opacity-50 hover:bg-card'
                        )}
                    >
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        {option.helper && (
                            <span className="text-xs text-muted-foreground">{option.helper}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/** A picked/unpicked teacher card with the avatar's preview image (or initial). */
export function TeacherCard({
    selected,
    title,
    subtitle,
    imageUrl,
    onClick,
}: {
    selected: boolean;
    title: string;
    subtitle: string;
    imageUrl?: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onClick}
            className={cn(
                'flex items-center gap-3 rounded-md border p-2 text-start transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                selected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-border bg-card hover:border-primary-200 hover:bg-muted'
            )}
        >
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                {imageUrl ? (
                    <img src={imageUrl} alt="" className="size-full object-cover" />
                ) : (
                    title.slice(0, 1).toUpperCase()
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{title}</span>
                <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
            </span>
            {selected && <CheckCircle className="size-5 shrink-0 text-primary-500" weight="fill" />}
        </button>
    );
}

/**
 * Schematic of where the teacher sits on the frame: the light block is the
 * board, the brand-coloured shape is the teacher.
 */
function LayoutSketch({ layout }: { layout: LmsVideoLayout }) {
    const boardWidth =
        layout === 'side' ? 'w-9/12' : layout === 'presenter' ? 'w-7/12' : 'w-auto end-1';
    return (
        <span className="relative block aspect-video w-full overflow-hidden rounded-sm bg-muted">
            <span
                className={cn(
                    'absolute inset-y-1 start-1 rounded-sm bg-card shadow-sm',
                    boardWidth
                )}
            />
            {layout === 'corner' && (
                <span className="absolute bottom-1 end-1 h-2/5 w-1/5 rounded-t-full bg-primary-400" />
            )}
            {layout === 'bubble' && (
                <span className="absolute bottom-1 end-1 aspect-square h-1/2 rounded-full border-2 border-card bg-primary-400" />
            )}
            {layout === 'side' && (
                <span className="absolute inset-y-1 end-1 w-1/5 rounded-sm bg-primary-300" />
            )}
            {layout === 'presenter' && (
                <span className="absolute inset-y-1 end-1 w-1/3 rounded-sm bg-primary-300" />
            )}
        </span>
    );
}

export function LayoutThumbnail({
    layout,
    label,
    selected,
    onClick,
}: {
    layout: LmsVideoLayout;
    label: string;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onClick}
            className={cn(
                'flex flex-col gap-1.5 rounded-md border p-1.5 text-start transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                selected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-border bg-card hover:border-primary-200'
            )}
        >
            <LayoutSketch layout={layout} />
            <span className="truncate px-0.5 text-xs font-medium text-foreground">{label}</span>
        </button>
    );
}

/** Inline message box. Tone maps to the semantic scales only. */
export function Notice({
    tone,
    title,
    children,
    icon,
}: {
    tone: 'danger' | 'warning' | 'info';
    title?: string;
    children?: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <div
            role={tone === 'danger' ? 'alert' : 'status'}
            className={cn(
                'flex gap-2 rounded-md border px-3 py-2 text-sm',
                tone === 'danger' && 'border-danger-200 bg-danger-50 text-danger-700',
                tone === 'warning' && 'border-warning-200 bg-warning-50 text-warning-700',
                tone === 'info' && 'border-info-200 bg-info-50 text-info-700'
            )}
        >
            {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0 space-y-1">
                {title && <p className="font-medium">{title}</p>}
                {children}
            </div>
        </div>
    );
}
