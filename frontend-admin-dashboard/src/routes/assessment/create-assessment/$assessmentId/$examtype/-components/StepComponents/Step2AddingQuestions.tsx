import React, { useEffect, useRef } from 'react';
import { z } from 'zod';
import sectionDetailsSchema from '../../-utils/section-details-schema';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { MyButton } from '@/components/design-system/button';
import { Plus, Clock, ListPlus, Timer, ArrowRight, WarningCircle } from '@phosphor-icons/react';
import { Accordion } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { StepContentProps } from '@/types/assessments/step-content-props';
import { getAssessmentDetails, handlePostStep2Data } from '../../-services/assessment-services';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { zodResolver } from '@hookform/resolvers/zod';
import Step2SectionInfo from './Step2SectionInfo';
import Step2CreateAssessmentFromKnowledgeBase from './-components/Step2CreateAssessmentFromKnowledgeBase';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { getFieldOptions, getStepKey, syncStep2DataWithStore } from '../../-utils/helper';
import { useSectionDetailsStore } from '../../-utils/zustand-global-states/step2-add-questions';
import { useBasicInfoStore } from '../../-utils/zustand-global-states/step1-basic-info';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useParams } from '@tanstack/react-router';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { getSubjectNameById } from '@/routes/assessment/question-papers/-utils/helper';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyInput } from '@/components/design-system/input';
import { useTranslation } from 'react-i18next';
type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const Step2AddingQuestions: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('assessmentStep2AddingQuestions');
    const queryClient = useQueryClient();
    const params = useParams({ strict: false });
    const examType = params.examtype ?? '' as 'EXAM' | 'MOCK' | 'SURVEY'; // Ensure it's a string
    const assessmentId = params.assessmentId ?? ''; // Ensure it's string | null
    const storeDataStep2 = useSectionDetailsStore((state) => state);
    const { savedAssessmentId } = useSavedAssessmentStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );

    const form = useForm<SectionFormType>({
        resolver: zodResolver(sectionDetailsSchema),
        defaultValues: {
            status: completedSteps[currentStep] ? 'COMPLETE' : 'INCOMPLETE',
            testDuration: storeDataStep2.testDuration || {
                entireTestDuration: {
                    checked: true, // Default to true
                    testDuration: {
                        hrs: '0',
                        min: '0',
                    },
                },
                sectionWiseDuration: false, // Default to false
                questionWiseDuration: false,
            },
            section: storeDataStep2.section || [
                {
                    sectionId: '',
                    sectionName: t('sectionDefaultName', { number: 1 }),
                    questionPaperTitle: '',
                    subject: '',
                    yearClass: '',
                    uploaded_question_paper: null,
                    question_duration: {
                        hrs: '0',
                        min: '0',
                    },
                    section_description: '',
                    section_duration: {
                        hrs: '0',
                        min: '0',
                    },
                    marks_per_question: '0',
                    total_marks: '',
                    negative_marking: {
                        checked: false,
                        value: '0',
                    },
                    partial_marking: false,
                    cutoff_marks: {
                        checked: false,
                        value: '0',
                    },
                    problem_randomization: false,
                    adaptive_marking_for_each_question: [],
                },
            ],
        },
        mode: 'onChange',
    });

    const { handleSubmit, getValues, control, watch } = form;
    // Store initial data in useRef to ensure it remains constant throughout the form updates
    const oldData = useRef(getValues());
    const allSections = getValues('section');

    const handleSubmitStep2Form = useMutation({
        mutationFn: ({
            oldData,
            data,
            assessmentId,
            instituteId,
            type,
        }: {
            oldData: z.infer<typeof sectionDetailsSchema>;
            data: z.infer<typeof sectionDetailsSchema>;
            assessmentId: string | null;
            instituteId: string | undefined;
            type: string | undefined;
        }) => handlePostStep2Data(oldData, data, assessmentId, instituteId, type),
        onSuccess: async () => {
            if (assessmentId !== 'defaultId') {
                useTestAccessStore.getState().reset();
                window.history.back();
                toast.success(t('toasts.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
                queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            } else {
                syncStep2DataWithStore(form);
                toast.success(t('toasts.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
                queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'assessment-step2-add-questions',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveFailed'),
            });
        },
    });

    const onSubmit = (data: z.infer<typeof sectionDetailsSchema>) => {
        handleSubmitStep2Form.mutate({
            oldData: oldData.current,
            data: data,
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        });
    };

    const onInvalid = (errors: unknown) => {
        // Was an empty stub, so a blocked submit looked like a dead button. Step 3 already
        // scrolls to the first error; this does the same.
        const firstField = Object.keys((errors as Record<string, unknown>) ?? {})[0];
        toast.error('Please fix the highlighted fields before continuing.', {
            className: 'error-toast',
            duration: 3000,
        });
        if (firstField) {
            document
                .querySelector(`[name="${firstField}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    // The one owner of the section list. Cards are keyed by the field id
    // react-hook-form gives each section, not by index, and they delete
    // through this instance's remove(): a card that stays mounted while the
    // section under its index changes (a delete above it, or the paper's
    // sections replacing the blank one) kept showing the old section's name
    // and marks, because a controlled field only follows changes addressed
    // to its exact name. With stable ids React remounts the card for the
    // section that is actually there.
    const {
        fields: sectionFields,
        append,
        remove,
    } = useFieldArray({
        control,
        name: 'section', // Matches the key in defaultValues
    });

    const entireTestDuration = watch('testDuration.entireTestDuration.testDuration');
    const isAssessWiseCheck = watch('testDuration.entireTestDuration.checked');
    const isSectionWiseCheck = watch('testDuration.sectionWiseDuration');
    const isQuestionWiseCheck = watch('testDuration.questionWiseDuration');

    // OMR sheet mode (Step 1): only single-correct MCQs fit on a bubble sheet, and
    // publish refuses anything else. Warned here, never blocked. The Step 1 store
    // wins (it holds an unsaved toggle); the saved value covers a direct open of Step 2.
    const omrModeFromStep1 = useBasicInfoStore((state) => state.omrMode);
    const isOmrMode = omrModeFromStep1 ?? assessmentDetails[0]?.saved_data?.omr_mode === true;
    const watchedSections = watch('section');
    const nonMcqsCount = isOmrMode
        ? (watchedSections ?? []).reduce(
              (count, section) =>
                  count +
                  (section.adaptive_marking_for_each_question ?? []).filter(
                      (question) => question.questionType !== 'MCQS'
                  ).length,
              0
          )
        : 0;

    // Only when the backend lists a duration field for this step — the same test the
    // duration inputs below render on. A Manual Upload Exam has none (learners solve on
    // paper and upload the sheet), so demanding one here kept Next disabled for it with
    // nothing on screen to fill in.
    const durationIsAField = Boolean(
        getStepKey({ assessmentDetails, currentStep, key: 'duration' })
    );
    const isAssessmentDurationMissing =
        durationIsAField &&
        isAssessWiseCheck &&
        (!entireTestDuration?.hrs || entireTestDuration?.hrs === '0') &&
        (!entireTestDuration?.min || entireTestDuration?.min === '0');

    const handleAddSection = () => {
        append({
            sectionId: '',
            sectionName: t('sectionDefaultName', { number: allSections.length + 1 }),
            questionPaperTitle: '',
            subject: '',
            yearClass: '',
            uploaded_question_paper: null,
            question_duration: {
                hrs: '0',
                min: '0',
            },
            section_description: '',
            section_duration: {
                hrs: '0',
                min: '0',
            },
            marks_per_question: '0',
            total_marks: '0',
            negative_marking: {
                checked: false,
                value: '0',
            },
            partial_marking: false,
            cutoff_marks: {
                checked: false,
                value: '0',
            },
            problem_randomization: false,
            adaptive_marking_for_each_question: [],
        });
    };

    // Helper function to get test duration settings
    const getTestDurationSettings = () => {
        const savedData = assessmentDetails[currentStep]?.saved_data;
        const durationDistribution = savedData?.duration_distribution;
        const duration = savedData?.duration ?? 0;

        const isEntireTestDuration = durationDistribution === null || durationDistribution === 'ASSESSMENT';
        const hasValidDuration = durationDistribution === 'ASSESSMENT' && duration != null && duration > 0;

        return {
            entireTestDuration: {
                checked: isEntireTestDuration,
                testDuration: {
                    hrs: hasValidDuration ? String(Math.floor(duration / 60)) : '',
                    min: hasValidDuration ? String(Math.floor(duration % 60)) : '',
                },
            },
            sectionWiseDuration: durationDistribution === 'SECTION',
            questionWiseDuration: durationDistribution === 'QUESTION',
        };
    };

    // Helper function to create section from saved data
    const createSectionFromSavedData = (sectionDetails: any) => {
        const duration = sectionDetails.duration || 0;
        const sectionName = sectionDetails.name || '';

        return {
                              sectionId: sectionDetails.id || '',
                              sectionName: sectionName,
                              questionPaperTitle: '',
                              uploaded_question_paper: '',
                              subject: getSubjectNameById(
                                  instituteDetails?.subjects || [],
                                  assessmentDetails[0]?.saved_data?.subject_selection ?? ''
                              ),
                              yearClass: '',
                              question_duration: {
                hrs: String(Math.floor(duration / 60)) || '',
                min: String(duration % 60) || '',
                              },
                              section_description: sectionDetails.description?.content || '',
                              section_duration: {
                hrs: String(Math.floor(duration / 60)) || '',
                min: String(duration % 60) || '',
                              },
                              marks_per_question: '',
                              total_marks: String(sectionDetails.total_marks) || '',
                              negative_marking: {
                                  checked: false,
                                  value: '',
                              },
                              partial_marking: false,
                              cutoff_marks: {
                checked: sectionDetails.cutoff_marks > 0,
                                  value: String(sectionDetails.cutoff_marks) || '',
                              },
            problem_randomization: sectionDetails.problem_randomization === 'RANDOM',
                              adaptive_marking_for_each_question: [],
        };
    };

    // Helper function to create default section
    const createDefaultSection = () => {
        return {
                                  sectionId: '',
        sectionName: t('sectionDefaultName', { number: 1 }),
                                  questionPaperTitle: '',
                                  subject: '',
                                  yearClass: '',
                                  uploaded_question_paper: null,
                                  question_duration: {
                                      hrs: '',
                                      min: '',
                                  },
                                  section_description: '',
                                  section_duration: {
                                      hrs: '',
                                      min: '',
                                  },
                                  marks_per_question: '',
                                  total_marks: '',
                                  negative_marking: {
                                      checked: false,
                                      value: '',
                                  },
                                  partial_marking: false,
                                  cutoff_marks: {
                                      checked: false,
                                      value: '',
                                  },
                                  problem_randomization: false,
                                  adaptive_marking_for_each_question: [],
        };
    };

    // Helper function to get sections data
    const getSectionsData = () => {
        const sections = assessmentDetails[currentStep]?.saved_data?.sections;

        if (Array.isArray(sections) && sections.length > 0) {
            const mappedSections = sections.map(createSectionFromSavedData);
            return mappedSections;
        }

        const defaultSection = createDefaultSection();
        return [defaultSection];
    };

    // Helper function to get initial form values
    const getInitialFormValues = () => {
        return {
            status: assessmentDetails[currentStep]?.status || 'INCOMPLETE',
            testDuration: getTestDurationSettings(),
            section: getSectionsData(),
        };
    };

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            const initialFormValues = getInitialFormValues();

            // Set initial form values
            form.reset(initialFormValues);

            // Store initial data in oldData
            oldData.current = initialFormValues;
        }
    }, [assessmentDetails, assessmentId]);

    if (isLoading || handleSubmitStep2Form.status === 'pending') return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form className="flex flex-col gap-6">
                {allSections.length > 0 && (
                    <>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-400 text-white shadow-sm">
                                    <ListPlus size={22} weight="bold" />
                                </div>
                                <div>
                                    <h1 className="text-h2-semibold tracking-tight">
                                        {t('header.title')}
                                    </h1>
                                    <p className="mt-1 text-sm text-neutral-500">
                                        {t('header.subtitle')}
                                    </p>
                                </div>
                            </div>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                className="group gap-2 shadow-sm hover:shadow-md"
                                disable={
                                    assessmentId === 'defaultId'
                                        ? allSections.some((section) => {
                                              // Check if section duration fields are valid based on durationDistribution
                                              const isSectionDurationMissing =
                                                  isSectionWiseCheck &&
                                                  (!section.section_duration?.hrs ||
                                                      section.section_duration?.hrs === '0') &&
                                                  (!section.section_duration?.min ||
                                                      section.section_duration?.min === '0');

                                              // Check if question duration fields are valid based on durationDistribution
                                              const isQuestionDurationMissing =
                                                  isQuestionWiseCheck &&
                                                  (!section.question_duration?.hrs ||
                                                      section.question_duration?.hrs === '0') &&
                                                  (!section.question_duration?.min ||
                                                      section.question_duration?.min === '0');

                                              // Check if marks per question is provided
                                              const isMarksPerQuestionMissing =
                                                  section.marks_per_question === '0' ||
                                                  !section.marks_per_question
                                                      ? true
                                                      : false;

                                              // Check if the question paper is uploaded
                                              const isQuestionPaperMissing =
                                                  section.adaptive_marking_for_each_question
                                                      .length > 0
                                                      ? false
                                                      : true;
                                              if (examType === 'SURVEY')
                                                  return isQuestionPaperMissing;
                                              if (examType === 'PRACTICE') {
                                                  // Return true if any of the above conditions are true
                                                  return (
                                                      isQuestionPaperMissing ||
                                                      isMarksPerQuestionMissing
                                                  );
                                              }

                                              // Return true if any of the above conditions are true
                                              return (
                                                  isAssessmentDurationMissing ||
                                                  isQuestionPaperMissing ||
                                                  isSectionDurationMissing ||
                                                  isQuestionDurationMissing ||
                                                  isMarksPerQuestionMissing
                                              );
                                          })
                                        : false
                                }
                                onClick={handleSubmit(onSubmit, onInvalid)}
                            >
                                {assessmentId !== 'defaultId' ? t('header.update') : t('header.next')}
                                <ArrowRight
                                    size={18}
                                    weight="bold"
                                    className="transition-transform group-hover:translate-x-0.5"
                                />
                            </MyButton>
                        </div>
                        {nonMcqsCount > 0 && (
                            <div
                                role="alert"
                                className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700"
                            >
                                <WarningCircle size={18} className="mt-px shrink-0" />
                                <div>
                                    <p className="font-semibold">{t('omrWarning.title')}</p>
                                    <p>{t('omrWarning.body', { count: nonMcqsCount })}</p>
                                </div>
                            </div>
                        )}
                        {(examType === 'EXAM' || examType === 'MOCK') && (
                            <Card className="border-neutral-200/80 shadow-sm">
                                <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-4">
                                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                        <Timer size={18} weight="bold" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-subtitle font-semibold">
                                            {t('durationSettings.title')}
                                        </CardTitle>
                                        <CardDescription>
                                            {t('durationSettings.description')}
                                        </CardDescription>
                                    </div>
                                </CardHeader>
                                <CardContent id="duration-settings">
                                    {getStepKey({
                                        assessmentDetails,
                                        currentStep,
                                        key: 'duration_distribution',
                                    }) && (
                                        <FormField
                                            control={form.control}
                                            name="testDuration" // Use the parent key to handle both fields
                                            render={({ field }) => (
                                                <FormItem className="space-y-3">
                                                    <FormControl>
                                                        <RadioGroup
                                                            onValueChange={(value) => {
                                                                form.setValue(
                                                                    'testDuration.entireTestDuration.checked',
                                                                    value === 'ASSESSMENT'
                                                                );
                                                                form.setValue(
                                                                    'testDuration.sectionWiseDuration',
                                                                    value === 'SECTION'
                                                                );
                                                                form.setValue(
                                                                    'testDuration.questionWiseDuration',
                                                                    value === 'QUESTION'
                                                                );
                                                            }}
                                                            defaultValue={
                                                                field.value?.entireTestDuration?.checked
                                                                    ? 'ASSESSMENT'
                                                                    : field.value?.sectionWiseDuration
                                                                      ? 'SECTION'
                                                                      : 'QUESTION'
                                                            }
                                                            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                                                        >
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'ASSESSMENT',
                                                            }) && (
                                                                <FormItem className="space-y-0">
                                                                    <label
                                                                        className={cn(
                                                                            'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all hover:border-primary-300 hover:bg-primary-50/30',
                                                                            field.value
                                                                                ?.entireTestDuration
                                                                                ?.checked
                                                                                ? 'border-primary-500 bg-primary-50/60 shadow-sm ring-1 ring-primary-200'
                                                                                : 'border-neutral-200'
                                                                        )}
                                                                    >
                                                                        <FormControl>
                                                                            <RadioGroupItem value="ASSESSMENT" />
                                                                        </FormControl>
                                                                        <FormLabel className="flex-1 cursor-pointer text-sm font-medium text-neutral-700">
                                                                            {(examType as string) ===
                                                                            'SURVEY'
                                                                                ? t(
                                                                                      'durationSettings.options.entireSurvey'
                                                                                  )
                                                                                : t(
                                                                                      'durationSettings.options.entireAssessment'
                                                                                  )}
                                                                        </FormLabel>
                                                                    </label>
                                                                </FormItem>
                                                            )}
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'SECTION',
                                                            }) && (
                                                                <FormItem className="space-y-0">
                                                                    <label
                                                                        className={cn(
                                                                            'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all hover:border-primary-300 hover:bg-primary-50/30',
                                                                            field.value
                                                                                ?.sectionWiseDuration
                                                                                ? 'border-primary-500 bg-primary-50/60 shadow-sm ring-1 ring-primary-200'
                                                                                : 'border-neutral-200'
                                                                        )}
                                                                    >
                                                                        <FormControl>
                                                                            <RadioGroupItem value="SECTION" />
                                                                        </FormControl>
                                                                        <FormLabel className="flex-1 cursor-pointer text-sm font-medium text-neutral-700">
                                                                            {t(
                                                                                'durationSettings.options.sectionWise'
                                                                            )}
                                                                        </FormLabel>
                                                                    </label>
                                                                </FormItem>
                                                            )}
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'QUESTION',
                                                            }) && (
                                                                <FormItem className="space-y-0">
                                                                    <label
                                                                        className={cn(
                                                                            'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all hover:border-primary-300 hover:bg-primary-50/30',
                                                                            field.value
                                                                                ?.questionWiseDuration
                                                                                ? 'border-primary-500 bg-primary-50/60 shadow-sm ring-1 ring-primary-200'
                                                                                : 'border-neutral-200'
                                                                        )}
                                                                    >
                                                                        <FormControl>
                                                                            <RadioGroupItem value="QUESTION" />
                                                                        </FormControl>
                                                                        <FormLabel className="flex-1 cursor-pointer text-sm font-medium text-neutral-700">
                                                                            {t(
                                                                                'durationSettings.options.questionWise'
                                                                            )}
                                                                        </FormLabel>
                                                                    </label>
                                                                </FormItem>
                                                            )}
                                                        </RadioGroup>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                    {form.getValues('testDuration.entireTestDuration.checked') && (
                                        <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/40 px-4 py-3 text-sm text-neutral-600">
                                            {(examType as string) === 'SURVEY'
                                                ? t('durationSettings.info.entireTestSurvey')
                                                : t('durationSettings.info.entireTestAssessment')}
                                        </div>
                                    )}
                                    {form.getValues('testDuration.sectionWiseDuration') && (
                                        <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/40 px-4 py-3 text-sm text-neutral-600">
                                            {t('durationSettings.info.sectionWise')}
                                        </div>
                                    )}
                                    {form.getValues('testDuration.questionWiseDuration') && (
                                        <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50/40 px-4 py-3 text-sm text-neutral-600">
                                            {t('durationSettings.info.questionWise')}
                                        </div>
                                    )}
                                    {form.watch('testDuration')?.entireTestDuration?.checked &&
                                        getStepKey({
                                            assessmentDetails,
                                            currentStep,
                                            key: 'duration',
                                        }) && (
                                            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
                                                <div className="flex items-center gap-2 text-neutral-700">
                                                    <Clock
                                                        size={16}
                                                        weight="bold"
                                                        className="text-primary-500"
                                                    />
                                                    <span className="font-medium">
                                                        {t('durationSettings.entireTestDuration.label')}
                                                        {getStepKey({
                                                            assessmentDetails,
                                                            currentStep,
                                                            key: 'duration',
                                                        }) === 'REQUIRED' && (
                                                            <span className="ml-0.5 text-danger-600">
                                                                *
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm">
                                                <FormField
                                                    control={control}
                                                    name="testDuration.entireTestDuration.testDuration.hrs"
                                                    render={({ field: { ...field } }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <MyInput
                                                                    inputType="text" // Keep the input type as text
                                                                    inputPlaceholder={t(
                                                                        'durationSettings.entireTestDuration.placeholderZero'
                                                                    )}
                                                                    input={field.value}
                                                                    onKeyPress={(e) => {
                                                                        const charCode = e.key;
                                                                        if (
                                                                            !/[0-9]/.test(charCode)
                                                                        ) {
                                                                            e.preventDefault(); // Prevent non-numeric input
                                                                        }
                                                                    }}
                                                                    onChangeFunction={(e) => {
                                                                        const inputValue =
                                                                            e.target.value.replace(
                                                                                /[^0-9]/g,
                                                                                ''
                                                                            ); // Sanitize input
                                                                        field.onChange(inputValue); // Update field value
                                                                    }}
                                                                    error={
                                                                        form.formState.errors
                                                                            .testDuration
                                                                            ?.entireTestDuration
                                                                            ?.testDuration?.hrs
                                                                            ?.message
                                                                    }
                                                                    size="large"
                                                                    {...field}
                                                                    className="w-12 border-none text-center focus-visible:ring-0"
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span className="text-xs font-medium uppercase text-neutral-500">
                                                    {t('durationSettings.entireTestDuration.hrsUnit')}
                                                </span>
                                                <span className="text-neutral-300">:</span>
                                                <FormField
                                                    control={control}
                                                    name="testDuration.entireTestDuration.testDuration.min"
                                                    render={({ field: { ...field } }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <MyInput
                                                                    inputType="text"
                                                                    inputPlaceholder={t(
                                                                        'durationSettings.entireTestDuration.placeholderZero'
                                                                    )}
                                                                    input={field.value}
                                                                    onKeyPress={(e) => {
                                                                        const charCode = e.key;
                                                                        if (
                                                                            !/[0-9]/.test(charCode)
                                                                        ) {
                                                                            e.preventDefault(); // Prevent non-numeric input
                                                                        }
                                                                    }}
                                                                    onChangeFunction={(e) => {
                                                                        const inputValue =
                                                                            e.target.value.replace(
                                                                                /[^0-9]/g,
                                                                                ''
                                                                            ); // Remove non-numeric characters
                                                                        field.onChange(inputValue); // Call onChange with the sanitized value
                                                                    }}
                                                                    error={
                                                                        form.formState.errors
                                                                            .testDuration
                                                                            ?.entireTestDuration
                                                                            ?.testDuration?.min
                                                                            ?.message
                                                                    }
                                                                    size="large"
                                                                    {...field}
                                                                    className="w-12 border-none text-center focus-visible:ring-0"
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span className="pr-2 text-xs font-medium uppercase text-neutral-500">
                                                    {t('durationSettings.entireTestDuration.minUnit')}
                                                </span>
                                                </div>
                                            </div>
                                        )}
                                </CardContent>
                            </Card>
                        )}
                        <Accordion
                            type="single"
                            collapsible
                            defaultValue={`section-0`}
                            className="flex flex-col gap-4"
                        >
                            {sectionFields.map((sectionField, index) => (
                                <Step2SectionInfo
                                    key={sectionField.id}
                                    form={form}
                                    index={index}
                                    currentStep={currentStep}
                                    oldData={oldData}
                                    onDelete={remove}
                                />
                            ))}
                        </Accordion>
                    </>
                )}
                <button
                    type="button"
                    id="add-section"
                    onClick={handleAddSection}
                    className={cn(
                        'group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/40 px-4 py-4 text-sm font-medium text-neutral-500 transition-all hover:border-primary-400 hover:bg-primary-50/40 hover:text-primary-500',
                        allSections.length > 0 && 'mt-2'
                    )}
                >
                    <Plus
                        size={18}
                        weight="bold"
                        className="transition-transform group-hover:scale-110"
                    />
                    {t('addSectionButton')}
                </button>

                {/*
                 * Whole-assessment generation sits beside "Add Section" rather than inside
                 * a section, because it CREATES the sections: the plan decides how the
                 * paper is broken up. The per-section knowledge-base card inside each
                 * section is unchanged and still fills one section at a time.
                 */}
                <div className="mt-2">
                    <Step2CreateAssessmentFromKnowledgeBase form={form} />
                </div>
            </form>
        </FormProvider>
    );
};

export default Step2AddingQuestions;
