import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
    CaretDown,
    CaretUp,
    Check,
    CheckCircle,
    Eye,
    Gear,
    Lightbulb,
    PencilSimple,
    Plus,
    PlusSquare,
    X,
} from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    CUSTOM_FIELD_TYPES,
    COMMON_FILE_TYPES,
    ALL_FILES_VALUE,
    type CustomFieldType,
} from '@/services/custom-field-settings';
import { CustomFieldRenderer } from './CustomFieldRenderer';
import { InlineFieldEditor } from './InlineFieldEditor';

export interface DropdownOption {
    id: string;
    value: string;
    disabled?: boolean;
    /** Dependent dropdowns: the parent option value this option shows for. Absent = always. */
    parent?: string;
}

/** Another dropdown in the same form that a dropdown can be made to depend on. */
export interface ParentFieldCandidate {
    /** The parent's field_key — what the child stores as `parentFieldKey`. */
    key: string;
    label: string;
    options: string[];
}

export interface CustomFieldConfig {
    /** Whether the new field should be mandatory. Callers that ignore this default to true. */
    isRequired?: boolean;
    defaultValue?: string;
    min?: number;
    max?: number;
    minDate?: string;
    maxDate?: string;
    maxLength?: number;
    countryCode?: string;
    allowedFileTypes?: string[];
    maxSizeMB?: number;
    heading?: string;
    /** Dependent dropdowns: field_key of the dropdown whose answer filters this one's options. */
    parentFieldKey?: string;
    /** Checkbox consent body — rendered as a scrollable block above the box. */
    description?: string;
    /** Short hint shown under any field. Distinct from `description`. */
    helpText?: string;
    /**
     * Proof-of-ownership gate: the visitor must receive a one-time code on the
     * value they typed and enter it back before the form can be submitted.
     * Honoured by the product-page checkout and by catalogue lead forms.
     */
    verification?: {
        required?: boolean;
        channel?: 'WHATSAPP';
        /** Approved WhatsApp template. Blank uses the institute's OTP config. */
        templateName?: string;
        /** Language that template is approved in. Blank means English. */
        languageCode?: string;
    };
}

/**
 * Field types a one-time code can actually be delivered TO. Offering
 * verification anywhere else would produce a gate nobody can pass.
 */
const CAN_VERIFY = (type: string) => type === 'phone' || type === 'tel';

/** An existing field's current settings, used to prefill the dialog in edit mode. */
export interface CustomFieldInitialValues {
    /** Stored type string — `textfield` is accepted as an alias of `text`. */
    type: string;
    name: string;
    /** Option labels for choice types. */
    options?: string[];
    /** Index-aligned with `options`: each option's parent value (dependent dropdowns). */
    optionParents?: Array<string | undefined>;
    isRequired?: boolean;
    config?: CustomFieldConfig;
}

interface AddCustomFieldDialogProps {
    /** Omit when driving the dialog with `open`/`onOpenChange` from outside. */
    trigger?: React.ReactNode;
    onAddField: (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[],
        config?: CustomFieldConfig
    ) => void;
    existingFieldNames: string[];
    supportedTypes?: CustomFieldType[];
    /**
     * 'edit' prefills every input from `initialField` and swaps the copy/actions.
     * The submit callback is the same either way — the caller knows which field it opened.
     */
    mode?: 'add' | 'edit';
    initialField?: CustomFieldInitialValues;
    /** Controlled open state. Pass a `key` per edited field so the prefill re-runs. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * Shown under the header. Used to warn that the field being edited is shared
     * with other forms, since its type and label live on one row.
     */
    notice?: React.ReactNode;
    /**
     * The other dropdowns in this form. When passed, a dropdown gets a "Depends on"
     * picker and a per-option parent value. Callers that omit it see no change.
     */
    parentCandidates?: ParentFieldCandidate[];
}

const NO_PARENT = '__none__';
const ANY_PARENT_VALUE = '__any__';

const hasOptionsType = (type: CustomFieldType) =>
    type === 'dropdown' || type === 'radio' || type === 'multi_select';

/** Types with extra constraints worth tucking behind "Advanced options". */
const hasAdvancedOptions = (type: CustomFieldType) => type === 'file' || type === 'checkbox';

