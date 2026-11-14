import { useRef, useState, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import { UploadSimple, DownloadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { NewUserRow, CustomFieldValue } from '../../../-types/bulk-assign-types';
import {
    getCustomFieldSettingsFromCache,
    getCustomFieldSettings,
    CustomFieldSettingsData,
} from '@/services/custom-field-settings';
import { useUserIdentifierSetting } from '@/services/user-identifier-setting';
import { getSystemFieldColumnVisibility } from '@/components/design-system/utils/constants/system-field-columns';
import { parse, isValid } from 'date-fns';

// ─── System field definitions ───────────────────────────────────
// These map 1-to-1 with the backend NewUserDTO snake_case field names.
// Order follows the manual enrollment form's systemFieldKeyMapping.

interface CsvColumnDef {
    /** CSV header / NewUserRow key */
    csvKey: string;
    /** Label shown in template */
    label: string;
    /** Is the column mandatory? */
    required: boolean;
    /** Sample value for the template row */
    sample: string;
    /** System field key from cache (UPPER) — used to filter by visibility */
    systemKey?: string;
}

// Always-present core columns (not controlled by visibility).
// address_line and pin_code are included here (not in OPTIONAL) because
// ADDRESS_LINE and PIN_CODE don't exist in DEFAULT_SYSTEM_FIELDS, so
// the visibility gate would permanently hide them from the CSV template.
const buildCoreColumns = (t: TFunction, phoneRequired: boolean): CsvColumnDef[] => [
    {
        csvKey: 'email',
        label: t('columns.email'),
        required: !phoneRequired,
        sample: 'student@example.com',
    },
    {
        csvKey: 'full_name',
        label: t('columns.fullName'),
        required: true,
        sample: 'John Doe',
    },
    {
        csvKey: 'mobile_number',
        label: t('columns.mobileNumber'),
        required: phoneRequired,
        sample: '+91 9876543210',
        systemKey: 'MOBILE_NUMBER',
    },
    { csvKey: 'username', label: t('columns.username'), required: false, sample: '' },
    { csvKey: 'password', label: t('columns.password'), required: false, sample: '' },
    { csvKey: 'address_line', label: t('columns.address'), required: false, sample: '' },
    { csvKey: 'pin_code', label: t('columns.pinCode'), required: false, sample: '' },
    {
        csvKey: 'payment_date',
        label: t('columns.paymentDate'),
        required: false,
        sample: '15/01/2025',
    },
    {
        csvKey: 'transaction_id',
        label: t('columns.transactionId'),
        required: false,
        sample: '',
    },
];

// Optional system columns — included ONLY if visible in the institute's custom field settings
const buildOptionalSystemColumns = (t: TFunction): CsvColumnDef[] => [
    { csvKey: 'gender', label: t('columns.gender'), required: false, sample: 'MALE', systemKey: 'GENDER' },
    {
        csvKey: 'date_of_birth',
        label: t('columns.dateOfBirth'),
        required: false,
        sample: '2000-01-15',
        systemKey: 'DATE_OF_BIRTH',
    },
    { csvKey: 'city', label: t('columns.city'), required: false, sample: '', systemKey: 'CITY' },
    { csvKey: 'region', label: t('columns.region'), required: false, sample: '', systemKey: 'REGION' },
    {
        csvKey: 'linked_institute_name',
        label: t('columns.linkedInstituteName'),
        required: false,
        sample: '',
        systemKey: 'LINKED_INSTITUTE_NAME',
    },
    {
        csvKey: 'fathers_name',
        label: t('columns.fathersName'),
        required: false,
        sample: '',
        systemKey: 'FATHER_NAME',
    },
    {
        csvKey: 'mothers_name',
        label: t('columns.mothersName'),
        required: false,
        sample: '',
        systemKey: 'MOTHER_NAME',
    },
    {
        csvKey: 'parents_mobile_number',
        label: t('columns.fathersMobile'),
        required: false,
        sample: '',
        systemKey: 'PARENTS_MOBILE_NUMBER',
    },
    {
        csvKey: 'parents_email',
        label: t('columns.fathersEmail'),
        required: false,
        sample: '',
        systemKey: 'PARENTS_EMAIL',
    },
    {
        csvKey: 'parents_to_mother_mobile_number',
        label: t('columns.mothersMobile'),
        required: false,
        sample: '',
        systemKey: 'PARENTS_TO_MOTHER_MOBILE_NUMBER',
    },
    {
        csvKey: 'parents_to_mother_email',
        label: t('columns.mothersEmail'),
        required: false,
        sample: '',
        systemKey: 'PARENTS_TO_MOTHER_EMAIL',
    },
];

export interface CsvPaymentInfo {
    paymentDate?: string;
    transactionId?: string;
}

interface Props {
    onImport: (rows: NewUserRow[]) => void;
    onPaymentInfoDetected?: (info: CsvPaymentInfo) => void;
}

export const CsvUserImporter = ({ onImport, onPaymentInfoDetected }: Props) => {
    const { t } = useTranslation('manageStudentsCsvUserImporter');
    const fileRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<NewUserRow[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [settings, setSettings] = useState<CustomFieldSettingsData | null>(
        () => getCustomFieldSettingsFromCache()
    );
    const { data: userIdentifier } = useUserIdentifierSetting();
    const phoneRequired = userIdentifier === 'PHONE';

    // If cache is empty (e.g. after settings save invalidates it), fetch
    // from API so the template still includes custom fields.
    useEffect(() => {
        if (!settings) {
            getCustomFieldSettings()
                .then(setSettings)
                .catch((err) => console.error('Failed to load custom field settings:', err));
        }
    }, [settings]);

    // ─── Build dynamic column list from institute settings ────
    const { allColumns, customFieldColumns } = useMemo(() => {

        // System-field visibility keyed by column accessor (tolerant of non-standard
        // keys). A column stays if not explicitly turned off; required columns
        // (email/full_name/mobile) always stay regardless so the import still works.
        const systemVisibility = getSystemFieldColumnVisibility();
        const isColVisible = (csvKey: string) => systemVisibility[csvKey] !== false;

        // Core columns: keep required ones always; gate the optional ones (e.g. address, pin code)
        const cols: CsvColumnDef[] = buildCoreColumns(t, phoneRequired).filter(
            (col) => col.required || isColVisible(col.csvKey)
        );

        // Add optional system columns that aren't toggled off
        for (const col of buildOptionalSystemColumns(t)) {
            if (isColVisible(col.csvKey)) {
                cols.push(col);
            }
        }

        // Add institute custom fields so they can be bulk-imported. The import is a
        // data-entry tool, so we include EVERY active custom field (from any bucket:
        // standalone, institute-level, or grouped) regardless of its learner-list
        // visibility — admins may need to populate a field that isn't shown as a
        // column. The picker is opt-in, so they choose which to include.
        const cfCols: { csvKey: string; customFieldId: string; label: string; required: boolean }[] = [];
        if (settings) {
            const allCustomFields = [
                ...(settings.instituteFields ?? []),
                ...(settings.customFields ?? []),
                ...(settings.fieldGroups ?? []).flatMap((g) => g.fields),
            ];
            const seenCustomIds = new Set<string>();
            for (const cf of allCustomFields) {
                if (!cf?.id || !cf?.name || seenCustomIds.has(cf.id)) continue;
                seenCustomIds.add(cf.id);
                const safeKey = `cf_${cf.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
                cfCols.push({
                    csvKey: safeKey,
                    customFieldId: cf.id,
                    label: cf.name,
                    required: !!cf.required,
                });
                cols.push({
                    csvKey: safeKey,
                    label: cf.name,
                    required: !!cf.required,
                    sample: '',
                });
            }
        }

        return { allColumns: cols, customFieldColumns: cfCols };
    }, [settings, phoneRequired, t]);

    const REQUIRED_HEADERS = allColumns.filter((c) => c.required).map((c) => c.csvKey);

    // ─── Template column picker (inline; rendered within the wizard step) ────
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [templateCols, setTemplateCols] = useState<Record<string, boolean>>({});

    const isRequiredCol = (csvKey: string) => REQUIRED_HEADERS.includes(csvKey);

    // Open the picker with every available column pre-selected.
    const openTemplatePicker = () => {
        setTemplateCols(
            allColumns.reduce<Record<string, boolean>>((acc, c) => {
                acc[c.csvKey] = true;
                return acc;
            }, {})
        );
        setShowTemplatePicker(true);
    };

    const toggleTemplateCol = (csvKey: string) => {
        if (isRequiredCol(csvKey)) return; // required columns can't be removed
        setTemplateCols((prev) => ({ ...prev, [csvKey]: !prev[csvKey] }));
    };

    const optionalKeys = allColumns
        .filter((c) => !isRequiredCol(c.csvKey))
        .map((c) => c.csvKey);
    const allOptionalSelected = optionalKeys.every((k) => templateCols[k]);
    const toggleAllTemplateCols = () => {
        const next = !allOptionalSelected;
        setTemplateCols((prev) => {
            const copy = { ...prev };
            optionalKeys.forEach((k) => {
                copy[k] = next;
            });
            return copy;
        });
    };

    const selectedTemplateCount = allColumns.filter(
        (c) => isRequiredCol(c.csvKey) || templateCols[c.csvKey]
    ).length;

    // ─── Download template (only the chosen columns; required ones always included) ────
    const handleDownloadTemplate = () => {
        const cols = allColumns.filter(
            (c) => isRequiredCol(c.csvKey) || templateCols[c.csvKey]
        );
        const headers = cols.map((c) => c.csvKey);
        const sampleRow = cols.map((c) => c.sample);
        const csv = [headers.join(','), sampleRow.join(',')].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bulk_enroll_template.csv';
        a.click();
        URL.revokeObjectURL(url);
        setShowTemplatePicker(false);
    };

    // ─── Parse CSV ────
    const parseFile = (file: File) => {
        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => {
                const errs: string[] = [];
                const rows: NewUserRow[] = [];

                // Check required headers
                const headers = result.meta.fields || [];
                REQUIRED_HEADERS.forEach((h) => {
                    if (!headers.includes(h))
                        errs.push(t('errors.missingRequiredColumn', { column: h }));
                });

                if (errs.length > 0) {
                    setErrors(errs);
                    setPreview([]);
                    return;
                }

                // Build a map of csvKey → customFieldId for custom field columns
                const cfMap = new Map(customFieldColumns.map((c) => [c.csvKey, c.customFieldId]));

                result.data.forEach((row, i) => {
                    const rowNum = i + 2;
                    if (phoneRequired) {
                        if (!row.mobile_number?.trim()) {
                            errs.push(
                                t('errors.rowFieldRequired', { rowNum, field: 'mobile_number' })
                            );
                            return;
                        }
                    } else {
                        if (!row.email?.trim()) {
                            errs.push(t('errors.rowFieldRequired', { rowNum, field: 'email' }));
                            return;
                        }
                    }
                    if (!row.full_name?.trim()) {
                        errs.push(t('errors.rowFieldRequired', { rowNum, field: 'full_name' }));
                        return;
                    }
                    // Usernames must not contain spaces — skip this row so the
                    // learner is NOT enrolled, and surface a clear error.
                    if (row.username && /\s/.test(row.username.trim())) {
                        errs.push(t('errors.rowUsernameSpaces', { rowNum }));
                        return;
                    }

                    // Build custom field values from CSV columns
                    const customFieldValues: CustomFieldValue[] = [];
                    for (const [csvKey, cfId] of cfMap.entries()) {
                        const val = row[csvKey]?.trim();
                        if (val) {
                            customFieldValues.push({ custom_field_id: cfId, value: val });
                        }
                    }

                    // Parse payment_date to ISO format (yyyy-MM-dd) for the backend
                    let parsedPaymentDate: string | undefined;
                    const rawPaymentDate = row.payment_date?.trim();
                    if (rawPaymentDate) {
                        const DATE_FORMATS = ['d/M/yyyy', 'dd/MM/yyyy', 'M/d/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'd-M-yyyy', 'dd-MM-yyyy'];
                        for (const fmt of DATE_FORMATS) {
                            const pd = parse(rawPaymentDate, fmt, new Date());
                            if (isValid(pd)) {
                                parsedPaymentDate = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-${String(pd.getDate()).padStart(2, '0')}`;
                                break;
                            }
                        }
                        if (!parsedPaymentDate) {
                            errs.push(
                                t('errors.rowInvalidPaymentDate', {
                                    rowNum,
                                    value: rawPaymentDate,
                                })
                            );
                        }
                    }

                    rows.push({
                        email: row.email?.trim() || '',
                        full_name: row.full_name.trim(),
                        mobile_number: row.mobile_number?.trim() || undefined,
                        username: row.username?.trim() || undefined,
                        password: row.password?.trim() || undefined,
                        gender: row.gender?.trim() || undefined,
                        date_of_birth: row.date_of_birth?.trim() || undefined,
                        address_line: row.address_line?.trim() || undefined,
                        city: row.city?.trim() || undefined,
                        region: row.region?.trim() || undefined,
                        pin_code: row.pin_code?.trim() || undefined,
                        fathers_name: row.fathers_name?.trim() || undefined,
                        mothers_name: row.mothers_name?.trim() || undefined,
                        parents_mobile_number: row.parents_mobile_number?.trim() || undefined,
                        parents_email: row.parents_email?.trim() || undefined,
                        parents_to_mother_mobile_number:
                            row.parents_to_mother_mobile_number?.trim() || undefined,
                        parents_to_mother_email: row.parents_to_mother_email?.trim() || undefined,
                        linked_institute_name: row.linked_institute_name?.trim() || undefined,
                        payment_date: parsedPaymentDate,
                        custom_field_values: customFieldValues.length > 0 ? customFieldValues : undefined,
                    });
                });

                // Extract payment info from CSV rows (use first non-empty value)
                if (onPaymentInfoDetected && result.data.length > 0) {
                    let paymentDate: string | undefined;
                    let transactionId: string | undefined;
                    const DATE_FORMATS = ['d/M/yyyy', 'dd/MM/yyyy', 'M/d/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'd-M-yyyy', 'dd-MM-yyyy'];
                    for (const row of result.data) {
                        if (!paymentDate && row.payment_date?.trim()) {
                            const raw = row.payment_date.trim();
                            for (const fmt of DATE_FORMATS) {
                                const parsed = parse(raw, fmt, new Date());
                                if (isValid(parsed)) {
                                    paymentDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
                                    break;
                                }
                            }
                        }
                        if (!transactionId && row.transaction_id?.trim()) {
                            transactionId = row.transaction_id.trim();
                        }
                        if (paymentDate && transactionId) break;
                    }
                    if (paymentDate || transactionId) {
                        onPaymentInfoDetected({ paymentDate, transactionId });
                    }
                }

                setErrors(errs);
                setPreview(rows);
            },
        });
    };

    const handleFile = (file: File | undefined) => {
        if (!file) return;
        if (!file.name.endsWith('.csv')) {
            setErrors([t('errors.notCsvFile')]);
            return;
        }
        parseFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFile(e.dataTransfer.files[0]);
    };

    const handleConfirm = () => {
        if (preview.length === 0) return;
        onImport(preview);
        setPreview([]);
        setErrors([]);
    };

    // Count how many extra columns (beyond email/full_name) are in the template
    const extraColCount = allColumns.length - 2;

    return (
        <div className="flex flex-col gap-4">
            {/* Template download */}
            <div className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3">
                <div>
                    <p className="text-sm font-medium text-neutral-700">
                        {t('template.downloadTitle')}
                    </p>
                    <p className="text-xs text-neutral-400">
                        {t('template.instructions')}{' '}
                        <code className="text-primary-600">
                            {phoneRequired ? 'mobile_number, full_name' : 'email, full_name'}
                        </code>
                        {extraColCount > 0 && (
                            <span>
                                {' '}
                                {t('template.optionalCount', { count: extraColCount })}
                                {customFieldColumns.length > 0 && (
                                    <span className="text-primary-500">
                                        {' '}
                                        {t('template.customFieldsIncluded', {
                                            count: customFieldColumns.length,
                                        })}
                                    </span>
                                )}
                            </span>
                        )}
                    </p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="default"
                    onClick={openTemplatePicker}
                >
                    <DownloadSimple size={14} className="mr-1" />
                    {t('template.templateButton')}
                </MyButton>
            </div>

            {/* Inline template column picker (rendered in-flow to avoid modal-on-modal stacking) */}
            {showTemplatePicker && (
                <div className="animate-fadeIn flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-700">
                                {t('picker.title')}
                            </p>
                            <p className="text-xs text-neutral-400">{t('picker.description')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={toggleAllTemplateCols}
                            className="shrink-0 text-xs font-medium text-primary-500 hover:text-primary-600"
                        >
                            {allOptionalSelected ? t('picker.clearOptional') : t('picker.selectAll')}
                        </button>
                    </div>
                    <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                        {allColumns.map((c) => {
                            const required = isRequiredCol(c.csvKey);
                            const checked = required || !!templateCols[c.csvKey];
                            return (
                                <label
                                    key={c.csvKey}
                                    className={cn(
                                        'flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors',
                                        checked
                                            ? 'border-primary-200 bg-primary-50'
                                            : 'border-neutral-200 hover:bg-neutral-50',
                                        required ? 'cursor-default' : 'cursor-pointer'
                                    )}
                                >
                                    <Checkbox
                                        checked={checked}
                                        disabled={required}
                                        onCheckedChange={() => toggleTemplateCol(c.csvKey)}
                                    />
                                    <span className="truncate text-sm text-neutral-700">
                                        {c.label}
                                    </span>
                                    {required && (
                                        <span className="ml-auto shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-500">
                                            {t('picker.required')}
                                        </span>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
                        <span className="text-xs text-neutral-500">
                            {t('picker.columnsSelected', { count: selectedTemplateCount })}
                        </span>
                        <div className="flex items-center gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                onClick={() => setShowTemplatePicker(false)}
                            >
                                {t('picker.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleDownloadTemplate}
                                className="flex items-center gap-1.5"
                            >
                                <DownloadSimple size={14} />
                                {t('picker.download')}
                            </MyButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Drop zone */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 transition-colors ${isDragging ? 'border-primary-400 bg-primary-50' : 'border-neutral-300 bg-white hover:border-primary-300 hover:bg-primary-50/50'}`}
            >
                <UploadSimple size={28} className="text-neutral-400" />
                <p className="text-sm font-medium text-neutral-600">{t('dropzone.dragDrop')}</p>
                <p className="text-xs text-neutral-400">{t('dropzone.orBrowse')}</p>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                />
            </div>

            {/* Errors */}
            {errors.length > 0 && (
                <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
                    {errors.map((e, i) => (
                        <p key={i} className="text-xs text-danger-600">
                            ❌ {e}
                        </p>
                    ))}
                </div>
            )}

            {/* Preview */}
            {preview.length > 0 && errors.length === 0 && (
                <div className="rounded-lg border border-success-200 bg-success-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-success-700">
                            ✅ {t('preview.rowsDetected', { count: preview.length })}
                        </p>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            layoutVariant="default"
                            onClick={handleConfirm}
                        >
                            {t('preview.addLearners', { count: preview.length })}
                        </MyButton>
                    </div>
                    <div className="max-h-36 overflow-y-auto">
                        {preview.slice(0, 5).map((r, i) => (
                            <p key={i} className="text-xs text-success-600">
                                {r.full_name} — {r.email || r.mobile_number}
                                {r.custom_field_values && r.custom_field_values.length > 0 && (
                                    <span className="text-success-400">
                                        {' '}
                                        {t('preview.customFieldsCount', {
                                            count: r.custom_field_values.length,
                                        })}
                                    </span>
                                )}
                            </p>
                        ))}
                        {preview.length > 5 && (
                            <p className="text-xs text-success-400">
                                {t('preview.andMore', { count: preview.length - 5 })}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
