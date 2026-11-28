import { Check, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type StepState = 'done' | 'current' | 'error' | 'todo';

export interface RailStep {
    key: string;
    label: string;
    state: StepState;
    onSelect: () => void;
}

/**
 * Progress across the form's sections. The form stays one page, so a step is a jump link
 * (scrolls to its section) that also shows whether that section is complete.
 */
export function StepRail({ steps, label }: { steps: RailStep[]; label: string }) {
    return (
        <nav aria-label={label} className="overflow-x-auto">
            <ol className="flex min-w-max items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm sm:min-w-0">
                {steps.map((step, index) => (
                    <li
                        key={step.key}
                        className="flex flex-1 items-center gap-2 last:flex-none sm:min-w-0"
                    >
                        <button
                            type="button"
                            onClick={step.onSelect}
                            aria-current={step.state === 'current' ? 'step' : undefined}
                            className={cn(
                                'flex shrink-0 items-center gap-2 rounded-md px-1 py-0.5 text-caption font-semibold transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                step.state === 'done' && 'text-success-600',
                                step.state === 'current' && 'text-primary-600',
                                step.state === 'error' && 'text-danger-600',
                                step.state === 'todo' && 'text-neutral-400 hover:text-neutral-600'
                            )}
                        >
                            <span
                                className={cn(
                                    'flex size-7 shrink-0 items-center justify-center rounded-full border-2 bg-white',
                                    step.state === 'done' &&
                                        'border-success-500 bg-success-500 text-white',
                                    step.state === 'current' &&
                                        'border-primary-500 text-primary-600 ring-4 ring-primary-50',
                                    step.state === 'error' &&
                                        'border-danger-500 bg-danger-50 text-danger-600',
                                    step.state === 'todo' && 'border-neutral-300'
                                )}
                            >
                                {step.state === 'done' ? (
                                    <Check className="size-3.5" weight="bold" />
                                ) : step.state === 'error' ? (
                                    <WarningCircle className="size-4" weight="fill" />
                                ) : (
                                    index + 1
                                )}
                            </span>
                            <span className="whitespace-nowrap">{step.label}</span>
                        </button>
                        {index < steps.length - 1 && (
                            <span
                                aria-hidden
                                className={cn(
                                    'h-0.5 w-6 flex-1 rounded-full',
                                    step.state === 'done' ? 'bg-success-200' : 'bg-neutral-200'
                                )}
                            />
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
}
