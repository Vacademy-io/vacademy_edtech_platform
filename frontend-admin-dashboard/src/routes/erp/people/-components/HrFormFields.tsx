import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { MyInput } from '@/components/design-system/input';
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * `MyInput` / `Textarea` wired to react-hook-form.
 *
 * `MyInput` predates the `Form` plumbing and takes `input`/`onChangeFunction`
 * rather than `value`/`onChange`, so every call site would otherwise repeat the
 * same six-line adapter. These two wrappers do it once — the People forms then
 * read as a list of fields.
 */

interface BaseFieldProps<T extends FieldValues> {
    control: Control<T>;
    name: FieldPath<T>;
    label: string;
    placeholder?: string;
    description?: ReactNode;
    required?: boolean;
    disabled?: boolean;
    className?: string;
}

export function HrTextField<T extends FieldValues>({
    control,
    name,
    label,
    placeholder,
    description,
    required,
    disabled,
    className,
    inputType = 'text',
}: BaseFieldProps<T> & { inputType?: string }) {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className="flex flex-col gap-1.5">
                    <FormLabel className="text-body font-regular text-foreground">
                        {label}
                        {required && <span className="ms-0.5 text-danger-600">*</span>}
                    </FormLabel>
                    <FormControl>
                        <MyInput
                            ref={field.ref}
                            name={field.name}
                            input={field.value ?? ''}
                            onChangeFunction={field.onChange}
                            onBlur={field.onBlur}
                            inputType={inputType}
                            inputPlaceholder={placeholder}
                            disabled={disabled}
                            className={cn('sm:w-full', className)}
                        />
                    </FormControl>
                    {description && (
                        <FormDescription className="text-caption text-muted-foreground">
                            {description}
                        </FormDescription>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

export function HrTextareaField<T extends FieldValues>({
    control,
    name,
    label,
    placeholder,
    description,
    required,
    disabled,
    className,
    rows = 3,
}: BaseFieldProps<T> & { rows?: number }) {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className="flex flex-col gap-1.5">
                    <FormLabel className="text-body font-regular text-foreground">
                        {label}
                        {required && <span className="ms-0.5 text-danger-600">*</span>}
                    </FormLabel>
                    <FormControl>
                        <Textarea
                            {...field}
                            value={field.value ?? ''}
                            rows={rows}
                            placeholder={placeholder}
                            disabled={disabled}
                            className={cn('text-body', className)}
                        />
                    </FormControl>
                    {description && (
                        <FormDescription className="text-caption text-muted-foreground">
                            {description}
                        </FormDescription>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
