import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CertificateGenerationSession,
    CsvValidationResult,
    CsvTemplateRow,
} from '@/types/certificate/certificate-types';
import { MyButton } from '@/components/design-system/button';
import { Upload, Check, Warning, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { validateCsvData } from '../../-utils/csv-validation';

interface CsvUploadSectionProps {
    session: CertificateGenerationSession;
    onSessionUpdate: (updates: Partial<CertificateGenerationSession>) => void;
}

export const CsvUploadSection = ({ session, onSessionUpdate }: CsvUploadSectionProps) => {
    const { t } = useTranslation('certificateGenerationCsvUploadSection');
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (file: File | null) => {
        if (!file) return;

        // Check file size (1MB limit)
        const maxSize = 1 * 1024 * 1024; // 1MB in bytes
        if (file.size > maxSize) {
            const validationResult: CsvValidationResult = {
                isValid: false,
                errors: [
                    {
                        row: 0,
                        message: t('errors.fileSizeExceeded'),
                        type: 'file_size',
                    },
                ],
                warnings: [],
            };
            onSessionUpdate({ validationResult });
            return;
        }

        // Check file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            const validationResult: CsvValidationResult = {
                isValid: false,
                errors: [
                    {
                        row: 0,
                        message: t('errors.invalidFileType'),
                        type: 'invalid_data',
                    },
                ],
                warnings: [],
            };
            onSessionUpdate({ validationResult });
            return;
        }

        setIsUploading(true);

        try {
            // Read and parse CSV file
            const csvText = await file.text();
            const lines = csvText.split('\n').filter((line) => line.trim());

            if (lines.length < 2) {
                const validationResult: CsvValidationResult = {
                    isValid: false,
                    errors: [
                        {
                            row: 0,
                            message: t('errors.missingRows'),
                            type: 'invalid_data',
                        },
                    ],
                    warnings: [],
                };
                onSessionUpdate({ validationResult });
                setIsUploading(false);
                return;
            }

            // Parse CSV data
            const firstLine = lines[0];
            if (!firstLine) {
                const validationResult: CsvValidationResult = {
                    isValid: false,
                    errors: [
                        {
                            row: 0,
                            message: t('errors.emptyFile'),
                            type: 'invalid_data',
                        },
                    ],
                    warnings: [],
                };
                onSessionUpdate({ validationResult });
                setIsUploading(false);
                return;
            }

            const headers = firstLine.split(',').map((h) => h.trim().replace(/"/g, ''));
            const csvData: CsvTemplateRow[] = [];

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;

                const values = line.split(',').map((v) => v.trim().replace(/"/g, ''));
                const row: CsvTemplateRow = {
                    user_id: values[0] || '',
                    enrollment_number: values[1] || '',
                    student_name: values[2] || '',
                };

                // Add dynamic fields
                for (let j = 3; j < headers.length && j < values.length; j++) {
                    const value = values[j] || '';
                    const header = headers[j];
                    if (header) {
                        // Try to determine if it's a number
                        const numValue = Number(value);
                        row[header] = !isNaN(numValue) && value !== '' ? numValue : value;
                    }
                }

                csvData.push(row);
            }

            // Validate the CSV data
            const validationResult = validateCsvData(csvData, headers, session.selectedStudents);

            // Update session with the uploaded data
            onSessionUpdate({
                uploadedCsvData: csvData,
                csvHeaders: headers,
                validationResult,
            });
        } catch (error) {
            const validationResult: CsvValidationResult = {
                isValid: false,
                errors: [
                    {
                        row: 0,
                        message: t('errors.parseFailed'),
                        type: 'invalid_data',
                    },
                ],
                warnings: [],
            };
            onSessionUpdate({ validationResult });
        }

        setIsUploading(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0] || null);
        }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFileSelect(files[0] || null);
        }
    };

    const handleClearUpload = () => {
        onSessionUpdate({
            uploadedCsvData: undefined,
            csvHeaders: undefined,
            validationResult: undefined,
        });
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const isUploaded = session.uploadedCsvData && session.csvHeaders;
    const hasErrors = session.validationResult && !session.validationResult.isValid;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-base font-medium text-neutral-700">{t('heading')}</h3>
                {isUploaded && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={handleClearUpload}
                        className="flex items-center gap-1 text-xs"
                    >
                        <X className="size-3" />
                        {t('clearUpload')}
                    </MyButton>
                )}
            </div>

            {!isUploaded ? (
                <div
                    className={cn(
                        'relative rounded-lg border-2 border-dashed p-6 text-center transition-all duration-200',
                        isDragging
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100'
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileInputChange}
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                        disabled={isUploading}
                    />

                    <div className="flex flex-col items-center gap-3">
                        <div
                            className={cn(
                                'rounded-full p-3 transition-colors duration-200',
                                isDragging ? 'bg-blue-100' : 'bg-neutral-200'
                            )}
                        >
                            <Upload
                                className={cn(
                                    'size-6 transition-colors duration-200',
                                    isDragging ? 'text-blue-600' : 'text-neutral-500'
                                )}
                            />
                        </div>

                        <div>
                            <p className="text-sm font-medium text-neutral-700">
                                {isUploading ? t('processing') : t('uploadPrompt')}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">{t('dropHint')}</p>
                        </div>

                        {!isUploading && (
                            <MyButton buttonType="primary" scale="small" className="mt-2">
                                {t('selectFile')}
                            </MyButton>
                        )}
                    </div>
                </div>
            ) : (
                <div
                    className={cn(
                        'rounded-lg border p-4 transition-all duration-200',
                        hasErrors ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                    )}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                'rounded-full p-2',
                                hasErrors ? 'bg-red-100' : 'bg-green-100'
                            )}
                        >
                            {hasErrors ? (
                                <Warning className="size-4 text-red-600" />
                            ) : (
                                <Check className="size-4 text-green-600" />
                            )}
                        </div>

                        <div className="flex-1">
                            <p
                                className={cn(
                                    'text-sm font-medium',
                                    hasErrors ? 'text-red-700' : 'text-green-700'
                                )}
                            >
                                {hasErrors ? t('issuesFound') : t('uploadSuccessful')}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                                {t('rowsProcessed', {
                                    count: session.uploadedCsvData?.length || 0,
                                })}{' '}
                                •{' '}
                                {t('columnsCount', {
                                    count: session.csvHeaders?.length || 0,
                                })}{' '}
                                •{' '}
                                {t('dynamicFieldsCount', {
                                    count: (session.csvHeaders?.length || 0) - 3,
                                })}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {isUploaded && session.csvHeaders && (
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                    <h4 className="mb-3 text-sm font-medium text-neutral-700">
                        {t('detectedColumns')}
                    </h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {session.csvHeaders.map((header, index) => (
                            <div
                                key={index}
                                className={cn(
                                    'rounded-md border px-3 py-2 text-xs font-medium',
                                    index < 3
                                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                                        : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                                )}
                            >
                                {header}
                                {index < 3 && (
                                    <span className="ms-1 text-blue-500">{t('required')}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
