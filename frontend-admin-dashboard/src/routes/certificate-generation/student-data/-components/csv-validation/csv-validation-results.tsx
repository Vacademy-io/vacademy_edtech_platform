import { CsvValidationResult } from '@/types/certificate/certificate-types';
import { formatValidationError, formatValidationWarning } from '../../-utils/csv-validation';
import { CheckCircle, XCircle, Warning, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CsvValidationResultsProps {
    validationResult: CsvValidationResult;
}

export const CsvValidationResults = ({ validationResult }: CsvValidationResultsProps) => {
    const { t } = useTranslation('certificateGenerationCsvValidationResults');
    const [showDetails, setShowDetails] = useState(false);

    const { isValid, errors, warnings } = validationResult;
    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;

    return (
        <div className="space-y-3">
            {/* Summary Card */}
            <div
                className={cn(
                    'rounded-lg border p-4 transition-all duration-200',
                    isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                )}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                'rounded-full p-1.5',
                                isValid ? 'bg-green-100' : 'bg-red-100'
                            )}
                        >
                            {isValid ? (
                                <CheckCircle className="size-5 text-green-600" />
                            ) : (
                                <XCircle className="size-5 text-red-600" />
                            )}
                        </div>

                        <div>
                            <h4
                                className={cn(
                                    'text-sm font-medium',
                                    isValid ? 'text-green-700' : 'text-red-700'
                                )}
                            >
                                {isValid ? t('validationPassed') : t('validationFailed')}
                            </h4>
                            <p className="mt-0.5 text-xs text-neutral-600">
                                {hasErrors && t('errorsCount', { count: errors.length })}
                                {hasErrors && hasWarnings && ' • '}
                                {hasWarnings && t('warningsCount', { count: warnings.length })}
                                {!hasErrors && !hasWarnings && t('allChecksPassed')}
                            </p>
                        </div>
                    </div>

                    {(hasErrors || hasWarnings) && (
                        <button
                            onClick={() => setShowDetails(!showDetails)}
                            className="text-xs text-neutral-500 underline transition-colors duration-200 hover:text-neutral-700"
                        >
                            {showDetails ? t('hideDetails') : t('showDetails')}
                        </button>
                    )}
                </div>
            </div>

            {/* Detailed Results */}
            {showDetails && (hasErrors || hasWarnings) && (
                <div className="space-y-3">
                    {/* Errors */}
                    {hasErrors && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <XCircle className="size-4 text-red-600" />
                                <h5 className="text-sm font-medium text-red-700">
                                    {t('errorsHeading', { count: errors.length })}
                                </h5>
                            </div>
                            <div className="space-y-2">
                                {errors.map((error, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start gap-2 rounded-md border border-red-200/50 bg-red-100/50 p-2"
                                    >
                                        <div className="mt-0.5 rounded-full bg-red-200 p-1">
                                            <div className="size-1.5 rounded-full bg-red-600"></div>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-xs leading-relaxed text-red-700">
                                                {formatValidationError(error)}
                                            </p>
                                            {error.type && (
                                                <span className="mt-1 inline-block rounded-full bg-red-200 px-2 py-0.5 text-xs font-medium text-red-700">
                                                    {error.type.replace('_', ' ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Warnings */}
                    {hasWarnings && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Warning className="size-4 text-amber-600" />
                                <h5 className="text-sm font-medium text-amber-700">
                                    {t('warningsHeading', { count: warnings.length })}
                                </h5>
                            </div>
                            <div className="space-y-2">
                                {warnings.map((warning, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start gap-2 rounded-md border border-amber-200/50 bg-amber-100/50 p-2"
                                    >
                                        <div className="mt-0.5 rounded-full bg-amber-200 p-1">
                                            <div className="size-1.5 rounded-full bg-amber-600"></div>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-xs leading-relaxed text-amber-700">
                                                {formatValidationWarning(warning)}
                                            </p>
                                            {warning.type && (
                                                <span className="mt-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700">
                                                    {warning.type.replace('_', ' ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Help Text */}
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-start gap-2">
                            <Info className="mt-0.5 size-4 text-blue-600" />
                            <div className="text-xs leading-relaxed text-blue-700">
                                <p className="mb-1 font-medium">{t('requirementsHeading')}</p>
                                <ul className="list-inside list-disc space-y-0.5">
                                    <li>{t('requirementFirstColumns')}</li>
                                    <li>{t('requirementAllSelectedIncluded')}</li>
                                    <li>{t('requirementNoExtraStudents')}</li>
                                    <li>{t('requirementUniqueHeaders')}</li>
                                    <li>{t('requirementFileSize')}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
