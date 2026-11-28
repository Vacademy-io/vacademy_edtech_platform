import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * `MyInput` and `Checkbox` wired to react-hook-form for the commerce settings
 * forms. `MyInput` takes `input`/`onChangeFunction`, so the adapter lives here
 * once and the forms read as a list of fields.
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

export function CommerceTextField<T extends FieldValues>({
    control,
    name,
    label,
    placeholder,
    description,
    required,
    disabled,
    className,
    inputType = 'text',
    inputMode,
    maxLength,
    transform,
}: BaseFieldProps<T> & {
    inputType?: string;
    inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
    maxLength?: number;
    /** Applied to what was typed before it reaches the form (upper-case a code). */
    transform?: (value: string) => string;
}) {
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
                            onChangeFunction={(event) =>
                                field.onChange(
                                    transform ? transform(event.target.value) : event.target.value
                                )
                            }
                            onBlur={field.onBlur}
                            inputType={inputType}
                            inputMode={inputMode}
                            maxLength={maxLength}
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

export interface CommerceSelectOption {
    value: string;
    label: string;
}

/**
 * Single select for a commerce form. Same primitives as the design system's
 * `SelectField`, with a translated placeholder and an empty-list message (that
 * component's placeholder is fixed English text).
 */
export function CommerceSelectField<T extends FieldValues>({
    control,
    name,
    label,
    placeholder,
    description,
    required,
    disabled,
    options,
    emptyText,
}: BaseFieldProps<T> & { options: CommerceSelectOption[]; emptyText?: string }) {
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
                    <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        disabled={disabled}
                    >
                        <FormControl>
                            <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                                <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {options.length === 0 && emptyText && (
                                <p className="p-2 text-caption text-muted-foreground">
                                    {emptyText}
                                </p>
                            )}
                            {options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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

export function CommerceCheckboxField<T extends FieldValues>({
    control,
    name,
    label,
    description,
    disabled,
}: Pick<BaseFieldProps<T>, 'control' | 'name' | 'label' | 'description' | 'disabled'>) {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-2">
                    <FormControl>
                        <Checkbox
                            checked={field.value === true}
                            disabled={disabled}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                    </FormControl>
                    <div className="flex flex-col gap-0.5">
                        <FormLabel className="!mt-0 text-body text-foreground">{label}</FormLabel>
                        {description && (
                            <FormDescription className="text-caption text-muted-foreground">
                                {description}
                            </FormDescription>
                        )}
                    </div>
                </FormItem>
            )}
        />
    );
}
