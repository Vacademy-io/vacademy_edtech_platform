import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import {
    AvailableField,
    CertificateGenerationSession,
} from '@/types/certificate/certificate-types';
import {
    Hash,
    User,
    EnvelopeSimple,
    Calendar,
    Database,
    DotsSixVertical,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface FieldPaletteProps {
    session: CertificateGenerationSession;
}

interface DraggableFieldProps {
    field: AvailableField;
}

const DraggableField = ({ field }: DraggableFieldProps) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `field-${field.name}`,
        data: {
            type: 'field',
            field,
        },
    });

    const style = transform
        ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          }
        : undefined;

    const getFieldIcon = () => {
        switch (field.type) {
            case 'text':
                if (field.name.includes('email')) return EnvelopeSimple;
                if (field.name.includes('name')) return User;
                return Database;
            case 'number':
                return Hash;
            case 'date':
                return Calendar;
            default:
                return Database;
        }
    };

    const getFieldColor = () => {
        switch (field.source) {
            case 'system':
                return 'blue';
            case 'csv':
                return 'green';
            default:
                return 'gray';
        }
    };

    const Icon = getFieldIcon();
    const color = getFieldColor();

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className={cn(
                'group flex cursor-grab items-center gap-2 rounded-lg border p-3 transition-all duration-200 hover:shadow-sm',
                isDragging && 'opacity-50 shadow-lg',
                color === 'blue' && 'border-blue-200 bg-blue-50 hover:bg-blue-100',
                color === 'green' && 'border-green-200 bg-green-50 hover:bg-green-100',
                color === 'gray' && 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100'
            )}
        >
            <div className="rounded-md bg-white/50 p-1">
                <Icon
                    className={cn(
                        'size-4',
                        color === 'blue' && 'text-blue-600',
                        color === 'green' && 'text-green-600',
                        color === 'gray' && 'text-neutral-600'
                    )}
                />
            </div>

            <div className="min-w-0 flex-1">
                <p
                    className={cn(
                        'truncate text-sm font-medium',
                        color === 'blue' && 'text-blue-800',
                        color === 'green' && 'text-green-800',
                        color === 'gray' && 'text-neutral-800'
                    )}
                >
                    {field.displayName}
                </p>
                {field.sampleValue && (
                    <p
                        className={cn(
                            'truncate text-xs',
                            color === 'blue' && 'text-blue-600',
                            color === 'green' && 'text-green-600',
                            color === 'gray' && 'text-neutral-600'
                        )}
                    >
                        {field.sampleValue}
                    </p>
                )}
            </div>

            <div
                className={cn(
                    'opacity-0 transition-opacity group-hover:opacity-100',
                    color === 'blue' && 'text-blue-500',
                    color === 'green' && 'text-green-500',
                    color === 'gray' && 'text-neutral-500'
                )}
            >
                <DotsSixVertical className="size-4" />
            </div>
        </div>
    );
};

