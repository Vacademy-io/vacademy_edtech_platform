import type { HTMLAttributes } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { MyInput } from '@/components/design-system/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

/** One labelled text field in the design-system form stack, full width on a phone. */
export function TextField<T extends FieldValues>({
    control,
    name,
    label,
    type = 'text',
    autoComplete,
    inputMode,
    autoCapitalize,
    maxLength,
}: {
    control: Control<T>;
    name: FieldPath<T>;
    label: string;
    type?: string;
    autoComplete: string;
    inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
    autoCapitalize?: string;
    maxLength?: number;
}) {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel className="text-subtitle text-foreground">{label}</FormLabel>
                    <FormControl>
                        <MyInput
                            ref={field.ref}
                            name={field.name}
                            onBlur={field.onBlur}
                            inputType={type}
                            input={field.value ?? ''}
                            onChangeFunction={field.onChange}
                            size="large"
                            autoComplete={autoComplete}
                            inputMode={inputMode}
                            autoCapitalize={autoCapitalize}
                            maxLength={maxLength}
                            className="text-foreground sm:w-full"
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

const SELECT_CLASS =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-subtitle text-foreground';

/** A native select: the phone's own picker is better here than a custom popover. */
export function SelectInput({
    label,
    value,
    onChange,
    options,
    name,
}: {
    label: string;
    name: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <label className="flex flex-col gap-2 text-subtitle text-foreground">
            {label}
            <select
                name={name}
                className={SELECT_CLASS}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
