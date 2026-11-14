import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ImageTemplate,
    FieldMapping,
    CertificateStudentData,
} from '@/types/certificate/certificate-types';
import { certificateGenerationService } from '../../-services/pdf-generation-service';
import { MyButton } from '@/components/design-system/button';
import {
    Eye,
    Download,
    CaretLeft,
    CaretRight,
    Users,
    Star,
    Image,
    ArrowClockwise,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface CertificatePreviewProps {
    imageTemplate: ImageTemplate;
    fieldMappings: FieldMapping[];
    selectedStudents: CertificateStudentData[];
    csvData?: Record<string, string | number>[];
    isLoading?: boolean;
}

export const CertificatePreview = ({
    imageTemplate,
    fieldMappings,
    selectedStudents,
    csvData,
    isLoading = false,
}: CertificatePreviewProps) => {
    const { t } = useTranslation('certificateGenerationCertificatePreview');
    const [currentStudentIndex, setCurrentStudentIndex] = useState(0);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const currentStudent = selectedStudents[currentStudentIndex];

    // Generate input data for current student
    const generateInputData = (
        student: CertificateStudentData,
        csvRow?: Record<string, string | number>
    ) => {
        const inputs: Record<string, string> = {};

        fieldMappings.forEach((mapping) => {
            let value = '';

            // Try to get value from various sources
            switch (mapping.fieldName) {
                case 'user_id':
                    value = student.user_id || '';
                    break;
                case 'enrollment_number':
                    value = student.institute_enrollment_id || '';
                    break;
                case 'student_name':
                case 'full_name':
                    value = student.full_name || '';
                    break;
                case 'email':
                    value = student.email || '';
                    break;
                case 'mobile_number':
                    value = student.mobile_number || '';
                    break;
                case 'institute_name':
                    value = student.linked_institute_name || 'University of Technology';
                    break;
                case 'completion_date':
                    value = new Date().toLocaleDateString();
                    break;
                default:
                    // Try CSV data first, then student dynamic fields
                    if (csvRow && csvRow[mapping.fieldName] !== undefined) {
                        value = csvRow[mapping.fieldName]?.toString() || '';
                    } else if (
                        student.dynamicFields &&
                        student.dynamicFields[mapping.fieldName] !== undefined
                    ) {
                        value = student.dynamicFields[mapping.fieldName]?.toString() || '';
                    } else {
                        value = t('fieldValues.sampleValue', { field: mapping.displayName });
                    }
            }

            inputs[mapping.id] = value;
        });

        return inputs;
    };

    // Generate preview image
    const generatePreview = async () => {
        if (!currentStudent || fieldMappings.length === 0) return;

        try {
            setIsGeneratingPreview(true);
            setPreviewError(null);

            // Get CSV row for current student
            const csvRow = csvData?.find(
                (row) =>
                    row.user_id === currentStudent.user_id ||
                    row.enrollment_number === currentStudent.institute_enrollment_id
            );

            // Generate input data
            const inputs = generateInputData(currentStudent, csvRow);

            // Generate preview
            const previewDataUrl = await certificateGenerationService.generatePreviewCertificate(
                imageTemplate,
                fieldMappings,
                inputs
            );

            setPreviewImageUrl(previewDataUrl);
        } catch (error) {
            console.error('Failed to generate preview:', error);
            setPreviewError(t('previewImage.errorMessage'));
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    // Generate preview when dependencies change
    useEffect(() => {
        if (imageTemplate && fieldMappings.length > 0 && currentStudent) {
            generatePreview();
        } else {
            setPreviewImageUrl(null);
        }
    }, [imageTemplate, fieldMappings, currentStudent, csvData]);

    // Navigation functions
    const handlePrevStudent = () => {
        setCurrentStudentIndex((prev) => Math.max(0, prev - 1));
    };

    const handleNextStudent = () => {
        setCurrentStudentIndex((prev) => Math.min(selectedStudents.length - 1, prev + 1));
    };

    const handleDownloadPreview = async () => {
        if (!currentStudent) return;

        try {
            // Get CSV row for current student
            const csvRow = csvData?.find(
                (row) =>
                    row.user_id === currentStudent.user_id ||
                    row.enrollment_number === currentStudent.institute_enrollment_id
            );

            // Generate certificate
            const { pdfBlob } = await certificateGenerationService.generateSingleCertificate(
                imageTemplate,
                fieldMappings,
                currentStudent,
                csvRow
            );

            // Download the PDF
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `preview_certificate_${currentStudent.full_name?.replace(/[^a-zA-Z0-9]/g, '_') || t('download.unnamedStudent')}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download preview:', error);
        }
    };

    const handleRefreshPreview = () => {
        generatePreview();
    };

    if (fieldMappings.length === 0) {
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-8">
                <div className="text-center">
                    <div className="mx-auto mb-4 w-fit rounded-full bg-amber-100 p-4">
                        <Eye className="size-8 text-amber-600" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium text-amber-800">
                        {t('emptyState.title')}
                    </h3>
                    <p className="mb-4 text-sm text-amber-700">{t('emptyState.description')}</p>
                    <div className="flex items-center justify-center gap-2 text-xs text-amber-600">
                        <Star className="size-4" />
                        <span>{t('emptyState.hint')}</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Preview Header */}
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-green-100 p-2">
                        <Eye className="size-5 text-green-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-neutral-700">
                            {t('header.title')}
                        </h3>
                        <p className="text-sm text-neutral-500">{t('header.subtitle')}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Student Navigation */}
                    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={handlePrevStudent}
                            disabled={currentStudentIndex === 0}
                            className="border-0 bg-transparent"
                        >
                            <CaretLeft className="size-4" />
                        </MyButton>

                        <div className="px-2 text-center">
                            <div className="text-xs font-medium text-neutral-700">
                                {t('studentNav.position', {
                                    current: currentStudentIndex + 1,
                                    total: selectedStudents.length,
                                })}
                            </div>
                            <div className="max-w-32 truncate text-xs text-neutral-500">
                                {currentStudent?.full_name}
                            </div>
                        </div>

                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={handleNextStudent}
                            disabled={currentStudentIndex === selectedStudents.length - 1}
                            className="border-0 bg-transparent"
                        >
                            <CaretRight className="size-4" />
                        </MyButton>
                    </div>

                    {/* Actions */}
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={handleRefreshPreview}
                        disabled={isGeneratingPreview}
                        className="text-sm"
                    >
                        <ArrowClockwise
                            className={cn('size-4', isGeneratingPreview && 'animate-spin')}
                        />
                    </MyButton>

                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleDownloadPreview}
                        disabled={!previewImageUrl || isGeneratingPreview}
                        className="text-sm"
                    >
                        <Download className="me-2 size-4" />
                        {t('actions.downloadPreview')}
                    </MyButton>
                </div>
            </div>

            {/* Student Info */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-start gap-3">
                    <div className="rounded-full bg-blue-100 p-2">
                        <Users className="size-4 text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-sm font-medium text-blue-800">
                            {t('studentInfo.previewing', { name: currentStudent?.full_name })}
                        </h4>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-blue-700 md:grid-cols-4">
                            <span>
                                <strong>{t('studentInfo.idLabel')}</strong>{' '}
                                {currentStudent?.user_id}
                            </span>
                            <span>
                                <strong>{t('studentInfo.emailLabel')}</strong>{' '}
                                {currentStudent?.email}
                            </span>
                            <span>
                                <strong>{t('studentInfo.enrollmentLabel')}</strong>{' '}
                                {currentStudent?.institute_enrollment_id}
                            </span>
                            <span>
                                <strong>{t('studentInfo.instituteLabel')}</strong>{' '}
                                {currentStudent?.linked_institute_name}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Certificate Image Preview */}
            <div
                className={cn(
                    'relative overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm',
                    isLoading && 'opacity-50'
                )}
            >
                {(isGeneratingPreview || previewError || !previewImageUrl) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90">
                        <div className="p-8 text-center">
                            {previewError ? (
                                <>
                                    <div className="mx-auto mb-3 w-fit rounded-full bg-red-100 p-4">
                                        <Eye className="size-8 text-red-600" />
                                    </div>
                                    <h4 className="mb-2 text-lg font-medium text-red-800">
                                        {t('previewImage.errorTitle')}
                                    </h4>
                                    <p className="mb-4 text-sm text-red-700">{previewError}</p>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={handleRefreshPreview}
                                        className="text-sm"
                                    >
                                        <ArrowClockwise className="me-2 size-4" />
                                        {t('actions.retry')}
                                    </MyButton>
                                </>
                            ) : isGeneratingPreview ? (
                                <>
                                    <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600" />
                                    <p className="text-sm text-neutral-600">
                                        {t('previewImage.generating')}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="mx-auto mb-3 w-fit rounded-full bg-neutral-100 p-4">
                                        <Image className="size-8 text-neutral-600" />
                                    </div>
                                    <p className="text-sm text-neutral-600">
                                        {t('previewImage.empty')}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Certificate Image */}
                {previewImageUrl && (
                    <div className="flex items-center justify-center bg-gray-50 p-4">
                        <img
                            src={previewImageUrl}
                            alt={t('previewImage.alt')}
                            className="max-h-96 max-w-full rounded border border-neutral-300 bg-white object-contain shadow-lg"
                        />
                    </div>
                )}
            </div>

            {/* Field Values Summary */}
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <h4 className="mb-3 text-sm font-medium text-neutral-700">
                    {t('fieldValues.title', { name: currentStudent?.full_name })}
                </h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {fieldMappings.map((mapping) => {
                        const csvRow = csvData?.find(
                            (row) =>
                                row.user_id === currentStudent?.user_id ||
                                row.enrollment_number === currentStudent?.institute_enrollment_id
                        );
                        const inputs = currentStudent
                            ? generateInputData(currentStudent, csvRow)
                            : {};
                        const value = inputs[mapping.id];

                        return (
                            <div
                                key={mapping.id}
                                className="rounded-md border border-neutral-200 bg-white p-2"
                            >
                                <div className="truncate text-xs font-medium text-neutral-700">
                                    {mapping.displayName}
                                </div>
                                <div className="mt-1 truncate text-xs text-neutral-600">
                                    {value || t('fieldValues.noValue')}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
