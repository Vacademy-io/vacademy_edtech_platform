// utils/csv-utils.ts
import Papa from 'papaparse';
import type { TFunction } from 'i18next';
import {
    SchemaFields,
    ValidationError,
} from '@/routes/manage-students/students-list/-types/bulk-upload-types';
import { Header } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/csv-bulk-init';
import { CSVFormatFormType } from '../../../-schemas/student-bulk-enroll/enroll-bulk-schema';

type ParseResult = {
    data: SchemaFields[];
    errors: ValidationError[];
};

// Utility to check if a date string matches the expected format
export const isValidDateFormat = (dateStr: string, format: string): boolean => {
    // Normalize the format for case-insensitive comparison
    const normalizedFormat = format.toUpperCase();

    // Handle all date formats that are essentially DD-MM-YYYY
    if (normalizedFormat === 'DD-MM-YYYY' || normalizedFormat === 'DD-MM-YYYY') {
        // Validate dates in format XX-XX-XXXX where X is a digit
        const regex = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
        if (regex.test(dateStr)) {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const day = parseInt(parts[0] || '', 10);
                const month = parseInt(parts[1] || '', 10);
                const year = parseInt(parts[2] || '', 10);

                // Check if the date is valid
                return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year > 0;
            }
        }
        return false;
    }

    // For other formats, improve the regex pattern
    let pattern = format;
    // Case-insensitive replacements
    pattern = pattern
        .replace(/[Dd][Dd]/g, '(0[1-9]|[12][0-9]|3[01])')
        .replace(/[Mm][Mm]/g, '(0[1-9]|1[012])')
        .replace(/[Yy][Yy][Yy][Yy]/g, '\\d{4}')
        .replace(/-/g, '\\-')
        .replace(/\//g, '\\/');

    return new RegExp(`^${pattern}$`).test(dateStr);
};

export const convertExcelDateToDesiredFormat = (
    dateString: string,
    targetFormat: string = 'DD-MM-YYYY'
): string => {
    // Handle Excel date format (Mon Dec 11 00:00:00 GMT X)
    if (dateString.includes('GMT') || dateString.match(/^\d+$/)) {
        try {
            let date;
            // If it's a number (Excel serialized date)
            if (dateString.match(/^\d+$/)) {
                // Excel dates start from December 30, 1899
                const excelEpoch = new Date(1899, 11, 30);
                const days = parseInt(dateString);
                date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
            } else {
                date = new Date(dateString);
            }

            if (isNaN(date.getTime())) {
                return dateString; // Return original if parsing failed
            }

            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();

            // Format according to target format
            if (targetFormat === 'DD-MM-YYYY') {
                return `${day}-${month}-${year}`;
            } else if (targetFormat === 'MM-DD-YYYY') {
                return `${month}-${day}-${year}`;
            } else if (targetFormat === 'YYYY-MM-DD') {
                return `${year}-${month}-${day}`;
            }
        } catch (error) {
            console.error('Date conversion error:', error);
        }
    }

    return dateString;
};

