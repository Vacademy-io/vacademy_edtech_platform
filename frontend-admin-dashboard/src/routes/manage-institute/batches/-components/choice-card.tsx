/**
 * One option of a Create Batch "existing / new" choice, drawn as a card. Must sit
 * inside a RadioGroup — the radio is real, the whole card is its label.
 */
import { RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface ChoiceCardProps {
    id: string;
    value: string;
    selected: boolean;
    disabled?: boolean;
    icon: ReactNode;
    /** Classes for the icon tile, e.g. its colour pair. */
    iconClassName: string;
    title: string;
    description: string;
}

export const ChoiceCard = ({
    id,
    value,
    selected,
    disabled = false,
    icon,
    iconClassName,
    title,
    description,
}: ChoiceCardProps) => (
    <label
        htmlFor={id}
        className={cn(
            'flex items-center gap-4 rounded-xl border bg-white p-4 transition-colors',
            selected
                ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                : 'border-neutral-200 hover:border-primary-200',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        )}
    >
        <RadioGroupItem value={value} id={id} disabled={disabled} />
        <span
            className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-lg',
                iconClassName
            )}
        >
            {icon}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-subtitle font-semibold text-neutral-800">{title}</span>
            <span className="text-body text-neutral-500">{description}</span>
        </span>
    </label>
);
