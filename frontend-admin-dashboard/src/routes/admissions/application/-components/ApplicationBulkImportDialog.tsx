import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    submitApplicationBulkWithLead,
    type BulkSubmitApplicationRequest,
    type BulkSubmitApplicationRow,
    type BulkSubmitApplicationResponse,
} from '../../-services/submit-application-bulk';
import { normalizeGender, parseOptionalEnquiryStatus, parseOptionalSourceType } from '../../enquiries/-components/enquiry-bulk-import-utils';

type Step = 1 | 2 | 4;

type EnquirySourceType =
    | 'WEBSITE'
    | 'GOOGLE_ADS'
    | 'FACEBOOK'
    | 'INSTAGRAM'
    | 'REFERRAL'
    | 'OTHER';

type ParsedCsvRow = {
    student_name: string;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    date_of_birth: string;
    father_name?: string;
    father_email?: string;
    father_mobile?: string;
    mother_name?: string;
    mother_email?: string;
    mother_mobile?: string;
    status: string;
    source_type?: EnquirySourceType;
};

interface ApplicationBulkImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

const buildRequiredColumnLabels = (t: TFunction): string[] => [
    t('columns.studentName'),
    t('columns.gender'),
    t('columns.dateOfBirth'),
];

const HEADER_ALIASES: Record<string, keyof ParsedCsvRow | null> = {
    studentname: 'student_name',
    student_name: 'student_name',
    full_name: 'student_name',
    childname: 'student_name',
    child_name: 'student_name',
    gender: 'gender',
    dateofbirth: 'date_of_birth',
    date_of_birth: 'date_of_birth',
    dob: 'date_of_birth',
    birthday: 'date_of_birth',
    fathername: 'father_name',
    father_name: 'father_name',
    fatheremail: 'father_email',
    father_email: 'father_email',
    fathersmobile: 'father_mobile',
    fathermobile: 'father_mobile',
    father_mobile: 'father_mobile',
    mothername: 'mother_name',
    mother_name: 'mother_name',
    motheremail: 'mother_email',
    mother_email: 'mother_email',
    mothersmobile: 'mother_mobile',
    mothermobile: 'mother_mobile',
    mother_mobile: 'mother_mobile',
    status: 'status',
    enquirystatus: 'status',
    enquiry_status: 'status',
    source: 'source_type',
    sourcetype: 'source_type',
    source_type: 'source_type',
};

const REQUIRED_CANONICAL_FIELDS: Array<keyof ParsedCsvRow> = ['student_name', 'gender', 'date_of_birth'];

const toAliasKey = (raw: string): string => raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