export const FieldPalette = ({ session }: FieldPaletteProps) => {
    const { t, i18n } = useTranslation('certificateGenerationFieldPalette');

    // System fields that are always available
    const systemFields: AvailableField[] = [
        {
            name: 'user_id',
            displayName: t('fields.userId.label'),
            type: 'text',
            isRequired: true,
            source: 'system',
            sampleValue: t('fields.userId.sample'),
        },
        {
            name: 'enrollment_number',
            displayName: t('fields.enrollmentNumber.label'),
            type: 'text',
            isRequired: true,
            source: 'system',
            sampleValue: t('fields.enrollmentNumber.sample'),
        },
        {
            name: 'student_name',
            displayName: t('fields.studentName.label'),
            type: 'text',
            isRequired: true,
            source: 'system',
            sampleValue: t('fields.studentName.sample'),
        },
        {
            name: 'full_name',
            displayName: t('fields.fullName.label'),
            type: 'text',
            isRequired: false,
            source: 'system',
            sampleValue: t('fields.fullName.sample'),
        },
        {
            name: 'email',
            displayName: t('fields.email.label'),
            type: 'text',
            isRequired: false,
            source: 'system',
            sampleValue: t('fields.email.sample'),
        },
        {
            name: 'mobile_number',
            displayName: t('fields.mobileNumber.label'),
            type: 'text',
            isRequired: false,
            source: 'system',
            sampleValue: t('fields.mobileNumber.sample'),
        },
        {
            name: 'institute_name',
            displayName: t('fields.instituteName.label'),
            type: 'text',
            isRequired: false,
            source: 'system',
            sampleValue: t('fields.instituteName.sample'),
        },
        {
            name: 'completion_date',
            displayName: t('fields.completionDate.label'),
            type: 'date',
            isRequired: false,
            source: 'system',
            sampleValue: new Date().toLocaleDateString(i18n.language),
        },
    ];

    // CSV fields from uploaded data
    const csvFields: AvailableField[] =
        session.csvHeaders?.slice(3).map((header) => {
            // Try to infer field type and get sample value
            const sampleRow = session.uploadedCsvData?.[0];
            const sampleValue = sampleRow?.[header];

            let fieldType: 'text' | 'number' | 'date' = 'text';
            if (typeof sampleValue === 'number') {
                fieldType = 'number';
            } else if (typeof sampleValue === 'string') {
                // Simple date detection
                const dateRegex = /^\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}$/;
                if (dateRegex.test(sampleValue)) {
                    fieldType = 'date';
                }
                // Number detection for string numbers
                else if (!isNaN(Number(sampleValue)) && sampleValue.trim() !== '') {
                    fieldType = 'number';
                }
            }

            return {
                name: header,
                displayName: header.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
                type: fieldType,
                isRequired: false,
                source: 'csv' as const,
                sampleValue: sampleValue?.toString() || 'Sample data',
            };
        }) || [];

    const allFields = [...systemFields, ...csvFields];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-neutral-700">{t('header.title')}</h3>
                <div className="text-xs text-neutral-500">
                    {t('header.count', { count: allFields.length })}
                </div>
            </div>

            {/* Instructions */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs text-blue-700">
                    <strong>{t('instructions.label')}</strong> {t('instructions.text')}
                </p>
            </div>

            {/* System Fields */}
            <div>
                <div className="mb-3 flex items-center gap-2">
                    <div className="size-3 rounded-full bg-blue-500"></div>
                    <h4 className="text-sm font-medium text-neutral-700">
                        {t('sections.systemFields')}
                    </h4>
                    <span className="text-xs text-neutral-500">
                        {t('sections.fieldCount', { count: systemFields.length })}
                    </span>
                </div>
                <div className="space-y-2">
                    {systemFields.map((field) => (
                        <DraggableField key={field.name} field={field} />
                    ))}
                </div>
            </div>

            {/* CSV Fields */}
            {csvFields.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center gap-2">
                        <div className="size-3 rounded-full bg-green-500"></div>
                        <h4 className="text-sm font-medium text-neutral-700">
                            {t('sections.csvFields')}
                        </h4>
                        <span className="text-xs text-neutral-500">
                            {t('sections.fieldCount', { count: csvFields.length })}
                        </span>
                    </div>
                    <div className="space-y-2">
                        {csvFields.map((field) => (
                            <DraggableField key={field.name} field={field} />
                        ))}
                    </div>
                </div>
            )}

            {/* No CSV Fields Message */}
            {csvFields.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="text-center">
                        <Database className="mx-auto mb-2 size-8 text-amber-600" />
                        <p className="text-sm font-medium text-amber-800">
                            {t('noCsvFields.title')}
                        </p>
                        <p className="mt-1 text-xs text-amber-700">
                            {t('noCsvFields.description')}
                        </p>
                    </div>
                </div>
            )}

            {/* Field Legend */}
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <h4 className="mb-2 text-xs font-medium text-neutral-600">{t('legend.title')}</h4>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-neutral-600">
                        <div className="size-2 rounded-full bg-blue-500"></div>
                        <span>{t('legend.systemFields')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-600">
                        <div className="size-2 rounded-full bg-green-500"></div>
                        <span>{t('legend.csvFields')}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
