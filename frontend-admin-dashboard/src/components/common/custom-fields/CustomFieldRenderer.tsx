import { useState, type ReactNode } from 'react';
import { MyInput } from '@/components/design-system/input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarBlank, Spinner } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { isUnrestrictedFileTypes, type CustomFieldType } from '@/services/custom-field-settings';

interface CustomFieldRendererProps {
    type: CustomFieldType | string;
    name: string;
    value?: string;
    onChange?: (value: string) => void;
    options?: string[];
    required?: boolean;
    disabled?: boolean;
    config?: {
        defaultValue?: string;
        allowedFileTypes?: string[];
        maxSizeMB?: number;
        heading?: string;
        description?: string;
    };
    onFileUpload?: (file: File) => void;
    /**
     * Optional icon drawn inside the control, left of the value. Only text-like inputs and
     * dropdowns show it; other types (phone already has its flag) ignore it.
     */
    leadingIcon?: ReactNode;
}

export const CustomFieldRenderer = ({
    type,
    name,
    value,
    onChange,
    options = [],
    required = false,
    disabled = false,
    config,
    onFileUpload,
    leadingIcon,
}: CustomFieldRendererProps) => {
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadedFileName, setUploadedFileName] = useState<string>('');
    const { uploadFile, getPublicUrl } = useFileUpload();

    const handleChange = (newValue: string) => {
        onChange?.(newValue);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowedFileTypes = config?.allowedFileTypes;
        if (!isUnrestrictedFileTypes(allowedFileTypes) && allowedFileTypes) {
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            if (!allowedFileTypes.some((t) => t.toLowerCase() === ext)) {
                alert(`File type .${ext} is not allowed. Allowed: ${allowedFileTypes.join(', ')}`);
                e.target.value = '';
                return;
            }
        }

        if (config?.maxSizeMB && file.size > config.maxSizeMB * 1024 * 1024) {
            alert(`File size must be less than ${config.maxSizeMB}MB`);
            e.target.value = '';
            return;
        }

        try {
            let userId = 'anonymous';
            try {
                const token = getTokenFromCookie(TokenKey.accessToken);
                const decoded = token ? getTokenDecodedData(token) : null;
                if (decoded?.user) userId = decoded.user;
            } catch {
                // ignore — fallback to anonymous
            }

            setIsUploading(true);
            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId,
                source: 'CUSTOM_FIELD',
                sourceId: 'CUSTOM_FIELD_VALUE',
                publicUrl: true,
            });

            if (fileId) {
                const publicUrl = await getPublicUrl(fileId);
                const finalValue = publicUrl || fileId;
                setUploadedFileName(file.name);
                handleChange(finalValue);
                onFileUpload?.(file);
            }
        } catch (err) {
            console.error('File upload failed:', err);
            alert('File upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    // Lower-cased before matching: field_type is stored with whatever casing whichever screen
    // created the field happened to use, and prod holds hundreds of upper-case rows (DROPDOWN,
    // RADIO, MULTI_SELECT, CHECKBOX, DATE, FILE, PHONE, NUMBER, EMAIL, TEXT) alongside the
    // lower-case ones. A case-sensitive match sent every one of those to the `default` branch,
    // which is a plain text box -- so a DROPDOWN silently lost its options and a DATE its
    // picker, with nothing to indicate the field had been configured at all. The learner app's
    // renderer already normalises (it upper-cases); this matches that behaviour.
    // 'textfield' is the legacy alias AddCustomFieldDialog still reports for 'text'.
    const withLeadingIcon = (control: ReactNode) =>
        leadingIcon ? (
            // No z-index on the icon and it comes after the control: it paints over its own
            // input but stays under any popup (e.g. the phone field's country list).
            <div className="relative">
                {control}
                <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-neutral-500">
                    {leadingIcon}
                </span>
            </div>
        ) : (
            control
        );

    const rawType = String(type ?? '').trim().toLowerCase();
    const effectiveType = rawType === 'textfield' ? 'text' : rawType;

    switch (effectiveType) {
        case 'text':
            return withLeadingIcon(
                <MyInput
                    inputType="text"
                    inputPlaceholder={`Enter ${name}`}
                    input={value || ''}
                    onChangeFunction={(e) => handleChange(e.target.value)}
                    size="large"
                    className={cn('w-full', leadingIcon && 'pl-10 sm:w-full')}
                    disabled={disabled}
                    required={required}
                />
            );

        case 'number':
            return withLeadingIcon(
                <MyInput
                    inputType="number"
                    inputPlaceholder={`Enter ${name}`}
                    input={value || ''}
                    onChangeFunction={(e) => handleChange(e.target.value)}
                    size="large"
                    className={cn('w-full', leadingIcon && 'pl-10 sm:w-full')}
                    disabled={disabled}
                    required={required}
                />
            );

        case 'email':
            return withLeadingIcon(
                <MyInput
                    inputType="email"
                    inputPlaceholder={`Enter ${name}`}
                    input={value || ''}
                    onChangeFunction={(e) => handleChange(e.target.value)}
                    size="large"
                    className={cn('w-full', leadingIcon && 'pl-10 sm:w-full')}
                    disabled={disabled}
                    required={required}
                />
            );

        case 'url':
            return withLeadingIcon(
                <MyInput
                    inputType="url"
                    inputPlaceholder={`Enter ${name}`}
                    input={value || ''}
                    onChangeFunction={(e) => handleChange(e.target.value)}
                    size="large"
                    className={cn('w-full', leadingIcon && 'pl-10 sm:w-full')}
                    disabled={disabled}
                    required={required}
                />
            );

        case 'phone':
            return (
                <PhoneNumberInput
                    name={name}
                    label=""
                    value={value || ''}
                    onChange={(_n, val) => handleChange(val)}
                    placeholder={`Enter ${name}`}
                    required={required}
                    disabled={disabled}
                />
            );

        case 'date':
            return (
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={disabled}
                            className="flex w-full items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <CalendarBlank size={16} className="text-neutral-500" />
                            {value ? (
                                format(new Date(value), 'PPP')
                            ) : (
                                <span className="text-neutral-400">Pick a date</span>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={value ? new Date(value) : undefined}
                            onSelect={(date) => {
                                if (date) {
                                    handleChange(date.toISOString().split('T')[0] ?? '');
                                }
                                setDatePickerOpen(false);
                            }}
                        />
                    </PopoverContent>
                </Popover>
            );

        case 'textarea':
            return (
                <textarea
                    placeholder={`Enter ${name}`}
                    value={value || ''}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled}
                    required={required}
                    rows={3}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
            );

        case 'checkbox': {
            // Optional section heading + long body (e.g. Terms & Conditions)
            // shown above the box. Heading stays pinned; body scrolls.
            const heading = config?.heading;
            const description = config?.description;
            return (
                <div className="flex flex-col gap-2">
                    {heading && (
                        <h3 className="text-base font-semibold text-neutral-800">{heading}</h3>
                    )}
                    {description && (
                        <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                            {description}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={value === 'true'}
                            onCheckedChange={(checked) =>
                                handleChange(checked === true ? 'true' : 'false')
                            }
                            disabled={disabled}
                        />
                        <Label className="text-sm">
                            {name}
                            {required && <span className="text-danger-600"> *</span>}
                        </Label>
                    </div>
                </div>
            );
        }

        case 'dropdown':
            return (
                <Select
                    value={value || ''}
                    onValueChange={handleChange}
                    disabled={disabled}
                >
                    <SelectTrigger
                        className={cn(
                            'w-full',
                            leadingIcon && 'h-10 data-[placeholder]:text-neutral-400'
                        )}
                    >
                        {leadingIcon ? (
                            // A div, not a span: the trigger line-clamps its direct <span>
                            // children, which would override this flex row.
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex shrink-0 text-neutral-500">
                                    {leadingIcon}
                                </span>
                                <SelectValue placeholder={`Select ${name}`} />
                            </div>
                        ) : (
                            <SelectValue placeholder={`Select ${name}`} />
                        )}
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((opt, idx) => (
                            <SelectItem key={idx} value={opt}>
                                {opt}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );

        case 'radio':
            // Wrapped in a div so FormControl's Slot doesn't merge
            // id/aria-* directly onto the Radix RadioGroup root.
            return (
                <div>
                    <RadioGroup
                        value={value || ''}
                        onValueChange={handleChange}
                        disabled={disabled}
                        className="flex flex-col gap-2"
                    >
                        {options.map((opt, idx) => (
                            <div key={idx} className="flex items-center space-x-2">
                                <RadioGroupItem value={opt} id={`${name}-${idx}`} />
                                <Label htmlFor={`${name}-${idx}`}>{opt}</Label>
                            </div>
                        ))}
                    </RadioGroup>
                </div>
            );

        case 'multi_select': {
            // Multi-select checkboxes: value is a JSON array like ["Option1","Option3"]
            let selected: string[] = [];
            try {
                selected = value ? JSON.parse(value) : [];
            } catch {
                selected = value ? [value] : [];
            }
            const toggleOption = (opt: string) => {
                const next = selected.includes(opt)
                    ? selected.filter((s) => s !== opt)
                    : [...selected, opt];
                handleChange(JSON.stringify(next));
            };
            return (
                <div className="flex flex-col gap-2">
                    {options.map((opt, idx) => (
                        <div key={idx} className="flex items-center space-x-2">
                            <Checkbox
                                checked={selected.includes(opt)}
                                onCheckedChange={() => toggleOption(opt)}
                                disabled={disabled}
                                id={`${name}-ms-${idx}`}
                            />
                            <Label htmlFor={`${name}-ms-${idx}`}>{opt}</Label>
                        </div>
                    ))}
                </div>
            );
        }

        case 'file': {
            const fileTypes = config?.allowedFileTypes;
            const acceptAttr = isUnrestrictedFileTypes(fileTypes)
                ? undefined
                : fileTypes!.map((t) => `.${t}`).join(',');
            const isValidUrl = value && (value.startsWith('http://') || value.startsWith('https://'));
            return (
                <div className="flex flex-col gap-2">
                    <input
                        type="file"
                        accept={acceptAttr}
                        disabled={disabled || isUploading}
                        onChange={handleFileChange}
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-primary-50 file:px-4 file:py-1 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    {isUploading && (
                        <div className="flex items-center gap-2 text-sm text-neutral-600">
                            <Spinner className="size-4 animate-spin" />
                            Uploading...
                        </div>
                    )}
                    {!isUploading && uploadedFileName && (
                        <div className="text-xs text-success-600">
                            Uploaded: {uploadedFileName}
                        </div>
                    )}
                    {!isUploading && !uploadedFileName && isValidUrl && (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-500 underline"
                        >
                            View current file
                        </a>
                    )}
                    {!isUnrestrictedFileTypes(fileTypes) && (
                        <p className="text-xs text-neutral-500">
                            Allowed: {fileTypes!.join(', ')}
                            {config?.maxSizeMB && ` · Max ${config.maxSizeMB}MB`}
                        </p>
                    )}
                </div>
            );
        }

        default:
            return (
                <MyInput
                    inputType="text"
                    inputPlaceholder={`Enter ${name}`}
                    input={value || ''}
                    onChangeFunction={(e) => handleChange(e.target.value)}
                    size="large"
                    className="w-full"
                    disabled={disabled}
                    required={required}
                />
            );
    }
};
