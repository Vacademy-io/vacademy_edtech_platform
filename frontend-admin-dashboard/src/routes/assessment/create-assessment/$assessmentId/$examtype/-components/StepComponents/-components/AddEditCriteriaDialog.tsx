import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkle, PencilSimple, FileText, Plus, Minus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
    CriteriaJson,
    CriteriaItem,
    CriteriaSource,
    generateAICriteria,
    listCriteriaTemplates,
    createCriteriaTemplate,
    EvaluationCriteriaTemplate,
    calculateTotalMarks,
    validateCriteriaMarks,
} from '../../../-services/criteria-services';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';

interface QuestionData {
    id?: string;
    text: string;
    question_type: string;
    max_marks: number;
    subject?: string;
}

interface AddEditCriteriaDialogProps {
    question: QuestionData;
    existingCriteria?: CriteriaJson;
    open: boolean;
    onSave: (criteria: CriteriaJson, source: CriteriaSource) => void;
    onClose: () => void;
}

export const AddEditCriteriaDialog = ({
    question,
    existingCriteria,
    open,
    onSave,
    onClose,
}: AddEditCriteriaDialogProps) => {
    const { t } = useTranslation('assessmentAddEditCriteriaDialog');
    const [selectedTab, setSelectedTab] = useState<'ai' | 'manual' | 'template'>('manual');
    const [aiGeneratedCriteria, setAiGeneratedCriteria] = useState<CriteriaJson | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [manualCriteria, setManualCriteria] = useState<CriteriaItem[]>(
        existingCriteria?.criteria || [{ name: '', description: '', max_marks: 0 }]
    );
    const [saveAsTemplate, setSaveAsTemplate] = useState<boolean>(false);

    // Generate AI Criteria Mutation
    const generateMutation = useMutation({
        mutationFn: () =>
            generateAICriteria({
                question_text: question.text,
                question_type: question.question_type,
                subject: question.subject || '',
                max_marks: question.max_marks,
            }),
        onSuccess: (data) => {
            setAiGeneratedCriteria(data);
            toast.success(t('toasts.criteriaGenerated'));
        },
        onError: () => {
            toast.error(t('toasts.generateFailed'));
        },
    });

    // List Templates Query
    const { data: templates = [], isLoading: templatesLoading } = useQuery({
        queryKey: ['criteria-templates', question.subject, question.question_type],
        queryFn: () =>
            listCriteriaTemplates({
                subject: question.subject,
                question_type: question.question_type,
            }),
        enabled: open && selectedTab === 'template',
    });

    // Create Template Mutation
    const createTemplateMutation = useMutation({
        mutationFn: createCriteriaTemplate,
        onSuccess: () => {
            toast.success(t('toasts.templateSaved'));
        },
        onError: () => {
            toast.error(t('toasts.templateSaveFailed'));
        },
    });

    const handleSave = async () => {
        let criteriaToSave: CriteriaJson | null = null;
        let source: CriteriaSource = 'manual';

        if (selectedTab === 'ai' && aiGeneratedCriteria) {
            criteriaToSave = aiGeneratedCriteria;
            source = 'ai';
        } else if (selectedTab === 'manual') {
            const totalMarks = calculateTotalMarks(manualCriteria);
            const validation = validateCriteriaMarks(totalMarks, question.max_marks);

            if (!validation.isValid) {
                toast.error(validation.message || t('toasts.invalidMarksDistribution'));
                return;
            }

            criteriaToSave = {
                max_marks: question.max_marks,
                criteria: manualCriteria.filter((c) => c.name.trim() !== ''),
            };
            source = 'manual';

            // Save as template if checkbox is checked
            if (saveAsTemplate) {
                const templateName = `${question.question_type} - ${question.max_marks} marks`;
                try {
                    await createTemplateMutation.mutateAsync({
                        name: templateName,
                        subject: question.subject || 'General',
                        questionType: question.question_type,
                        description: `Manual criteria template for ${question.question_type}`,
                        criteriaJson: criteriaToSave,
                    });
                } catch (error) {
                    // Template save failed, but continue with saving criteria
                    console.error('Template save failed:', error);
                }
            }
        } else if (selectedTab === 'template' && selectedTemplate) {
            const matchedTemplate = templates.find((tpl) => tpl.id === selectedTemplate);
            if (matchedTemplate) {
                criteriaToSave = matchedTemplate.criteriaJson;
                source = 'template';
            }
        }

        if (criteriaToSave) {
            onSave(criteriaToSave, source);
            onClose();
            toast.success(t('toasts.criteriaSaved'));
        } else {
            toast.error(t('toasts.incompleteCriteria'));
        }
    };

    const addManualCriteriaRow = () => {
        setManualCriteria([...manualCriteria, { name: '', description: '', max_marks: 0 }]);
    };

    const removeManualCriteriaRow = (index: number) => {
        setManualCriteria(manualCriteria.filter((_, i) => i !== index));
    };

    const updateManualCriteria = (index: number, field: keyof CriteriaItem, value: any) => {
        const updated = [...manualCriteria];
        updated[index] = { ...updated[index], [field]: value } as CriteriaItem;
        setManualCriteria(updated);
    };

    const manualTotalMarks = calculateTotalMarks(manualCriteria);
    const isManualValid = manualTotalMarks === question.max_marks;

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={existingCriteria ? t('dialog.headingEdit') : t('dialog.headingAdd')}
            dialogWidth="max-w-3xl"
            footer={
                <>
                    <MyButton type="button" scale="large" buttonType="secondary" onClick={onClose}>
                        {t('footer.cancel')}
                    </MyButton>
                    <MyButton type="button" scale="large" buttonType="primary" onClick={handleSave}>
                        {t('footer.save')}
                    </MyButton>
                </>
            }
        >
            {/* Question Info */}
            <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm text-neutral-600">
                    <strong>{t('questionInfo.typeLabel')}</strong> {question.question_type}
                </p>
                <p className="text-sm text-neutral-600">
                    <strong>{t('questionInfo.maxMarksLabel')}</strong> {question.max_marks}
                </p>
            </div>

            {/* Tabs */}
            <Tabs
                value={selectedTab}
                onValueChange={(v) => setSelectedTab(v as any)}
                className="flex flex-1 flex-col overflow-hidden"
            >
                <TabsList className="grid w-full grid-cols-3 bg-neutral-100">
                    <TabsTrigger value="manual" className="flex items-center gap-2">
                        <PencilSimple size={16} weight="bold" />
                        {t('tabs.manual')}
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="flex items-center gap-2">
                        <Sparkle size={16} weight="fill" />
                        {t('tabs.ai')}
                    </TabsTrigger>
                    <TabsTrigger value="template" className="flex items-center gap-2">
                        <FileText size={16} weight="fill" />
                        {t('tabs.template')}
                    </TabsTrigger>
                </TabsList>

                {/* Manual Tab */}
                <TabsContent value="manual" className="flex-1 space-y-4 overflow-y-auto">
                    <div className="space-y-3">
                        {manualCriteria.map((item, index) => (
                            <div
                                key={index}
                                className="space-y-3 rounded-md border border-neutral-200 bg-white p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-neutral-700">
                                        {t('manual.criteriaHeading', { index: index + 1 })}
                                    </h4>
                                    {manualCriteria.length > 1 && (
                                        <button
                                            onClick={() => removeManualCriteriaRow(index)}
                                            className="text-red-500 hover:text-red-700"
                                        >
                                            <Minus size={20} />
                                        </button>
                                    )}
                                </div>
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder={t('manual.namePlaceholder')}
                                    label={t('manual.nameLabel')}
                                    input={item.name}
                                    onChangeFunction={(e) =>
                                        updateManualCriteria(index, 'name', e.target.value)
                                    }
                                    required
                                />
                                <MyInput
                                    inputType="text"
                                    inputPlaceholder={t('manual.descriptionPlaceholder')}
                                    label={t('manual.descriptionLabel')}
                                    input={item.description}
                                    onChangeFunction={(e) =>
                                        updateManualCriteria(index, 'description', e.target.value)
                                    }
                                />
                                <MyInput
                                    inputType="number"
                                    inputPlaceholder={t('manual.maxMarksPlaceholder')}
                                    label={t('manual.maxMarksLabel')}
                                    input={String(item.max_marks)}
                                    onChangeFunction={(e) =>
                                        updateManualCriteria(
                                            index,
                                            'max_marks',
                                            Number(e.target.value)
                                        )
                                    }
                                    required
                                />
                            </div>
                        ))}
                    </div>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        onClick={addManualCriteriaRow}
                    >
                        <Plus size={16} className="mr-2" />
                        {t('manual.addCriteria')}
                    </MyButton>

                    {/* Save as Template Checkbox */}
                    <div className="flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 p-3">
                        <input
                            type="checkbox"
                            id="saveAsTemplate"
                            checked={saveAsTemplate}
                            onChange={(e) => setSaveAsTemplate(e.target.checked)}
                            className="size-4 cursor-pointer rounded border-primary-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                        />
                        <label
                            htmlFor="saveAsTemplate"
                            className="cursor-pointer text-sm font-medium text-primary-700"
                        >
                            {t('manual.saveAsTemplateLabel', {
                                questionType: question.question_type,
                                count: question.max_marks,
                            })}
                        </label>
                    </div>

                    <div
                        className={`rounded-md p-3 ${isManualValid ? 'border border-green-200 bg-green-50' : 'border border-yellow-200 bg-yellow-50'}`}
                    >
                        <p
                            className={`text-sm font-medium ${isManualValid ? 'text-green-700' : 'text-yellow-700'}`}
                        >
                            {t('manual.totalMarks', {
                                achieved: manualTotalMarks,
                                count: question.max_marks,
                            })}
                            {isManualValid
                                ? t('manual.totalMarksValidSuffix')
                                : t('manual.totalMarksInvalidSuffix')}
                        </p>
                    </div>
                </TabsContent>

                {/* AI Tab */}
                <TabsContent value="ai" className="flex-1 space-y-4 overflow-y-auto">
                    {generateMutation.isPending ? (
                        <DashboardLoader />
                    ) : aiGeneratedCriteria ? (
                        <>
                            <div className="rounded-md border border-green-200 bg-green-50 p-3">
                                <p className="text-sm font-medium text-green-700">
                                    {t('ai.generatedBanner')}
                                </p>
                            </div>
                            <div className="space-y-3">
                                {aiGeneratedCriteria.criteria.map((item, index) => (
                                    <div
                                        key={index}
                                        className="rounded-md border border-neutral-200 bg-white p-3"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <h4 className="font-medium text-neutral-800">
                                                    {index + 1}. {item.name}
                                                </h4>
                                                <p className="mt-1 text-sm text-neutral-600">
                                                    {item.description}
                                                </p>
                                            </div>
                                            <span className="ml-3 rounded-md bg-primary-50 px-2 py-1 text-sm font-semibold text-primary-600">
                                                {t('ai.marksBadge', { count: item.max_marks })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                onClick={() => {
                                    setAiGeneratedCriteria(null);
                                    generateMutation.mutate();
                                }}
                            >
                                {t('ai.regenerate')}
                            </MyButton>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Sparkle size={48} weight="fill" className="mb-4 text-primary-400" />
                            <p className="mb-4 text-neutral-600">{t('ai.emptyPrompt')}</p>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                onClick={() => generateMutation.mutate()}
                            >
                                <Sparkle size={16} weight="fill" className="mr-2" />
                                {t('ai.generateButton')}
                            </MyButton>
                        </div>
                    )}
                </TabsContent>

                {/* Template Tab */}
                <TabsContent value="template" className="flex-1 space-y-4 overflow-y-auto">
                    {templatesLoading ? (
                        <DashboardLoader />
                    ) : templates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8">
                            <FileText size={48} className="mb-4 text-neutral-300" />
                            <p className="text-neutral-500">{t('template.emptyState')}</p>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-neutral-600">
                                {t('template.selectPrompt')}
                            </p>
                            <div className="space-y-2">
                                {templates.map((template) => (
                                    <div
                                        key={template.id}
                                        onClick={() => setSelectedTemplate(template.id || null)}
                                        className={`cursor-pointer rounded-md border p-3 transition-colors ${
                                            selectedTemplate === template.id
                                                ? 'border-primary-500 bg-primary-50'
                                                : 'border-neutral-200 bg-white hover:border-primary-200'
                                        }`}
                                    >
                                        <h4 className="font-medium text-neutral-800">
                                            {template.name}
                                        </h4>
                                        <p className="mt-1 text-sm text-neutral-600">
                                            {template.description}
                                        </p>
                                        <p className="mt-2 text-xs text-neutral-500">
                                            {t('template.criteriaCount', {
                                                count: template.criteriaJson.criteria.length,
                                            })}{' '}
                                            •{' '}
                                            {t('template.marksCount', {
                                                count: template.criteriaJson.max_marks,
                                            })}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </TabsContent>
            </Tabs>
        </MyDialog>
    );
};
