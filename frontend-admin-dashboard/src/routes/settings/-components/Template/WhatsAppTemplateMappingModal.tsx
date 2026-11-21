import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
    ArrowsClockwise,
    Warning,
    CheckCircle,
    X,
    FileText,
    GearSix,
} from '@phosphor-icons/react';
import { WhatsAppIcon } from '@/components/ui/whatsapp-icon';
import {
    MetaWhatsAppTemplate,
    WhatsAppTemplateMapping,
    CreateMappingRequest,
    VacademyDataField,
    PlaceholderMapping,
} from '@/types/message-template-types';
import { whatsappTemplateService } from '@/services/whatsapp-template-service';

interface WhatsAppTemplateMappingModalProps {
    isOpen: boolean;
    onClose: () => void;
    template: MetaWhatsAppTemplate | null;
    onMappingSaved: (mapping: WhatsAppTemplateMapping) => void;
}

export const WhatsAppTemplateMappingModal: React.FC<WhatsAppTemplateMappingModalProps> = ({
    isOpen,
    onClose,
    template,
    onMappingSaved,
}) => {
    const { t } = useTranslation('settingsWhatsAppTemplateMapping');
    const [mappings, setMappings] = useState<PlaceholderMapping[]>([]);
    const [vacademyFields, setVacademyFields] = useState<VacademyDataField[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [existingMapping, setExistingMapping] = useState<WhatsAppTemplateMapping | null>(null);
    const [selectedCategories, setSelectedCategories] = useState<Record<string, string>>({});

    const loadVacademyFields = useCallback(async () => {
        try {
            const fields = whatsappTemplateService.getVacademyDataFields();
            setVacademyFields(fields);
        } catch (err) {
            console.error('Error loading Vacademy fields:', err);
            setError(t('errors.loadFields'));
        }
    }, [t]);

    const loadExistingMapping = useCallback(async () => {
        if (!template) return;

        try {
            const mapping = await whatsappTemplateService.getTemplateMappings(template.id);
            setExistingMapping(mapping);
        } catch (err) {
            console.error('Error loading existing mapping:', err);
            // Don't show error for missing mapping - it's expected for new templates
        }
    }, [template]);

    const initializeMappings = useCallback(() => {
        if (!template) return;

        // Extract placeholders from template components
        const placeholders: string[] = [];
        template.components.forEach((component) => {
            if (component.type === 'BODY' && component.text) {
                // Find placeholders like {{1}}, {{name}}, {{student_name}}, {{custom_field}}, etc.
                // This regex matches any content inside {{}} brackets, not just numbers
                const matches = component.text.match(/\{\{([^}]+)\}\}/g);
                if (matches) {
                    matches.forEach((match) => {
                        const placeholder = match.replace(/[{}]/g, '');
                        if (!placeholders.includes(placeholder)) {
                            placeholders.push(placeholder);
                        }
                    });
                }
            }
        });

        // Initialize mappings
        const initialMappings: PlaceholderMapping[] = placeholders.map((placeholder) => {
            const existing = existingMapping?.mappings.find(
                (m) => m.metaPlaceholder === placeholder
            );
            return {
                metaPlaceholder: placeholder,
                vacademyField: existing?.vacademyField || '',
                fieldLabel: existing?.fieldLabel || '',
                dataType: existing?.dataType || 'text',
            };
        });

        setMappings(initialMappings);

        // Initialize selected categories for existing mappings
        const initialCategories: Record<string, string> = {};
        initialMappings.forEach((mapping) => {
            if (mapping.vacademyField) {
                const field = vacademyFields.find((f) => f.value === mapping.vacademyField);
                if (field) {
                    initialCategories[mapping.metaPlaceholder] = field.category;
                }
            }
        });
        setSelectedCategories(initialCategories);
    }, [template, existingMapping, vacademyFields]);

    useEffect(() => {
        if (isOpen && template) {
            loadVacademyFields();
            loadExistingMapping();
            initializeMappings();
        }
    }, [isOpen, template, loadVacademyFields, loadExistingMapping, initializeMappings]);

    const handleMappingChange = (placeholder: string, vacademyField: string) => {
        const field = vacademyFields.find((f) => f.value === vacademyField);
        setMappings((prev) =>
            prev.map((mapping) =>
                mapping.metaPlaceholder === placeholder
                    ? {
                          ...mapping,
                          vacademyField,
                          fieldLabel: field?.label || '',
                          dataType: field?.dataType || 'text',
                      }
                    : mapping
            )
        );
    };

    const handleCategoryChange = (placeholder: string, category: string) => {
        // Update selected category
        setSelectedCategories((prev) => ({
            ...prev,
            [placeholder]: category,
        }));

        // Reset the field when category changes
        setMappings((prev) =>
            prev.map((mapping) =>
                mapping.metaPlaceholder === placeholder
                    ? {
                          ...mapping,
                          vacademyField: '',
                          fieldLabel: '',
                          dataType: 'text',
                      }
                    : mapping
            )
        );
    };

    const handleSaveMapping = async () => {
        if (!template) return;

        setSaving(true);
        setError(null);

        try {
            const mappingData: CreateMappingRequest = {
                templateName: template.name,
                templateId: template.id,
                language: template.language,
                mappings: mappings.map((m) => ({
                    metaPlaceholder: m.metaPlaceholder,
                    vacademyField: m.vacademyField,
                })),
            };

            let savedMapping: WhatsAppTemplateMapping;
            if (existingMapping) {
                savedMapping = await whatsappTemplateService.updateTemplateMapping(
                    existingMapping.id,
                    mappingData
                );
            } else {
                savedMapping = await whatsappTemplateService.saveTemplateMapping(mappingData);
            }

            onMappingSaved(savedMapping);
            onClose();
        } catch (err) {
            console.error('Error saving mapping:', err);
            setError(t('errors.saveMapping'));
        } finally {
            setSaving(false);
        }
    };

    const getTemplatePreview = () => {
        if (!template) return '';

        const bodyComponent = template.components.find((c) => c.type === 'BODY');
        if (!bodyComponent?.text) return '';

        let preview = bodyComponent.text;
        mappings.forEach((mapping) => {
            if (mapping.vacademyField) {
                const field = vacademyFields.find((f) => f.value === mapping.vacademyField);
                const exampleValue = field ? `[${field.label}]` : `[${mapping.vacademyField}]`;
                preview = preview.replace(
                    new RegExp(`\\{\\{${mapping.metaPlaceholder}\\}\\}`, 'g'),
                    exampleValue
                );
            }
        });

        return preview;
    };

    const getFieldsByCategory = (category: string) => {
        return vacademyFields.filter((field) => field.category === category);
    };

    const getAvailableCategories = () => {
        const categories = new Set(vacademyFields.map((field) => field.category));
        return Array.from(categories);
    };

    const isMappingComplete = () => {
        return mappings.every((mapping) => mapping.vacademyField.trim() !== '');
    };

    if (!template) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-xl flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-gray-100 p-0">
                <DialogHeader className="shrink-0 border-b border-gray-200/60 bg-white/80 px-8 py-6 backdrop-blur-sm">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-bold text-gray-900">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/25">
                            <WhatsAppIcon className="size-5 text-white" />
                        </div>
                        {t('header.title')}
                    </DialogTitle>
                    <div className="mt-6">
                        <div className="rounded-xl border border-gray-200/60 bg-gradient-to-r from-gray-50 to-gray-100 p-6 shadow-sm">
                            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
                                <div className="flex size-6 items-center justify-center rounded-lg bg-blue-500">
                                    <FileText className="size-3 text-white" />
                                </div>
                                {template.name}
                            </h3>
                            <h4 className="mb-3 text-sm font-medium text-gray-600">
                                {t('header.templateBody')}
                            </h4>
                            <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-800">
                                {template.components.find((c) => c.type === 'BODY')?.text ||
                                    t('header.noBodyContent')}
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex min-h-0 flex-1">
                    {/* Main Content Area */}
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="space-y-8">
                            {/* Error Alert */}
                            {error && (
                                <Alert
                                    variant="destructive"
                                    className="border-red-200/60 bg-red-50/80 shadow-sm backdrop-blur-sm"
                                >
                                    <Warning className="size-4" />
                                    <AlertDescription className="font-medium text-red-700">
                                        {error}
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Mappings Section */}
                            <div className="space-y-6">
                                <h3 className="flex items-center gap-2 text-lg font-medium text-gray-600">
                                    <div className="flex size-6 items-center justify-center rounded-lg bg-gray-500">
                                        <GearSix className="size-3 text-white" />
                                    </div>
                                    {t('mappings.sectionTitle')}
                                </h3>
                                <div className="space-y-6">
                                    {mappings.map((mapping) => (
                                        <div
                                            key={mapping.metaPlaceholder}
                                            className="group rounded-2xl border border-gray-200/60 bg-white/80 p-6 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-blue-200/60 hover:shadow-md"
                                        >
                                            <div className="space-y-6">
                                                {/* Placeholder Header */}
                                                <div className="mb-6 flex items-center gap-4">
                                                    <div className="flex items-center gap-3">
                                                        <Badge className="border-blue-200 bg-blue-50 px-4 py-2 font-mono text-sm font-semibold text-blue-700">
                                                            {`{{${mapping.metaPlaceholder}}}`}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-gray-400">
                                                        <div className="h-px w-8 bg-gradient-to-r from-gray-300 to-transparent"></div>
                                                        <span className="text-lg">→</span>
                                                        <div className="h-px w-8 bg-gradient-to-l from-gray-300 to-transparent"></div>
                                                    </div>
                                                    <span className="rounded-lg bg-gray-50 px-3 py-1 text-sm font-medium text-gray-600">
                                                        {t('mappings.vacademyDataField')}
                                                    </span>
                                                </div>

                                                {/* Data Category Selection */}
                                                <div className="space-y-3">
                                                    <label className="text-sm font-semibold text-gray-700">
                                                        {t('mappings.dataCategory')}
                                                    </label>
                                                    <Select
                                                        value={
                                                            selectedCategories[
                                                                mapping.metaPlaceholder
                                                            ] || ''
                                                        }
                                                        onValueChange={(category) =>
                                                            handleCategoryChange(
                                                                mapping.metaPlaceholder,
                                                                category
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="h-12 w-full rounded-xl border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500">
                                                            <SelectValue
                                                                placeholder={t(
                                                                    'mappings.selectCategoryPlaceholder'
                                                                )}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {getAvailableCategories().map(
                                                                (category) => (
                                                                    <SelectItem
                                                                        key={category}
                                                                        value={category}
                                                                    >
                                                                        <div className="flex items-center gap-3">
                                                                            <span className="font-medium">
                                                                                {category
                                                                                    .charAt(0)
                                                                                    .toUpperCase() +
                                                                                    category.slice(
                                                                                        1
                                                                                    )}
                                                                            </span>
                                                                        </div>
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Field Selection */}
                                                {selectedCategories[mapping.metaPlaceholder] && (
                                                    <div className="space-y-3">
                                                        <label className="text-sm font-semibold text-gray-700">
                                                            {t('mappings.field')}
                                                        </label>
                                                        <Select
                                                            value={mapping.vacademyField}
                                                            onValueChange={(value) =>
                                                                handleMappingChange(
                                                                    mapping.metaPlaceholder,
                                                                    value
                                                                )
                                                            }
                                                        >
                                                            <SelectTrigger className="h-12 w-full rounded-xl border-neutral-300 shadow-sm focus:border-primary-500 focus:ring-primary-500">
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        'mappings.selectFieldPlaceholder'
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {getFieldsByCategory(
                                                                    selectedCategories[
                                                                        mapping.metaPlaceholder
                                                                    ] || ''
                                                                ).map((field) => (
                                                                    <SelectItem
                                                                        key={field.value}
                                                                        value={field.value}
                                                                    >
                                                                        <div className="flex flex-col py-1">
                                                                            <span className="font-medium text-gray-900">
                                                                                {field.label}
                                                                            </span>
                                                                            {field.description && (
                                                                                <span className="mt-1 text-xs text-gray-500">
                                                                                    {
                                                                                        field.description
                                                                                    }
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                )}

                                                {/* Mapping Status */}
                                                {mapping.fieldLabel && (
                                                    <div className="flex items-center gap-3 rounded-xl border border-green-200/60 bg-gradient-to-r from-green-50 to-emerald-50 p-4 shadow-sm">
                                                        <div className="flex size-8 items-center justify-center rounded-full bg-green-500">
                                                            <CheckCircle className="size-4 text-white" />
                                                        </div>
                                                        <div>
                                                            <span className="text-sm font-medium text-green-800">
                                                                {t('mappings.mappedTo')}
                                                            </span>
                                                            <span className="ml-1 text-sm font-bold text-green-900">
                                                                {
                                                                    selectedCategories[
                                                                        mapping.metaPlaceholder
                                                                    ]
                                                                }
                                                                .
                                                                {mapping.vacademyField
                                                                    .split('.')
                                                                    .pop()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Preview Sidebar */}
                    <div className="w-96 overflow-y-auto border-l border-gray-200/60 bg-gradient-to-b from-white/90 to-gray-50/90 p-8 backdrop-blur-sm">
                        <div className="space-y-8">
                            {/* WhatsApp Message Preview */}
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                    <div className="flex size-6 items-center justify-center rounded-full bg-green-500">
                                        <WhatsAppIcon className="size-3 text-white" />
                                    </div>
                                    {t('preview.title')}
                                </h4>
                                <div className="rounded-2xl border border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50 p-6 shadow-lg">
                                    <div className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-green-800">
                                        {isMappingComplete()
                                            ? getTemplatePreview()
                                            : template.components.find((c) => c.type === 'BODY')
                                                  ?.text ||
                                              t('preview.completeAllToSeePreview')}
                                    </div>
                                </div>
                            </div>

                            {/* Completion Status */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold text-gray-700">
                                    {t('completionStatus.title')}
                                </h4>
                                <div className="space-y-3">
                                    {mappings.map((mapping) => (
                                        <div
                                            key={mapping.metaPlaceholder}
                                            className="flex items-center gap-3 rounded-xl border border-gray-200/60 bg-white/60 p-3"
                                        >
                                            <div
                                                className={`flex size-6 items-center justify-center rounded-full ${
                                                    mapping.vacademyField
                                                        ? 'bg-green-500'
                                                        : 'bg-gray-300'
                                                }`}
                                            >
                                                {mapping.vacademyField ? (
                                                    <CheckCircle className="size-3 text-white" />
                                                ) : (
                                                    <X className="size-3 text-white" />
                                                )}
                                            </div>
                                            <span
                                                className={`text-sm font-medium ${
                                                    mapping.vacademyField
                                                        ? 'text-green-700'
                                                        : 'text-gray-500'
                                                }`}
                                            >
                                                {`{{${mapping.metaPlaceholder}}}`}{' '}
                                                {mapping.vacademyField
                                                    ? t('completionStatus.mapped')
                                                    : t('completionStatus.pending')}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {isMappingComplete() && (
                                    <div className="rounded-xl border border-green-200/60 bg-gradient-to-r from-green-50 to-emerald-50 p-4 shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-8 items-center justify-center rounded-full bg-green-500">
                                                <CheckCircle className="size-4 text-white" />
                                            </div>
                                            <span className="text-sm font-bold text-green-700">
                                                {t('completionStatus.allComplete')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex shrink-0 flex-col justify-end gap-4 border-t border-gray-200/60 bg-white/80 px-8 py-6 backdrop-blur-sm sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        disabled={saving}
                        className="h-12 w-full rounded-xl border-neutral-300 px-8 py-3 font-semibold text-neutral-700 shadow-sm transition-all duration-200 hover:border-neutral-400 hover:bg-neutral-50 sm:w-auto"
                    >
                        {t('footer.cancel')}
                    </Button>
                    <Button
                        onClick={handleSaveMapping}
                        disabled={saving || !isMappingComplete()}
                        className="h-12 w-full rounded-xl bg-primary-500 px-8 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:bg-primary-600 hover:shadow-xl focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-primary-300 sm:w-auto"
                    >
                        {saving ? (
                            <>
                                <ArrowsClockwise className="me-2 size-4 animate-spin" />
                                {t('footer.saving')}
                            </>
                        ) : (
                            t('footer.saveMapping')
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
