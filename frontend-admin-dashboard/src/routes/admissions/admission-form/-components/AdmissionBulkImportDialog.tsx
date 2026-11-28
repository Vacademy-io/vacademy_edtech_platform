import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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
import type { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import {
    normalizeGender,
    parseOptionalEnquiryStatus,
    parseOptionalSourceType,
} from '@/routes/admissions/enquiries/-components/enquiry-bulk-import-utils';
import {
    submitAdmissionBulkWithLead,
    type BulkSubmitAdmissionRequest,
    type BulkSubmitAdmissionRow,
    type BulkSubmitAdmissionResponse,
} from '@/routes/admissions/-services/submit-admission-bulk';

type Step = 1 | 2 | 4;

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
    guardian_name?: string;
    guardian_mobile?: string;
    status: string;
    source_type?: 'WEBSITE' | 'GOOGLE_ADS' | 'FACEBOOK' | 'INSTAGRAM' | 'REFERRAL' | 'OTHER';
};

interface AdmissionBulkImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionId: string;
    onSuccess?: () => void;
}

const REQUIRED_COLUMN_LABELS = [
    'Student Name',
    'Gender',
    'Date of Birth',
    'Father Name',
    'Father Email',
    'Father Mobile',
    'Mother Name',
    'Mother Email',
    'Mother Mobile',
    'Guardian Name',
    'Guardian Mobile',
] as const;

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
    guardianname: 'guardian_name',
    guardian_name: 'guardian_name',
    guardianmobile: 'guardian_mobile',
    guardian_mobile: 'guardian_mobile',
    status: 'status',
    enquirystatus: 'status',
    enquiry_status: 'status',
    source: 'source_type',
    sourcetype: 'source_type',
    source_type: 'source_type',
};

const REQUIRED_CANONICAL_FIELDS: Array<keyof ParsedCsvRow> = [
    'student_name',
    'gender',
    'date_of_birth',
];