export const AddCustomFieldDialog = ({
    trigger,
    onAddField,
    existingFieldNames,
    supportedTypes,
    mode = 'add',
    initialField,
    notice,
    open: controlledOpen,
    onOpenChange,
    parentCandidates,
}: AddCustomFieldDialogProps) => {
    const { t } = useTranslation('commonCustomFieldDependency');
    const isEditMode = mode === 'edit';
    const isControlled = controlledOpen !== undefined;
    const [internalOpen, setInternalOpen] = useState(false);
    const isDialogOpen = isControlled ? controlledOpen : internalOpen;
    const setIsDialogOpen = (next: boolean) => {
        if (isControlled) onOpenChange?.(next);
        else setInternalOpen(next);
    };
    const [selectedType, setSelectedType] = useState<CustomFieldType>('text');
    const [typePickerOpen, setTypePickerOpen] = useState(false);
    const [fieldName, setFieldName] = useState('');
    const [isNameValid, setIsNameValid] = useState(false);
    const [dropdownOptions, setDropdownOptions] = useState<DropdownOption[]>([]);
    const [defaultValue, setDefaultValue] = useState('');
    const [isRequired, setIsRequired] = useState(true);
    const [helpTextEnabled, setHelpTextEnabled] = useState(false);
    const [helpText, setHelpText] = useState('');
    /**
     * The config the field arrived with. buildConfig starts from this so that
     * settings this dialog does not model (min/max, date bounds, maxLength,
     * countryCode) survive an edit instead of being silently dropped.
     */
    const [initialConfig, setInitialConfig] = useState<CustomFieldConfig>({});
    const [verifyEnabled, setVerifyEnabled] = useState(false);
    const [verifyTemplate, setVerifyTemplate] = useState('');
    const [verifyLanguage, setVerifyLanguage] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [checkboxDefault, setCheckboxDefault] = useState(false);
    const [checkboxHeading, setCheckboxHeading] = useState('');
    const [checkboxDescription, setCheckboxDescription] = useState('');
    const [allowedFileTypes, setAllowedFileTypes] = useState<string[]>([]);
    const [maxSizeMB, setMaxSizeMB] = useState<number>(5);
    const [parentKey, setParentKey] = useState('');

    const availableTypes = supportedTypes
        ? CUSTOM_FIELD_TYPES.filter((t) => supportedTypes.includes(t.value as CustomFieldType))
        : CUSTOM_FIELD_TYPES;

    const resetForm = () => {
        setFieldName('');
        setSelectedType('text');
        setDropdownOptions([]);
        setDefaultValue('');
        setIsRequired(true);
        setHelpTextEnabled(false);
        setHelpText('');
        setShowAdvanced(false);
        setCheckboxDefault(false);
        setCheckboxHeading('');
        setCheckboxDescription('');
        setAllowedFileTypes([]);
        setMaxSizeMB(5);
        setInitialConfig({});
        setVerifyEnabled(false);
        setVerifyTemplate('');
        setVerifyLanguage('');
        setParentKey('');
    };

    /** Load an existing field's settings into the form so editing starts from what is there. */
    const prefillFrom = (field: CustomFieldInitialValues) => {
        // Callers store short text as `textfield`; the picker knows it as `text`.
        const type = (field.type === 'textfield' ? 'text' : field.type) as CustomFieldType;
        const config = field.config ?? {};
        setSelectedType(type);
        setFieldName(field.name ?? '');
        setDropdownOptions(
            (field.options ?? []).map((value, idx) => {
                const parent = field.optionParents?.[idx];
                return { id: String(idx), value, ...(parent ? { parent } : {}) };
            })
        );
        setParentKey(config.parentFieldKey ?? '');
        setIsRequired(field.isRequired ?? true);
        setDefaultValue(type === 'checkbox' ? '' : config.defaultValue ?? '');
        setCheckboxDefault(config.defaultValue === 'true');
        setCheckboxHeading(config.heading ?? '');
        setCheckboxDescription(config.description ?? '');
        setHelpText(config.helpText ?? '');
        setHelpTextEnabled(Boolean(config.helpText));
        setInitialConfig(config);
        setVerifyEnabled(Boolean(config.verification?.required));
        setVerifyTemplate(config.verification?.templateName ?? '');
        setVerifyLanguage(config.verification?.languageCode ?? '');
        setAllowedFileTypes(config.allowedFileTypes ?? []);
        setMaxSizeMB(config.maxSizeMB ?? 5);
        // Open the panel straight away when it holds values the admin came to change.
        setShowAdvanced(
            Boolean(
                config.heading ||
                    config.description ||
                    config.allowedFileTypes?.length ||
                    config.defaultValue === 'true'
            )
        );
    };

    // Only dropdowns can depend on another field, and only for callers that offer it.
    const parentField =
        parentCandidates && selectedType === 'dropdown'
            ? parentCandidates.find((candidate) => candidate.key === parentKey)
            : undefined;

    const buildConfig = (): CustomFieldConfig | undefined => {
        // Start from what the field already had, so settings this dialog does not
        // model survive. Every key the dialog DOES own is then either set or
        // deleted below — a switch turned off has to actually remove its key,
        // not just decline to add it.
        const config: CustomFieldConfig = { ...initialConfig };

        if (selectedType === 'checkbox') {
            config.defaultValue = checkboxDefault ? 'true' : 'false';
            if (checkboxHeading.trim()) config.heading = checkboxHeading.trim();
            else delete config.heading;
            if (checkboxDescription.trim()) config.description = checkboxDescription.trim();
            else delete config.description;
        } else {
            // Switching away from a checkbox leaves its consent copy behind.
            delete config.heading;
            delete config.description;
            if (defaultValue.trim()) config.defaultValue = defaultValue.trim();
            else delete config.defaultValue;
        }

        if (selectedType === 'file') {
            if (allowedFileTypes.length > 0) config.allowedFileTypes = allowedFileTypes;
            else delete config.allowedFileTypes;
            config.maxSizeMB = maxSizeMB;
        } else {
            delete config.allowedFileTypes;
            delete config.maxSizeMB;
        }

        if (helpTextEnabled && helpText.trim()) config.helpText = helpText.trim();
        else delete config.helpText;

        // Verification is OPTIONAL and must be removable: turning the switch off,
        // or changing to a type a code cannot be delivered to, clears it.
        if (verifyEnabled && CAN_VERIFY(selectedType)) {
            config.verification = {
                required: true,
                channel: 'WHATSAPP',
                ...(verifyTemplate.trim() ? { templateName: verifyTemplate.trim() } : {}),
                ...(verifyLanguage.trim() ? { languageCode: verifyLanguage.trim() } : {}),
            };
        } else {
            delete config.verification;
        }

        // Callers without "Depends on" never own this key, so their config passes through.
        if (parentCandidates) {
            if (parentField) config.parentFieldKey = parentField.key;
            else delete config.parentFieldKey;
        }

        // Only surface isRequired when it deviates from the default-true that
        // every caller already applies, so config stays undefined otherwise.
        if (!isRequired) config.isRequired = false;
        else delete config.isRequired;

        return Object.keys(config).length > 0 ? config : undefined;
    };

    const submit = (keepOpen: boolean) => {
        onAddField(
            selectedType === 'text' ? 'textfield' : selectedType,
            fieldName.trim(),
            false,
            hasOptionsType(selectedType)
                ? dropdownOptions.map(({ parent, ...option }) =>
                      parentField && parent ? { ...option, parent } : option
                  )
                : undefined,
            buildConfig()
        );
        // Editing has nothing to clear out for — the dialog closes on the caller's terms.
        if (!isEditMode) resetForm();
        if (!keepOpen) setIsDialogOpen(false);
    };

    const initialName = initialField?.name;
    useEffect(() => {
        const trimmed = fieldName.trim();
        // Leaving an edited field's label alone is always allowed. Forms built before the
        // duplicate check existed do contain repeated labels, and blocking those would make
        // the field's options and type uneditable until the admin renamed it first.
        const unchanged =
            isEditMode && trimmed.toLowerCase() === (initialName ?? '').trim().toLowerCase();
        setIsNameValid(
            trimmed.length > 0 &&
                (unchanged ||
                    !existingFieldNames.some((name) => name.toLowerCase() === trimmed.toLowerCase()))
        );
    }, [fieldName, existingFieldNames, isEditMode, initialName]);

    // Prefill on open in edit mode, wipe on close in add mode. initialField is a fresh
    // object on every parent render, so it must stay out of the deps — callers key the
    // dialog by field id, which remounts it when a different field is opened.
    useEffect(() => {
        if (isDialogOpen && isEditMode && initialField) prefillFrom(initialField);
        else if (!isDialogOpen) resetForm();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDialogOpen, isEditMode]);

    const optionValues = dropdownOptions.map((o) => o.value);

    const setOptionParent = (index: number, parent: string) =>
        setDropdownOptions((prev) =>
            prev.map((option, i) => {
                if (i !== index) return option;
                const { parent: _previous, ...rest } = option;
                void _previous;
                return parent === ANY_PARENT_VALUE ? rest : { ...rest, parent };
            })
        );

    /** "Show when <parent> is …" under each option of a dependent dropdown. */
    const renderParentValuePicker = (index: number) => {
        if (!parentField) return null;
        const current = dropdownOptions[index]?.parent;
        // A value the parent no longer offers stays listed, so it can be seen and changed.
        const choices = Array.from(
            new Set(current ? [...parentField.options, current] : parentField.options)
        );
        return (
            <div className="flex items-center gap-2">
                <span className="shrink-0 text-caption text-neutral-500">
                    {t('showWhen', { parent: parentField.label })}
                </span>
                <Select
                    value={current ?? ANY_PARENT_VALUE}
                    onValueChange={(next) => setOptionParent(index, next)}
                >
                    <SelectTrigger className="h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY_PARENT_VALUE}>{t('any')}</SelectItem>
                        {choices.map((choice) => (
                            <SelectItem key={choice} value={choice}>
                                {choice}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        );
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            {/* DialogContent hard-codes a fixed 400px width, so the width itself must be
                overridden — a max-width alone leaves the two-column body squeezed. */}
            <DialogContent className="flex max-h-[85vh] w-[90vw] max-w-4xl flex-col gap-0 p-0">{/* design-lint-ignore: vw/vh dialog sizing matches MyDialog primitive */}
                <div className="flex shrink-0 items-start gap-3 border-b border-neutral-200 p-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        {isEditMode ? <PencilSimple size={22} /> : <PlusSquare size={22} />}
                    </span>
                    <div className="flex flex-col">
                        <h1 className="text-title font-semibold">
                            {isEditMode ? 'Edit Custom Field' : 'Add Custom Field'}
                        </h1>
                        <p className="text-caption text-neutral-500">
                            {isEditMode
                                ? 'Change how this field appears in the registration form.'
                                : 'Create a new field and customize how it appears in the registration form.'}
                        </p>
                    </div>
                </div>

                {notice && <div className="shrink-0 px-6 pt-4">{notice}</div>}

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
                    {/* ---------------- Left: the form ---------------- */}
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-1">
                            <Label className="text-body font-semibold">1. Field Type</Label>
                            {/* Searchable: the type list is long enough to scroll. */}
                            {/* modal: without it the dialog's scroll-lock swallows wheel
                                events over this portalled list, so it cannot scroll. */}
                            <Popover
                                modal
                                open={typePickerOpen}
                                onOpenChange={setTypePickerOpen}
                            >
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        role="combobox"
                                        aria-expanded={typePickerOpen}
                                        className="flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-transparent px-3 text-body"
                                    >
                                        {availableTypes.find((t) => t.value === selectedType)
                                            ?.label ?? 'Select field type'}
                                        <CaretDown size={14} className="opacity-60" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">{/* design-lint-ignore: radix css var, not a spacing token */}
                                    <Command>
                                        <CommandInput
                                            placeholder="Search field type…"
                                            className="h-9"
                                        />
                                        <CommandList className="max-h-64 overscroll-contain">
                                            <CommandEmpty>No field type found.</CommandEmpty>
                                            <CommandGroup>
                                                {availableTypes.map((ft) => (
                                                    <CommandItem
                                                        key={ft.value}
                                                        value={ft.label}
                                                        onSelect={() => {
                                                            const val =
                                                                ft.value as CustomFieldType;
                                                            setSelectedType(val);
                                                            // Options survive a move between
                                                            // choice types (dropdown → radio →
                                                            // multi-select); editing a saved
                                                            // field must not silently discard
                                                            // the list the admin already has.
                                                            setDropdownOptions((prev) =>
                                                                hasOptionsType(val)
                                                                    ? prev.length > 0
                                                                        ? prev
                                                                        : [
                                                                              {
                                                                                  id: '0',
                                                                                  value: 'Option 1',
                                                                              },
                                                                          ]
                                                                    : []
                                                            );
                                                            setDefaultValue('');
                                                            setAllowedFileTypes([]);
                                                            setTypePickerOpen(false);
                                                        }}
                                                    >
                                                        <span className="flex-1">{ft.label}</span>
                                                        {selectedType === ft.value && (
                                                            <Check size={16} />
                                                        )}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                            <p className="text-caption text-neutral-500">
                                Choose the type of input you want to collect.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1">
                            <Label className="text-body font-semibold">
                                2. Field Label
                                <span className="text-danger-600"> *</span>
                            </Label>
                            <MyInput
                                inputType="text"
                                inputPlaceholder="Enter field label"
                                input={fieldName}
                                onChangeFunction={(e) => setFieldName(e.target.value)}
                                size="large"
                                className="w-full"
                            />
                            {fieldName.trim().length > 0 && !isNameValid ? (
                                <p className="text-caption text-danger-600">
                                    This field name is already taken
                                </p>
                            ) : (
                                <p className="text-caption text-neutral-500">
                                    This label will be shown on the form.
                                </p>
                            )}
                        </div>

                        {parentCandidates && selectedType === 'dropdown' && (
                            <div className="flex flex-col gap-1">
                                <Label className="text-body font-semibold">
                                    {t('dependsOn.label')}
                                </Label>
                                <Select
                                    value={parentField ? parentField.key : NO_PARENT}
                                    disabled={parentCandidates.length === 0}
                                    onValueChange={(next) => {
                                        if (next === (parentField?.key ?? NO_PARENT)) return;
                                        setParentKey(next === NO_PARENT ? '' : next);
                                        // Values of the previous parent mean nothing for a new one.
                                        setDropdownOptions((prev) =>
                                            prev.map(({ parent, ...option }) => {
                                                void parent;
                                                return option;
                                            })
                                        );
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NO_PARENT}>
                                            {t('dependsOn.none')}
                                        </SelectItem>
                                        {parentCandidates.map((candidate) => (
                                            <SelectItem key={candidate.key} value={candidate.key}>
                                                {candidate.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-caption text-neutral-500">
                                    {parentCandidates.length === 0
                                        ? t('dependsOn.noCandidates')
                                        : parentField
                                          ? t('dependsOn.activeHint', {
                                                parent: parentField.label,
                                            })
                                          : t('dependsOn.hint')}
                                </p>
                            </div>
                        )}

                        {hasOptionsType(selectedType) && (
                            <InlineFieldEditor
                                name=""
                                onNameChange={() => {}}
                                hideName
                                bare
                                options={optionValues}
                                onOptionsChange={(next, removedIndex) =>
                                    // Parents are index-aligned, so a deleted row takes
                                    // its own parent with it rather than shifting the rest.
                                    setDropdownOptions((prev) => {
                                        const kept =
                                            removedIndex === undefined
                                                ? prev
                                                : prev.filter((_, i) => i !== removedIndex);
                                        return next.map((value, idx) => {
                                            const parent = kept[idx]?.parent;
                                            return {
                                                id: String(idx),
                                                value,
                                                ...(parent ? { parent } : {}),
                                            };
                                        });
                                    })
                                }
                                renderOptionAddon={
                                    parentField ? renderParentValuePicker : undefined
                                }
                            />
                        )}

                        {selectedType !== 'checkbox' && selectedType !== 'file' && (
                            <div className="flex flex-col gap-1">
                                <Label className="text-body font-semibold">
                                    3. Default Value (Optional)
                                </Label>
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder="Enter default value"
                                    input={defaultValue}
                                    onChangeFunction={(e) => setDefaultValue(e.target.value)}
                                    size="large"
                                    className="w-full"
                                />
                                <p className="text-caption text-neutral-500">
                                    Pre-fill this value when the form loads.
                                </p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="flex items-start justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                                <div className="flex flex-col">
                                    <span className="text-body font-semibold">
                                        Required Field
                                        <span className="text-danger-600"> *</span>
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        Make this field mandatory
                                    </span>
                                </div>
                                <Switch checked={isRequired} onCheckedChange={setIsRequired} />
                            </div>
                            <div className="flex items-start justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                                <div className="flex flex-col">
                                    <span className="text-body font-semibold">
                                        Help Text{' '}
                                        <span className="font-regular text-neutral-500">
                                            (Optional)
                                        </span>
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        Show additional info below the field
                                    </span>
                                </div>
                                <Switch
                                    checked={helpTextEnabled}
                                    onCheckedChange={setHelpTextEnabled}
                                />
                            </div>
                        </div>

                        {helpTextEnabled && (
                            <MyInput
                                inputType="text"
                                inputPlaceholder="Enter help text"
                                input={helpText}
                                onChangeFunction={(e) => setHelpText(e.target.value)}
                                size="large"
                                className="w-full"
                            />
                        )}

                        {/* Only on field types a code can be delivered to. */}
                        {CAN_VERIFY(selectedType) && (
                            <>
                                <div className="rounded-lg border border-neutral-200 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex flex-col">
                                            <span className="text-subtitle">
                                                Verify with a WhatsApp code{' '}
                                                <span className="font-regular text-neutral-500">
                                                    (Optional)
                                                </span>
                                            </span>
                                            <span className="text-caption text-neutral-500">
                                                They get a one-time code and must enter it before
                                                the form can be submitted
                                            </span>
                                        </div>
                                        <Switch
                                            checked={verifyEnabled}
                                            onCheckedChange={setVerifyEnabled}
                                        />
                                    </div>
                                </div>

                                {verifyEnabled && (
                                    <>
                                        {/* The gate blocks submission, so a template that cannot
                                            send leaves a form nobody can complete. The resolver
                                            does NOT fall back to a platform default — it fails. */}
                                        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                                            This institute needs an approved WhatsApp OTP template.
                                            Without one the code cannot be sent, and because
                                            verification is required to submit, nobody will be able
                                            to complete the form.
                                        </div>
                                        <MyInput
                                            inputType="text"
                                            label="Template name"
                                            inputPlaceholder="Leave blank to use this institute's OTP template"
                                            input={verifyTemplate}
                                            onChangeFunction={(e) => setVerifyTemplate(e.target.value)}
                                            size="large"
                                            className="w-full"
                                        />
                                        <MyInput
                                            inputType="text"
                                            label="Template language"
                                            inputPlaceholder="en"
                                            input={verifyLanguage}
                                            onChangeFunction={(e) => setVerifyLanguage(e.target.value)}
                                            size="large"
                                            className="w-full"
                                        />
                                    </>
                                )}
                            </>
                        )}

                        {hasAdvancedOptions(selectedType) && (
                            <div className="rounded-lg border border-neutral-200">
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between p-3"
                                    onClick={() => setShowAdvanced((v) => !v)}
                                >
                                    <span className="flex items-center gap-2 text-body">
                                        <Gear size={18} /> Advanced Options
                                    </span>
                                    {showAdvanced ? (
                                        <CaretUp size={16} />
                                    ) : (
                                        <CaretDown size={16} />
                                    )}
                                </button>
                                {showAdvanced && (
                                    <div className="flex flex-col gap-3 border-t border-neutral-200 p-3">
                                        {selectedType === 'checkbox' && (
                                            <>
                                                <div className="flex flex-col gap-1">
                                                    <Label className="text-caption text-neutral-500">
                                                        Heading (Optional)
                                                    </Label>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder="e.g. Terms & Conditions"
                                                        input={checkboxHeading}
                                                        onChangeFunction={(e) =>
                                                            setCheckboxHeading(e.target.value)
                                                        }
                                                        size="large"
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <Label className="text-caption text-neutral-500">
                                                        Description / Consent Text (Optional)
                                                    </Label>
                                                    <textarea
                                                        placeholder="e.g. Terms & Conditions text shown above the checkbox. Line breaks are preserved."
                                                        value={checkboxDescription}
                                                        onChange={(e) =>
                                                            setCheckboxDescription(e.target.value)
                                                        }
                                                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body"
                                                        rows={5}
                                                    />
                                                    <p className="text-caption text-neutral-500">
                                                        Shown as a scrollable block above the
                                                        checkbox.
                                                    </p>
                                                </div>
                                                <label className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={checkboxDefault}
                                                        onCheckedChange={(c) =>
                                                            setCheckboxDefault(c === true)
                                                        }
                                                    />
                                                    <span className="text-body">
                                                        Checked by default
                                                    </span>
                                                </label>
                                            </>
                                        )}
                                        {selectedType === 'file' && (
                                            <>
                                                <Label className="text-caption text-neutral-500">
                                                    Allowed File Types
                                                </Label>
                                                <div className="flex flex-wrap gap-2">
                                                    {COMMON_FILE_TYPES.map((ft) => {
                                                        const isAll = ft.value === ALL_FILES_VALUE;
                                                        const disabledByAll =
                                                            !isAll &&
                                                            allowedFileTypes.includes(
                                                                ALL_FILES_VALUE
                                                            );
                                                        return (
                                                            <label
                                                                key={ft.value}
                                                                className="flex cursor-pointer items-center gap-1"
                                                            >
                                                                <Checkbox
                                                                    checked={allowedFileTypes.includes(
                                                                        ft.value
                                                                    )}
                                                                    disabled={disabledByAll}
                                                                    onCheckedChange={() =>
                                                                        setAllowedFileTypes(
                                                                            (prev) => {
                                                                                if (isAll)
                                                                                    return prev.includes(
                                                                                        ALL_FILES_VALUE
                                                                                    )
                                                                                        ? []
                                                                                        : [
                                                                                              ALL_FILES_VALUE,
                                                                                          ];
                                                                                const without =
                                                                                    prev.filter(
                                                                                        (t) =>
                                                                                            t !==
                                                                                            ALL_FILES_VALUE
                                                                                    );
                                                                                return without.includes(
                                                                                    ft.value
                                                                                )
                                                                                    ? without.filter(
                                                                                          (t) =>
                                                                                              t !==
                                                                                              ft.value
                                                                                      )
                                                                                    : [
                                                                                          ...without,
                                                                                          ft.value,
                                                                                      ];
                                                                            }
                                                                        )
                                                                    }
                                                                />
                                                                <span className="text-caption">
                                                                    {ft.label}
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <Label className="text-caption text-neutral-500">
                                                        Max File Size (MB)
                                                    </Label>
                                                    <MyInput
                                                        inputType="number"
                                                        inputPlaceholder="5"
                                                        input={String(maxSizeMB)}
                                                        onChangeFunction={(e) =>
                                                            setMaxSizeMB(
                                                                Number(e.target.value) || 5
                                                            )
                                                        }
                                                        size="large"
                                                        className="w-32"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ---------------- Right: preview + tips ---------------- */}
                    <div className="flex flex-col gap-4 md:border-l md:border-neutral-200 md:pl-6">
                        <div className="flex flex-col gap-1">
                            <span className="flex items-center gap-2 text-body font-semibold">
                                <Eye size={18} /> Live Preview
                            </span>
                            <p className="text-caption text-neutral-500">
                                This is how the field will appear on the registration form.
                            </p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 p-4">
                            <div className="flex flex-col gap-1">
                                <Label className="text-body font-semibold">
                                    {fieldName.trim() || 'Field Label'}
                                    {isRequired && <span className="text-danger-600"> *</span>}
                                </Label>
                                <div className="pointer-events-none">
                                    <CustomFieldRenderer
                                        type={selectedType}
                                        name={fieldName.trim() || 'Field Label'}
                                        value=""
                                        disabled
                                        options={optionValues}
                                        config={{
                                            heading: checkboxHeading.trim() || undefined,
                                            description:
                                                checkboxDescription.trim() || undefined,
                                        }}
                                    />
                                </div>
                                {hasOptionsType(selectedType) && optionValues.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {optionValues.map((opt, i) => (
                                            <span
                                                key={i}
                                                className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600"
                                            >
                                                {opt || `Option ${i + 1}`}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p className="text-caption text-neutral-500">
                                    {helpTextEnabled && helpText.trim()
                                        ? helpText.trim()
                                        : 'Help text will appear here (if enabled)'}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-4">
                            <span className="flex items-center gap-2 text-body font-semibold text-warning-600">
                                <Lightbulb size={18} /> Tips
                            </span>
                            <ul className="ml-4 list-disc text-caption text-neutral-600">
                                <li>You can change the field type anytime.</li>
                                <li>Drag the field to reorder it in the form.</li>
                                <li>Click the pencil on a field to edit its settings.</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-neutral-200 p-4">
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        className="mr-auto"
                        onClick={() => setIsDialogOpen(false)}
                    >
                        <X size={16} /> Cancel
                    </MyButton>
                    {!isEditMode && (
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            disable={!isNameValid}
                            onClick={() => submit(true)}
                        >
                            <Plus size={16} /> Save &amp; Add Another
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        disable={!isNameValid}
                        onClick={() => submit(false)}
                    >
                        <CheckCircle size={16} /> {isEditMode ? 'Save Changes' : 'Add Field'}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
