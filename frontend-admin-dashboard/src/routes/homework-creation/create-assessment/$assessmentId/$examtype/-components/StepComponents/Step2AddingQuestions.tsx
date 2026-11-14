import React, { useEffect, useRef } from 'react';
import { z } from 'zod';
import sectionDetailsSchema from '../../-utils/section-details-schema';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { MyButton } from '@/components/design-system/button';
import { Separator } from '@/components/ui/separator';
import { Plus } from '@phosphor-icons/react';
import { Accordion } from '@/components/ui/accordion';
import { StepContentProps } from '@/types/assessments/step-content-props';
import { getAssessmentDetails, handlePostStep2Data } from '../../-services/assessment-services';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSavedAssessmentStore } from '../../-utils/global-states';
import { zodResolver } from '@hookform/resolvers/zod';
import Step2SectionInfo from './Step2SectionInfo';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/report-api-error';
import { getFieldOptions, getStepKey, syncStep2DataWithStore } from '../../-utils/helper';
import { useSectionDetailsStore } from '../../-utils/zustand-global-states/step2-add-questions';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useParams } from '@tanstack/react-router';
import { useTestAccessStore } from '../../-utils/zustand-global-states/step3-adding-participants';
import { getSubjectNameById } from '@/routes/assessment/question-papers/-utils/helper';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyInput } from '@/components/design-system/input';
import useIntroJsTour, { Step } from '@/hooks/use-intro';
import { IntroKey } from '@/constants/storage/introKey';
import { createAssesmentSteps } from '@/constants/intro/steps';
import { useTranslation } from 'react-i18next';
type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const Step2AddingQuestions: React.FC<StepContentProps> = ({
    currentStep,
    handleCompleteCurrentStep,
    completedSteps,
}) => {
    const { t } = useTranslation('homeworkCreationStep2AddingQuestions');
    const queryClient = useQueryClient();
    const params = useParams({ strict: false });
    const examType = params.examtype ?? ''; // Ensure it's a string
    const assessmentId = params.assessmentId ?? ''; // Ensure it's string | null
    const storeDataStep2 = useSectionDetailsStore((state) => state);
    const { savedAssessmentId } = useSavedAssessmentStore();
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId !== 'defaultId' ? assessmentId : savedAssessmentId,
            instituteId: instituteDetails?.id,
            type: 'EXAM',
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
                    sectionName: t('defaultSectionName', { number: 1 }),
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
                toast.success(t('toast.updateSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
                queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            } else {
                syncStep2DataWithStore(form);
                toast.success(t('toast.saveSuccess'), {
                    className: 'success-toast',
                    duration: 2000,
                });
                handleCompleteCurrentStep();
                queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            }
        },
        onError: (error: unknown) => {
            reportApiError(error, {
                feature: 'homework-step2-add-questions',
                tags: { actionType: assessmentId !== 'defaultId' ? 'update' : 'create' },
                extra: { assessmentId, instituteId: instituteDetails?.id, examType },
                fallbackMessage: t('errors.saveQuestionsFailed'),
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

    const onInvalid = (err: unknown) => {
        console.log(err);
    };

    // The one owner of the section list: cards keyed by react-hook-form's
    // field id and deleted through this instance, so a card never keeps
    // showing a section that moved out from under its index (see the
    // assessment wizard's Step2AddingQuestions).
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

    const isAssessmentDurationMissing =
        isAssessWiseCheck &&
        (!entireTestDuration?.hrs || entireTestDuration?.hrs === '0') &&
        (!entireTestDuration?.min || entireTestDuration?.min === '0');

    const handleAddSection = () => {
        append({
            sectionId: '',
            sectionName: t('defaultSectionName', { number: allSections.length + 1 }),
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

    useEffect(() => {
        if (assessmentId !== 'defaultId') {
            const sections = assessmentDetails[currentStep]?.saved_data?.sections;
            const initialFormValues = {
                status: assessmentDetails[currentStep]?.status || 'INCOMPLETE',
                testDuration: {
                    entireTestDuration: {
                        checked:
                            assessmentDetails[currentStep]?.saved_data?.duration_distribution ===
                            'ASSESSMENT'
                                ? true
                                : false,
                        testDuration: {
                            hrs:
                                assessmentDetails[currentStep]?.saved_data
                                    ?.duration_distribution === 'ASSESSMENT' &&
                                assessmentDetails[currentStep]?.saved_data?.duration != null &&
                                (assessmentDetails[currentStep]?.saved_data?.duration ?? 0) > 0
                                    ? String(
                                          Math.floor(
                                              (assessmentDetails[currentStep]?.saved_data
                                                  ?.duration ?? 0) / 60
                                          )
                                      )
                                    : '',
                            min:
                                assessmentDetails[currentStep]?.saved_data
                                    ?.duration_distribution === 'ASSESSMENT' &&
                                assessmentDetails[currentStep]?.saved_data?.duration != null &&
                                (assessmentDetails[currentStep]?.saved_data?.duration ?? 0) > 0
                                    ? String(
                                          Math.floor(
                                              (assessmentDetails[currentStep]?.saved_data
                                                  ?.duration ?? 0) % 60
                                          )
                                      )
                                    : '',
                        },
                    },
                    sectionWiseDuration:
                        assessmentDetails[currentStep]?.saved_data?.duration_distribution ===
                        'SECTION'
                            ? true
                            : false, // Default to false
                    questionWiseDuration:
                        assessmentDetails[currentStep]?.saved_data?.duration_distribution ===
                        'QUESTION'
                            ? true
                            : false, // Default to false
                },
                section:
                    Array.isArray(sections) && sections.length > 0
                        ? sections.map((sectionDetails) => ({
                              sectionId: sectionDetails.id || '',
                              sectionName: sectionDetails.name || '',
                              questionPaperTitle: '',
                              uploaded_question_paper: '',
                              subject: getSubjectNameById(
                                  instituteDetails?.subjects || [],
                                  assessmentDetails[0]?.saved_data?.subject_selection ?? ''
                              ),
                              yearClass: '',
                              question_duration: {
                                  hrs: String(Math.floor(sectionDetails.duration / 60)) || '',
                                  min: String(sectionDetails.duration % 60) || '',
                              },
                              section_description: sectionDetails.description?.content || '',
                              section_duration: {
                                  hrs: String(Math.floor(sectionDetails.duration / 60)) || '',
                                  min: String(sectionDetails.duration % 60) || '',
                              },
                              marks_per_question: '',
                              total_marks: String(sectionDetails.total_marks) || '',
                              negative_marking: {
                                  checked: false,
                                  value: '',
                              },
                              partial_marking: false,
                              cutoff_marks: {
                                  checked: sectionDetails.cutoff_marks > 0 ? true : false,
                                  value: String(sectionDetails.cutoff_marks) || '',
                              },
                              problem_randomization:
                                  sectionDetails.problem_randomization === 'RANDOM' ? true : false,
                              adaptive_marking_for_each_question: [],
                          }))
                        : [
                              {
                                  sectionId: '',
                                  sectionName: t('defaultSectionName', { number: 1 }),
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
                              },
                          ],
            };

            // Set initial form values
            form.reset(initialFormValues);

            // Store initial data in oldData
            oldData.current = initialFormValues;
        }
    }, [assessmentDetails, assessmentId]);

    useIntroJsTour({
        key: IntroKey.assessmentStep2Questions,
        steps: createAssesmentSteps
            .filter((step) => step.element === '#add-question') // design-lint-ignore: DOM id selector for intro.js targeting, not a color literal
            .flatMap((step) => step.subStep || [])
            .filter((subStep): subStep is Step => subStep !== undefined),
    });

    if (isLoading || handleSubmitStep2Form.status === 'pending') return <DashboardLoader />;

    return (
        <FormProvider {...form}>
            <form>
                {allSections.length > 0 && (
                    <>
                        <div className="m-0 flex items-center justify-between p-0">
                            <h1>{t('heading')}</h1>
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
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
                                              if (examType === 'SURVEY') return false;

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
                                {assessmentId !== 'defaultId' ? t('actions.update') : t('actions.next')}
                            </MyButton>
                        </div>
                        {examType !== 'SURVEY' && (
                            <>
                                <Separator className="my-4" />
                                <div id="duration-settings">
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
                                                            className="flex items-start gap-6"
                                                        >
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'ASSESSMENT',
                                                            }) && (
                                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                                    <FormControl>
                                                                        <RadioGroupItem value="ASSESSMENT" />
                                                                    </FormControl>
                                                                    <FormLabel className="font-thin">
                                                                        {t(
                                                                            'durationDistribution.entireAssessmentLabel'
                                                                        )}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )}
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'SECTION',
                                                            }) && (
                                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                                    <FormControl>
                                                                        <RadioGroupItem value="SECTION" />
                                                                    </FormControl>
                                                                    <FormLabel className="font-thin">
                                                                        {t(
                                                                            'durationDistribution.sectionWiseLabel'
                                                                        )}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )}
                                                            {getFieldOptions({
                                                                assessmentDetails,
                                                                currentStep,
                                                                key: 'duration_distribution',
                                                                value: 'QUESTION',
                                                            }) && (
                                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                                    <FormControl>
                                                                        <RadioGroupItem value="QUESTION" />
                                                                    </FormControl>
                                                                    <FormLabel className="font-thin">
                                                                        {t(
                                                                            'durationDistribution.questionWiseLabel'
                                                                        )}
                                                                    </FormLabel>
                                                                </FormItem>
                                                            )}
                                                        </RadioGroup>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                    {form.getValues('testDuration.entireTestDuration.checked') && (
                                        <div className="mt-3 text-sm">
                                            <p>
                                                {t('durationDistribution.entireAssessmentHeading')} –{' '}
                                                <span className="font-light">
                                                    {t(
                                                        'durationDistribution.entireAssessmentDescription'
                                                    )}
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                    {form.getValues('testDuration.sectionWiseDuration') && (
                                        <div className="mt-3 text-sm">
                                            <p>
                                                {t('durationDistribution.sectionWiseHeading')} –{' '}
                                                <span className="font-light">
                                                    {t(
                                                        'durationDistribution.sectionWiseDescription'
                                                    )}
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                    {form.getValues('testDuration.questionWiseDuration') && (
                                        <div className="mt-3 text-sm">
                                            <p>
                                                {t('durationDistribution.questionWiseHeading')} –{' '}
                                                <span className="font-light">
                                                    {t(
                                                        'durationDistribution.questionWiseDescription'
                                                    )}
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                    {form.watch('testDuration')?.entireTestDuration?.checked &&
                                        getStepKey({
                                            assessmentDetails,
                                            currentStep,
                                            key: 'duration',
                                        }) && (
                                            <div className="mt-4 flex items-center gap-4 text-sm font-thin">
                                                <h1>
                                                    {t('durationDistribution.entireTestDurationLabel')}
                                                    {getStepKey({
                                                        assessmentDetails,
                                                        currentStep,
                                                        key: 'duration',
                                                    }) === 'REQUIRED' && (
                                                        <span className="text-subtitle text-danger-600">
                                                            *
                                                        </span>
                                                    )}
                                                </h1>
                                                <FormField
                                                    control={control}
                                                    name="testDuration.entireTestDuration.testDuration.hrs"
                                                    render={({ field: { ...field } }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <MyInput
                                                                    inputType="text" // Keep the input type as text
                                                                    inputPlaceholder="00"
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
                                                                    className="w-11"
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span>{t('durationDistribution.hrs')}</span>
                                                <span>:</span>
                                                <FormField
                                                    control={control}
                                                    name="testDuration.entireTestDuration.testDuration.min"
                                                    render={({ field: { ...field } }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <MyInput
                                                                    inputType="text"
                                                                    inputPlaceholder="00"
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
                                                                    className="w-11"
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span>{t('durationDistribution.minutes')}</span>
                                            </div>
                                        )}
                                </div>
                            </>
                        )}
                        <Separator className="my-4" />
                        <Accordion type="single" collapsible defaultValue={`section-0`}>
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
                <MyButton
                    type="button"
                    scale="large"
                    buttonType="secondary"
                    id="add-section"
                    className={`${allSections.length > 0 ? 'mt-8' : ''} font-thin`}
                    onClick={handleAddSection}
                >
                    <Plus size={32} />
                    {t('actions.addSection')}
                </MyButton>
            </form>
        </FormProvider>
    );
};

export default Step2AddingQuestions;