const toAliasKey = (raw: string): string =>
    raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

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
    if (Number.isNaN(dt.getTime()) || dt.getFullYear() !== year || dt.getMonth() + 1 !== month || dt.getDate() !== day) {
        return null;
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidMobile = (value: string): boolean => /^\+?[0-9]{7,15}$/.test(value.replace(/\s+/g, ''));

export const AdmissionBulkImportDialog = ({ open, onOpenChange, sessionId, onSuccess }: AdmissionBulkImportDialogProps) => {
    const { t } = useTranslation('admissionsAdmissionBulkImportDialog');
    const { t: tSubmitAdmissionBulk } = useTranslation('admissionsSubmitAdmissionBulk');
    const [step, setStep] = useState<Step>(1);
    const [parseError, setParseError] = useState<string | null>(null);
    const [validRows, setValidRows] = useState<ParsedCsvRow[]>([]);
    const [skippedRowsCount, setSkippedRowsCount] = useState(0);
    const [selectedPackageSessionId, setSelectedPackageSessionId] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { instituteDetails } = useInstituteDetailsStore();
    useQuery({ ...useInstituteQuery(), enabled: open });

    const classOptions = useMemo<{ id: string; label: string }[]>(
        () => {
            const batches = (instituteDetails?.batches_for_sessions ?? []) as BatchForSessionType[];
            return batches
                .filter((batch) => !sessionId || batch.session?.id === sessionId)
                .map((batch) => ({
                    id: batch.id,
                    label: `${batch.package_dto.package_name} - ${batch.level.level_name} - ${batch.session.session_name}`,
                }));
        },
        [instituteDetails?.batches_for_sessions, sessionId]
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
            'Student Name',
            'Gender',
            'Date of Birth',
            'Father Name',
            'Father Email',
            'Father Mobile',
            'Mother Name',
            'Mother Email',
            'Mother Mobile',
            'Guardian Name',
            'Guardian Mobile',
            'Status',
            'Source',
        ];
        const sample = [
            'John Student',
            'MALE',
            '2015-06-01',
            'John Father',
            'father@example.com',
            '+919876543210',
            'Jane Mother',
            'mother@example.com',
            '+919876543211',
            'Uncle Guardian',
            '+919876543212',
            'NEW',
            'WEBSITE',
        ];
        const csv = [headers.join(','), sample.join(',')].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'admission_bulk_import_template.csv';
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
                    const mapped = HEADER_ALIASES[toAliasKey(header)];
                    if (mapped) mappedColumns.set(header, mapped);
                }

                const missingRequired = REQUIRED_CANONICAL_FIELDS.filter((field) => !Array.from(mappedColumns.values()).includes(field));
                if (missingRequired.length > 0) {
                    const missing = missingRequired
                        .map((field) => REQUIRED_COLUMN_LABELS[REQUIRED_CANONICAL_FIELDS.indexOf(field)])
                        .join(', ');
                    setParseError(t('errors.missingColumns', { columns: missing }));
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
                    const guardianName = canonicalRow.guardian_name?.trim() || '';
                    const guardianMobile = canonicalRow.guardian_mobile?.trim() || '';
                    const gender = normalizeGender(canonicalRow.gender);
                    const dobIso = normalizeDobToISO(canonicalRow.date_of_birth);
                    const hasFather = !!(fatherName || fatherEmail || fatherMobile);
                    const hasMother = !!(motherName || motherEmail || motherMobile);
                    const hasAtLeastOneParent = hasFather || hasMother;
                    const fatherValid =
                        !hasFather || (!!fatherName && !!fatherEmail && !!fatherMobile && isValidEmail(fatherEmail) && isValidMobile(fatherMobile));
                    const motherValid =
                        !hasMother || (!!motherName && !!motherEmail && !!motherMobile && isValidEmail(motherEmail) && isValidMobile(motherMobile));
                    const hasGuardian = !!(guardianName || guardianMobile);
                    const guardianValid = !hasGuardian || (!!guardianName && !!guardianMobile && isValidMobile(guardianMobile));

                    if (
                        !studentName ||
                        !gender ||
                        !dobIso ||
                        !hasAtLeastOneParent ||
                        !fatherValid ||
                        !motherValid ||
                        !guardianValid
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
                        ...(guardianName ? { guardian_name: guardianName } : {}),
                        ...(guardianMobile ? { guardian_mobile: guardianMobile } : {}),
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
        mutationFn: (payload: BulkSubmitAdmissionRequest) =>
            submitAdmissionBulkWithLead(payload, tSubmitAdmissionBulk),
        onSuccess: (response: BulkSubmitAdmissionResponse) => {
            const successCount = Number(response?.summary?.successful || 0);
            const failedCount = Number(response?.summary?.failed || 0);

            toast.success(t('toast.importSuccess', { count: successCount, failedCount }));
            onSuccess?.();
            closeDialog(false);
        },
        onError: (error: Error) => {
            toast.error(error.message || t('toast.importError'));
        },
    });

    const handleConfirmSubmit = () => {
        if (!instituteDetails?.id) {
            toast.error(t('errors.instituteNotLoaded'));
            return;
        }
        if (!sessionId) {
            toast.error(t('errors.sessionRequired'));
            return;
        }

        const destinationId = selectedPackageSessionId || classOptions[0]?.id || '';
        if (!destinationId) {
            toast.error(t('errors.selectClassRequired'));
            return;
        }

        const rows: BulkSubmitAdmissionRow[] = validRows.map((row) => ({
            session_id: sessionId,
            destination_package_session_id: destinationId,
            ...(row.father_name ? { father_name: row.father_name } : {}),
            ...(row.father_email ? { father_email: row.father_email } : {}),
            ...(row.father_mobile ? { father_mobile: row.father_mobile } : {}),
            ...(row.mother_name ? { mother_name: row.mother_name } : {}),
            ...(row.mother_email ? { mother_email: row.mother_email } : {}),
            ...(row.mother_mobile ? { mother_mobile: row.mother_mobile } : {}),
            ...(row.guardian_name ? { guardian_name: row.guardian_name } : {}),
            ...(row.guardian_mobile ? { guardian_mobile: row.guardian_mobile } : {}),
            child_name: row.student_name,
            child_dob: row.date_of_birth,
            child_gender: row.gender,
            ...(row.status ? { status: row.status } : {}),
            ...(row.source_type ? { source_type: row.source_type } : {}),
        }));

        const payload: BulkSubmitAdmissionRequest = {
            institute_id: instituteDetails.id,
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
                            className={`rounded-full px-3 py-1 ${step === s ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-600'}`}
                        >
                            {t('steps.label', { number: s })}
                        </div>
                    ))}
                </div>

                {step === 1 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-md border p-3">
                            <div className="text-sm text-neutral-600">{t('upload.templateHint')}</div>
                            <MyButton buttonType="secondary" onClick={handleDownloadTemplate}>
                                {t('upload.downloadTemplateButton')}
                            </MyButton>
                        </div>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="cursor-pointer rounded-md border-2 border-dashed border-neutral-300 p-8 text-center hover:border-primary-300"
                        >
                            <p className="text-sm">{t('upload.clickToUpload')}</p>
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
                        {parseError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{parseError}</div>}
                        {!parseError && validRows.length > 0 && (
                            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                                {t('upload.rowsSummary', { validCount: validRows.length, skippedCount: skippedRowsCount })}
                            </div>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <p className="text-sm text-neutral-600">
                            {t('classStep.description')}
                        </p>
                        <select
                            value={selectedPackageSessionId}
                            onChange={(e) => setSelectedPackageSessionId(e.target.value)}
                            className="w-full rounded-md border p-2 text-sm"
                        >
                            <option value="">{t('classStep.noClassOption')}</option>
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
                        <div className="text-sm text-neutral-600">{t('preview.summary', { count: validRows.length })}</div>
                        <div className="max-h-80 overflow-x-auto overflow-y-auto rounded-md border">
                            <table className="w-full min-w-[920px] text-start text-sm"> {/* design-lint-ignore: table min-width for horizontal-scroll layout, no scale token close enough */}
                                <thead className="bg-neutral-50">
                                    <tr>
                                        <th className="px-3 py-2">{t('preview.columns.studentName')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.gender')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.dateOfBirth')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.fatherName')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.fatherEmail')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.fatherMobile')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.motherName')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.motherEmail')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.motherMobile')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.guardianName')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.guardianMobile')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.status')}</th>
                                        <th className="px-3 py-2">{t('preview.columns.source')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {validRows.map((row, index) => (
                                        <tr key={`${row.student_name}-${index}`} className="border-t">
                                            <td className="px-3 py-2">{row.student_name}</td>
                                            <td className="px-3 py-2">{t(`genderLabel.${row.gender}`)}</td>
                                            <td className="px-3 py-2">{row.date_of_birth}</td>
                                            <td className="px-3 py-2">{row.father_name || '-'}</td>
                                            <td className="px-3 py-2">{row.father_email || '-'}</td>
                                            <td className="px-3 py-2">{row.father_mobile || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_name || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_email || '-'}</td>
                                            <td className="px-3 py-2">{row.mother_mobile || '-'}</td>
                                            <td className="px-3 py-2">{row.guardian_name || '-'}</td>
                                            <td className="px-3 py-2">{row.guardian_mobile || '-'}</td>
                                            <td className="px-3 py-2">{t(`statusLabel.${row.status}`)}</td>
                                            <td className="px-3 py-2">{row.source_type ? t(`sourceLabel.${row.source_type}`) : '-'}</td>
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
                        {t('actions.back')}
                    </MyButton>
                    <div className="flex items-center gap-2">
                        <MyButton buttonType="secondary" disabled={submitMutation.isPending} onClick={() => closeDialog(false)}>
                            {t('actions.cancel')}
                        </MyButton>
                        {step < 4 ? (
                            <MyButton
                                disabled={submitMutation.isPending || (step === 1 && (!!parseError || validRows.length === 0))}
                                onClick={() => setStep(step === 1 ? 2 : 4)}
                            >
                                {t('actions.next')}
                            </MyButton>
                        ) : (
                            <MyButton disabled={submitMutation.isPending || validRows.length === 0} onClick={handleConfirmSubmit}>
                                {submitMutation.isPending ? t('actions.importing') : t('actions.confirmImport')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

