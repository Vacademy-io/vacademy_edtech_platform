import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Small controls shared by the header editor's settings (same look as the
 * Folder Browser section's panel).
 */

export const HeaderToggle = ({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) => {
    const id = useId();
    return (
        <div className="flex items-start justify-between gap-3">
            <div>
                <Label htmlFor={id} className="text-xs">
                    {label}
                </Label>
                {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );
};

export const HeaderChoice = <T extends string>({
    label,
    value,
    options,
    onChange,
    hint,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
    hint?: string;
}) => (
    <div role="group" aria-label={label}>
        <Label className="text-xs">{label}</Label>
        <div className="mt-1 flex flex-wrap gap-1">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    aria-pressed={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'rounded px-2.5 py-1 text-caption font-medium',
                        value === o.value
                            ? 'bg-primary-100 text-primary-500'
                            : 'bg-neutral-100 text-neutral-600'
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
        {hint && <p className="mt-1 text-caption text-neutral-500">{hint}</p>}
    </div>
);