// Enhanced validation function
export const validateCsvData = (
    file: File,
    headers: Header[],
    t: TFunction,
    csvFormat?: CSVFormatFormType
): Promise<ParseResult> => {
    return new Promise((resolve, reject) => {
        Papa.parse<SchemaFields>(file, {
            header: true,
            skipEmptyLines: true,
            transform: (value) => value.trim(), // Trim values to handle whitespace
            complete: (results) => {
                const allErrors: ValidationError[] = [];
                const processedData = results.data.map((row, rowIndex) => {
                    const processedRow: SchemaFields = { ...row };

                    // Check if row is empty (all fields are empty)
                    const isRowEmpty = headers.every((header) => {
                        const value = row[header.column_name];
                        return !value || (typeof value === 'string' && value.trim() === '');
                    });

                    // Skip validation for empty rows
                    if (isRowEmpty) {
                        return processedRow;
                    }

                    // Validate each field according to its type and constraints
                    headers.forEach((header) => {
                        const fieldName = header.column_name;
                        const value = row[fieldName] as string;

                        // Convert gender values to uppercase during initial load
                        if (header.type === 'gender' && value) {
                            processedRow[fieldName] = value.toUpperCase();
                        }

                        // Wrap ADDRESS_LINE values in inverted commas
                        if (fieldName === 'ADDRESS_LINE' && value) {
                            processedRow[fieldName] = `"${value}"`;
                        }

                        // Determine if field is optional based on both schema and user settings
                        const isOptional =
                            header.optional ||
                            (csvFormat &&
                                fieldName in csvFormat &&
                                !csvFormat[fieldName as keyof CSVFormatFormType]);

                        // Skip validation if the field is optional and empty
                        if (isOptional && (!value || value.trim() === '')) {
                            return;
                        }

                        // Check if required field is missing
                        if (!isOptional && (!value || value.trim() === '')) {
                            const displayField = fieldName.replace(/_/g, ' ');
                            allErrors.push({
                                path: [rowIndex, fieldName],
                                message: t('validation.required', { field: displayField }),
                                resolution: t('validation.requiredResolution', {
                                    field: displayField,
                                }),
                                currentVal: 'N/A',
                                format: '',
                            });
                            return;
                        }

                        // Usernames must not contain spaces. Flag the row so this
                        // learner is NOT enrolled — any error here blocks the upload
                        // and highlights the offending USERNAME cell in the preview.
                        // (Values are already end-trimmed above, so this catches
                        // internal spaces like "john doe".)
                        if (fieldName.toUpperCase() === 'USERNAME' && value && /\s/.test(value)) {
                            allErrors.push({
                                path: [rowIndex, fieldName],
                                message: t('validation.usernameNoSpaces'),
                                resolution: t('validation.usernameNoSpacesResolution'),
                                currentVal: value,
                                format: t('validation.usernameNoSpacesFormat'),
                            });
                        }

                        // If field has a value, validate according to type
                        if (value) {
                            if (header.type === 'gender') {
                                const upperCaseValue = value.toUpperCase();
                                const validOptions = header.options ||
                                    header.sample_values || ['MALE', 'FEMALE', 'OTHERS'];
                                if (validOptions && !validOptions.includes(upperCaseValue)) {
                                    allErrors.push({
                                        path: [rowIndex, fieldName],
                                        message: t('validation.invalidValue', {
                                            field: fieldName.replace(/_/g, ' '),
                                        }),
                                        resolution: t('validation.invalidValueResolution', {
                                            options: validOptions.join(', '),
                                        }),
                                        currentVal: value,
                                        format: validOptions.join(', '),
                                    });
                                }
                            }

                            // Enum validation
                            if (
                                header.type === 'enum' &&
                                header.options &&
                                header.options.length > 0
                            ) {
                                if (!header.options.includes(value)) {
                                    allErrors.push({
                                        path: [rowIndex, fieldName],
                                        message: t('validation.invalidValue', {
                                            field: fieldName.replace(/_/g, ' '),
                                        }),
                                        resolution: t('validation.invalidValueResolution', {
                                            options: header.options.join(', '),
                                        }),
                                        currentVal: value,
                                        format: header.options.join(', '),
                                    });
                                } else if (header.send_option_id && header.option_ids) {
                                    // Map display value to ID if needed
                                    const option = Object.entries(header.option_ids).find(
                                        ([displayValue]) => displayValue === value
                                    );

                                    if (option) {
                                        processedRow[fieldName] = option[1];
                                    }
                                }
                            }

                            // Date validation
                            if (header.type === 'date' && header.format) {
                                const formattedDate = convertExcelDateToDesiredFormat(
                                    value,
                                    header.format
                                );

                                if (!isValidDateFormat(formattedDate, header.format)) {
                                    allErrors.push({
                                        path: [rowIndex, fieldName],
                                        message: t('validation.invalidDateFormat', {
                                            field: fieldName.replace(/_/g, ' '),
                                        }),
                                        resolution: t('validation.invalidDateFormatResolution', {
                                            format: header.format,
                                        }),
                                        currentVal: value,
                                        format: header.format,
                                    });
                                } else {
                                    processedRow[fieldName] = formattedDate;
                                }
                            }

                            // Regex validation
                            if (header.regex) {
                                try {
                                    const regex = new RegExp(header.regex);
                                    if (!regex.test(value)) {
                                        allErrors.push({
                                            path: [rowIndex, fieldName],
                                            message:
                                                header.regex_error_message ||
                                                t('validation.invalidFormat', {
                                                    field: fieldName.replace(/_/g, ' '),
                                                }),
                                            resolution: t('validation.checkFormat'),
                                            currentVal: value,
                                            format: header.regex,
                                        });
                                    }
                                } catch (e) {
                                    console.error(`Invalid regex pattern: ${header.regex}`);
                                }
                            }

                            // Additional validations can be added here for other types
                        }
                    });

                    return processedRow;
                });

                resolve({
                    data: processedData,
                    errors: allErrors,
                });
            },
            error: (error) => reject(error),
        });
    });
};

export const createAndDownloadCsv = (data: SchemaFields[], fileName: string): void => {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
