import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Field primitives of the Learning Path property panel. */

export const Toggle = ({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) => (
    <div className="flex items-start justify-between gap-3">
        <div>
            <Label className="text-xs">{label}</Label>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
);

export const TextField = ({
    label,
    value,
    placeholder,
    onChange,
    hint,
}: {
    label: string;
    value: string;
    placeholder?: string;
    onChange: (v: string) => void;
    hint?: string;
}) => {
    const id = useId();
    return (
        <div>
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            <Input
                id={id}
                className="mt-1"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                aria-describedby={hint ? `${id}-hint` : undefined}
            />
            {hint && (
                <p id={`${id}-hint`} className="mt-1 text-caption text-neutral-500">
                    {hint}
                </p>
            )}
        </div>
    );
};
