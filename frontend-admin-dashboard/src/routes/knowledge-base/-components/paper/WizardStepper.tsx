import { Check } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface WizardStep {
    key: string;
    label: string;
}

interface WizardStepperProps {
    steps: WizardStep[];
    activeIndex: number;
    /** Steps the teacher may jump back to (only completed ones are clickable). */
    onSelect?: (index: number) => void;
    className?: string;
}

/**
 * The vertical rail on the left of the paper wizard — one numbered circle per
 * step, ticks for the ones behind you. Earlier steps are clickable so a
 * teacher can go back and change the syllabus without losing the mix they
 * configured after it.
 */
export const WizardStepper = ({ steps, activeIndex, onSelect, className }: WizardStepperProps) => (
    <ol className={cn('flex flex-col', className)}>
        {steps.map((step, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;
            const clickable = done && Boolean(onSelect);
            return (
                <li key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => clickable && onSelect?.(index)}
                            aria-current={active ? 'step' : undefined}
                            className={cn(
                                'flex size-7 shrink-0 items-center justify-center rounded-full border text-caption font-semibold transition-colors',
                                done && 'border-success-500 bg-success-500 text-white',
                                active && 'border-primary-500 bg-primary-500 text-white',
                                !done && !active && 'border-neutral-300 bg-white text-neutral-400',
                                clickable && 'cursor-pointer hover:opacity-90',
                                !clickable && 'cursor-default'
                            )}
                        >
                            {done ? <Check className="size-3.5" weight="bold" /> : index + 1}
                        </button>
                        {index < steps.length - 1 && (
                            <span
                                className={cn(
                                    'my-1 min-h-6 w-px flex-1',
                                    done ? 'bg-success-300' : 'bg-neutral-200'
                                )}
                            />
                        )}
                    </div>
                    <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && onSelect?.(index)}
                        className={cn(
                            'pb-6 pt-1 text-left text-body',
                            active ? 'font-semibold text-neutral-700' : 'text-neutral-500',
                            clickable ? 'cursor-pointer hover:text-neutral-700' : 'cursor-default'
                        )}
                    >
                        {step.label}
                    </button>
                </li>
            );
        })}
    </ol>
);