const normalizeDobToISO = (value: unknown): string | null => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
    const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
    let year = 0;
    let month = 0;
    let day = 0;

    const ymdMatch = raw.match(ymd);
    if (ymdMatch) {
        year = Number(ymdMatch[1]);
        month = Number(ymdMatch[2]);
        day = Number(ymdMatch[3]);
    } else {
        const dmyMatch = raw.match(dmy);
        if (!dmyMatch) return null;
        day = Number(dmyMatch[1]);
        month = Number(dmyMatch[2]);
        year = Number(dmyMatch[3]);
    }

    const dt = new Date(year, month - 1, day);
    if (
        Number.isNaN(dt.getTime()) ||
        dt.getFullYear() !== year ||
        dt.getMonth() + 1 !== month ||
        dt.getDate() !== day
    ) {
        return null;
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidMobile = (value: string): boolean => /^\+?[0-9]{7,15}$/.test(value.replace(/\s+/g, ''));

export const ApplicationBulkImportDialog = ({
    open,
    onOpenChange,
    onSuccess,
}: ApplicationBulkImportDialogProps) => {
    const { t } = useTranslation('admissionsApplicationBulkImportDialog');
    const { t: tSubmitApplicationBulk } = useTranslation('admissionsSubmitApplicationBulk');
    const [step, setStep] = useState<Step>(1);
    const [parseError, setParseError] = useState<string | null>(null);
    const [validRows, setValidRows] = useState<ParsedCsvRow[]>([]);
    const [skippedRowsCount, setSkippedRowsCount] = useState(0);
    const [selectedPackageSessionId, setSelectedPackageSessionId] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { instituteDetails } = useInstituteDetailsStore();

    useQuery({ ...useInstituteQuery(), enabled: open });

    const classOptions = useMemo<{ id: string; label: string }[]>(
        () =>
            (instituteDetails?.batches_for_sessions ?? []).map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} - ${batch.level.level_name} - ${batch.session.session_name}`,
            })),
        [instituteDetails?.batches_for_sessions]
    );

    const resetState = () => {
        setStep(1);
        setParseError(null);
        setValidRows([]);
        setSkippedRowsCount(0);
        setSelectedPackageSessionId('');
    };

    const closeDialog = (nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetState();
    };

    const handleDownloadTemplate = () => {
        const headers = [
            t('columns.studentName'),
            t('columns.gender'),
            t('columns.dateOfBirth'),
            t('columns.fatherName'),
            t('columns.fatherEmail'),
            t('columns.fatherMobile'),
            t('columns.motherName'),
            t('columns.motherEmail'),
            t('columns.motherMobile'),
            t('columns.status'),
            t('columns.source'),
        ];
        const sample = [
            t('sample.studentName'),
            // Gender/status/source are matched against fixed English enum tokens on
            // re-upload (see normalizeGender / parseOptionalEnquiryStatus /
            // parseOptionalSourceType) — keep these, the date format, and the
            // email/phone examples as plain format examples, not language-bound copy.
            'MALE',
            '2015-06-01',
            t('sample.fatherName'),
            'father@example.com',
            '+919876543210',
            t('sample.motherName'),
            'mother@example.com',
            '+919876543211',
            'NEW',
            'WEBSITE',
        ];
        const csv = [headers.join(','), sample.join(',')].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'application_bulk_import_template.csv';
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const parseFile = (file: File) => {
        if (!file.name.toLowerCase().endsWith('.csv')) {
            setParseError(t('errors.onlyCsvSupported'));
            setValidRows([]);
            setSkippedRowsCount(0);
            return;
        }

        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            transform: (v) => (typeof v === 'string' ? v.trim() : v),
            complete: (result) => {
                const incomingHeaders = result.meta.fields || [];
                const mappedColumns = new Map<string, keyof ParsedCsvRow>();

                for (const header of incomingHeaders) {
                    const mapped = HEADER_ALIASES[toAliasKey(header)] || null;
                    if (mapped) mappedColumns.set(header, mapped);
                }

                const missingRequired = REQUIRED_CANONICAL_FIELDS.filter(
                    (field) => !Array.from(mappedColumns.values()).includes(field)
                );

                if (missingRequired.length > 0) {
                    const requiredColumnLabels = buildRequiredColumnLabels(t);
                    const missing = missingRequired
                        .map((field) => requiredColumnLabels[REQUIRED_CANONICAL_FIELDS.indexOf(field)])
                        .join(', ');
                    setParseError(t('errors.missingRequiredColumns', { columns: missing }));
                    setValidRows([]);
                    setSkippedRowsCount(0);
                    return;
                }

                const parsedRows: ParsedCsvRow[] = [];
                let skipped = 0;

                for (const rawRow of result.data) {
                    const canonicalRow: Partial<Record<keyof ParsedCsvRow, string>> = {};
                    for (const [sourceHeader, canonicalHeader] of mappedColumns.entries()) {
                        canonicalRow[canonicalHeader] = rawRow[sourceHeader];
                    }

                    const studentName = canonicalRow.student_name?.trim() || '';
                    const fatherName = canonicalRow.father_name?.trim() || '';
                    const fatherEmail = canonicalRow.father_email?.trim() || '';
                    const fatherMobile = canonicalRow.father_mobile?.trim() || '';
                    const motherName = canonicalRow.mother_name?.trim() || '';
                    const motherEmail = canonicalRow.mother_email?.trim() || '';
                    const motherMobile = canonicalRow.mother_mobile?.trim() || '';

                    const gender = normalizeGender(canonicalRow.gender);
                    const dobIso = normalizeDobToISO(canonicalRow.date_of_birth);

                    const hasFather = !!(fatherName || fatherEmail || fatherMobile);
                    const hasMother = !!(motherName || motherEmail || motherMobile);
                    const hasAtLeastOneParent = hasFather || hasMother;

                    const fatherValid =
                        !hasFather ||
                        (!!fatherName &&
                            !!fatherEmail &&
                            !!fatherMobile &&
                            isValidEmail(fatherEmail) &&
                            isValidMobile(fatherMobile));
                    const motherValid =
                        !hasMother ||
                        (!!motherName &&
                            !!motherEmail &&
                            !!motherMobile &&
                            isValidEmail(motherEmail) &&
                            isValidMobile(motherMobile));

                    if (
                        !studentName ||
                        !gender ||
                        !dobIso ||
                        !hasAtLeastOneParent ||
                        !fatherValid ||
                        !motherValid
                    ) {
                        skipped += 1;
                        continue;
                    }

                    parsedRows.push({
                        student_name: studentName,
                        ...(fatherName ? { father_name: fatherName } : {}),
                        ...(fatherEmail ? { father_email: fatherEmail } : {}),
                        ...(fatherMobile ? { father_mobile: fatherMobile } : {}),
                        ...(motherName ? { mother_name: motherName } : {}),
                        ...(motherEmail ? { mother_email: motherEmail } : {}),
                        ...(motherMobile ? { mother_mobile: motherMobile } : {}),
                        gender,
                        date_of_birth: dobIso,
                        status: parseOptionalEnquiryStatus(canonicalRow.status),
                        source_type: parseOptionalSourceType(canonicalRow.source_type),
                    });
                }

                setParseError(null);
                setValidRows(parsedRows);
                setSkippedRowsCount(skipped);
            },
            error: (error) => {
                setParseError(error.message || t('errors.failedToParseCsv'));
                setValidRows([]);
                setSkippedRowsCount(0);
            },
        });
    };

    const submitMutation = useMutation({
        mutationFn: (payload: BulkSubmitApplicationRequest) =>
            submitApplicationBulkWithLead(payload, tSubmitApplicationBulk),
        onSuccess: (response: BulkSubmitApplicationResponse) => {
            const successCount = Number(response?.summary?.successful || 0);
            const failedCount = Number(response?.summary?.failed || 0);
            toast.success(t('toasts.importResult', { count: successCount, failedCount }));
            onSuccess?.();
            closeDialog(false);
        },
        onError: (error: Error) => {
            toast.error(error.message || t('toasts.importFailedFallback'));
        },
    });

    const handleConfirmSubmit = () => {
        if (validRows.length === 0) return;

        if (!instituteDetails?.id) {
            toast.error(t('toasts.instituteDetailsUnavailable'));
            return;
        }
        if (!selectedPackageSessionId) {
            toast.error(t('toasts.selectClassBatch'));
            return;
        }

        const instituteId = instituteDetails.id;
        const selectedBatch = (instituteDetails.batches_for_sessions ?? []).find(
            (b) => b.id === selectedPackageSessionId
        );
        const sessionId = selectedBatch?.session?.id || '';
        if (!sessionId) {
            toast.error(t('toasts.invalidClassBatchSelection'));
            return;
        }

        const rows: BulkSubmitApplicationRow[] = validRows.map((row) => ({
            session_id: sessionId,
            destination_package_session_id: selectedPackageSessionId,
            ...(row.father_name ? { father_name: row.father_name } : {}),
            ...(row.father_email ? { father_email: row.father_email } : {}),
            ...(row.father_mobile ? { father_mobile: row.father_mobile } : {}),
            ...(row.mother_name ? { mother_name: row.mother_name } : {}),
            ...(row.mother_email ? { mother_email: row.mother_email } : {}),
            ...(row.mother_mobile ? { mother_mobile: row.mother_mobile } : {}),
            child_name: row.student_name,
            child_dob: row.date_of_birth,
            child_gender: row.gender,
            address_line: '',
        }));

        const payload: BulkSubmitApplicationRequest = {
            institute_id: instituteId,
            rows,
        };

        submitMutation.mutate(payload);
    };

    return (
        <Dialog open={open} onOpenChange={closeDialog}>
            <DialogContent className="max-h-dialog-tall w-dialog-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>

                <div className="mb-2 flex items-center gap-2 text-xs">
                    {[1, 2, 4].map((s) => (
                        <div
                            key={s}
                            className={`rounded-full px-3 py-1 ${
                                step === s ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-600'
                            }`}
                        >
                            {t('steps.label', { number: s })}
                        </div>
                    ))}
                </div>

                {step === 1 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div className="text-sm text-neutral-600">
                                {t('upload.templateHint')}
                            </div>
                            <MyButton buttonType="secondary" onClick={handleDownloadTemplate}>
                                {t('buttons.downloadTemplate')}
                            </MyButton>
                        </div>

                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="cursor-pointer rounded-md border-2 border-dashed border-neutral-300 p-8 text-center hover:border-primary-300"
                        >
                            <p className="text-sm">{t('upload.dropzoneCta')}</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) parseFile(file);
                                }}
                            />
                        </div>

                        {parseError && (
                            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                {parseError}
                            </div>
                        )}

                        {!parseError && validRows.length > 0 && (
                            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                                {t('upload.validRowsLabel')}: {validRows.length} | {t('upload.skippedRowsLabel')}:{' '}
                                {skippedRowsCount}
                            </div>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <p className="text-sm text-neutral-600">{t('classSelect.helperText')}</p>
                        <select
                            value={selectedPackageSessionId}
                            onChange={(e) => setSelectedPackageSessionId(e.target.value)}
                            className="w-full rounded-md border p-2 text-sm"
                        >
                            <option value="">{t('classSelect.placeholder')}</option>
                            {classOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {step === 4 && (
                    <div className="space-y-4">
                        <div className="text-sm text-neutral-600">
                            {t('preview.summary', { count: validRows.length })}
                        </div>
                        <div className="max-h-80 overflow-x-auto overflow-y-auto rounded-md border">
                            <table className="w-full min-w-[920px] text-start text-sm"> {/* design-lint-ignore: table min-width for horizontal-scroll layout, no scale token close enough */}
                                <thead className="bg-neutral-50">
                                    <tr>
                                        <th className="px-3 py-2">{t('columns.studentName')}</th>
                                        <th className="px-3 py-2">{t('columns.gender')}</th>
                                        <th className="px-3 py-2">{t('columns.dateOfBirth')}</th>
                                        <th className="px-3 py-2">{t('columns.fatherName')}</th>
                                        <th className="px-3 py-2">{t('columns.fatherEmail')}</th>
                                        <th className="px-3 py-2">{t('columns.fatherMobile')}</th>
                                        <th className="px-3 py-2">{t('columns.motherName')}</th>
                                        <th className="px-3 py-2">{t('columns.motherEmail')}</th>
                                        <th className="px-3 py-2">{t('columns.motherMobile')}</th>
                                        <th className="px-3 py-2">{t('columns.status')}</th>
                                        <th className="px-3 py-2">{t('columns.source')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {validRows.map((row, index) => (
                                        <tr key={`${row.student_name}-${index}`} className="border-t">
                                            <td className="px-3 py-2">{row.student_name}</td>
                                            <td className="px-3 py-2">{row.gender}</td>
                                            <td className="px-3 py-2">{row.date_of_birth}</td>
                                            <td className="px-3 py-2">{row.father_name || '-'}</td>
                                            <td className="px-3 py-2">{row.father_email || '-'}</td>
                                            <td className="px-3 py-2">{row.father_mobile || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_name || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_email || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_mobile || '-'}</td>
                                            <td className="px-3 py-2">{row.status}</td>
                                            <td className="px-3 py-2">{row.source_type || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                    <MyButton
                        buttonType="secondary"
                        disabled={step === 1 || submitMutation.isPending}
                        onClick={() => setStep(step === 4 ? 2 : 1)}
                    >
                        {t('buttons.back')}
                    </MyButton>
                    <div className="flex items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            disabled={submitMutation.isPending}
                            onClick={() => closeDialog(false)}
                        >
                            {t('buttons.cancel')}
                        </MyButton>
                        {step < 4 ? (
                            <MyButton
                                disabled={
                                    submitMutation.isPending ||
                                    (step === 1 && (!!parseError || validRows.length === 0))
                                }
                                onClick={() => {
                                    if (step === 2 && !selectedPackageSessionId) {
                                        toast.warning(t('toasts.selectClassBatch'));
                                        return;
                                    }
                                    setStep(step === 1 ? 2 : 4);
                                }}
                            >
                                {t('buttons.next')}
                            </MyButton>
                        ) : (
                            <MyButton
                                disabled={submitMutation.isPending || validRows.length === 0}
                                onClick={handleConfirmSubmit}
                            >
                                {submitMutation.isPending ? t('buttons.importing') : t('buttons.confirmImport')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

