import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadQuestionPaperFormSchema } from '../-utils/upload-question-paper-form-schema';
import { z } from 'zod';
import { FormProvider, useForm, UseFormReturn } from 'react-hook-form';
import SelectField from '@/components/design-system/select-field';
import { UploadFileBg } from '@/svgs';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { File, X, CircleNotch } from '@phosphor-icons/react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { QuestionPaperTemplate } from './QuestionPaperTemplate';
import CustomInput from '@/components/design-system/custom-input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadDocsFile } from '../-services/question-paper-services';
import { toast } from 'sonner';
import { describeMerge, mergeSectionQuestions } from '../-utils/merge-section-questions';
import { calculateTotalMarks } from '../../create-assessment/$assessmentId/$examtype/-utils/helper';
import { addQuestionPaper, getQuestionPaperById } from '../-utils/question-paper-services';
import {
    MyQuestion,
    MyQuestionPaperFormInterface,
} from '../../../../types/assessments/question-paper-form';
import {
    getIdByLevelName,
    getIdBySubjectName,
    transformResponseDataToMyQuestionsSchema,
} from '../-utils/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useFilterDataForAssesment } from '../../assessment-list/-utils.ts/useFiltersData';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import useDialogStore from '../-global-states/question-paper-dialogue-close';
import sectionDetailsSchema from '../../create-assessment/$assessmentId/$examtype/-utils/section-details-schema';
import { zodResolver } from '@hookform/resolvers/zod';
import ConvertToHTML from '../-images/convertToHTML.png';
import { AssignmentFormType } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-form-schemas/assignmentFormSchema';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { useNamingSettings } from '@/hooks/useNamingSettings';
import {
    validateUploadedQuestions,
    filterQuestionsBySkipSet,
    QuestionIssue,
} from '../-utils/validate-uploaded-questions';
import { UploadDiagnosticsDialog } from './UploadDiagnosticsDialog';

export type SectionFormType = z.infer<typeof sectionDetailsSchema>;
export type UploadQuestionPaperFormType = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;
interface QuestionPaperUploadProps {
    isManualCreated: boolean;
    index?: number;
    sectionsForm?: UseFormReturn<SectionFormType>;
    studyLibraryAssignmentForm?: UseFormReturn<AssignmentFormType>;
    isStudyLibraryAssignment?: boolean;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    examType?: string;
    defaultSubject?: string;
}

// Helper hook for form management
export const useQuestionPaperForm = (examType: string) => {
    return useForm<UploadQuestionPaperFormType>({
        resolver: zodResolver(uploadQuestionPaperFormSchema(examType)),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '1',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            // BE hardcodes these markers; values kept here only to satisfy the form schema.
            questionsType: '(1.)',
            optionsType: '(a.)',
            answersType: 'Ans:',
            explanationsType: 'Exp:',
            fileUpload: undefined,
            questions: [],
        },
        });
    };

// Helper hook for form validation
const useFormValidation = (form: any) => {
    const title = form.getValues('title');
    const yearClass = form.getValues('yearClass');
    const subject = form.getValues('subject');
    const fileUpload = form.getValues('fileUpload');
    const questions = form.getValues('questions');

    return {
        isFormValidWhenManuallyCreated: !!title,
        isFormValidWhenUploaded: !!title && !!fileUpload,
        hasQuestions: questions.length > 0,
    };
};

// Helper component for file upload section
const FileUploadSection = ({
    form,
    fileInputRef,
    onFileSubmit,
    onFileSelect,
    onRemoveFile,
    uploadProgress,
    isProgress,
}: {
    form: any;
    fileInputRef: React.RefObject<HTMLInputElement>;
    onFileSubmit: (file: File) => void;
    onFileSelect: () => void;
    onRemoveFile: () => void;
    uploadProgress: number;
    isProgress: boolean;
}) => {
    const { t } = useTranslation('assessmentQuestionPaperUpload');
    const fileUpload = form.getValues('fileUpload');
    const isProcessingOnServer = isProgress && uploadProgress >= 99;

    return (
        <>
            <div className="ml-4 rounded-lg border border-primary-100 bg-primary-50/40 p-4">
                <p className="mb-2 text-sm font-semibold text-primary-500">
                    {t('formatGuide.title')}
                </p>
                <p className="mb-3 text-xs text-neutral-600">{t('formatGuide.description')}</p>
                <ul className="space-y-1.5 text-xs text-neutral-700">
                    <li className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">
                            {t('formatGuide.questionLabel')}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                            (1.) Your question text…
                        </code>
                    </li>
                    <li className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">
                            {t('formatGuide.optionsLabel')}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                            (a.) … &nbsp;(b.) … &nbsp;(c.) … &nbsp;(d.) …
                        </code>
                    </li>
                    <li className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">
                            {t('formatGuide.answerLabel')}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                            Ans: A
                        </code>
                        <span className="text-neutral-500">{t('formatGuide.answerHint')}</span>
                    </li>
                    <li className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">
                            {t('formatGuide.explanationLabel')}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                            Exp: Your explanation…
                        </code>
                    </li>
                    <li className="flex gap-2">
                        <span className="w-24 shrink-0 font-medium">
                            {t('formatGuide.tagsLabel')}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                            Tags: Algebra, Trigonometry
                        </code>
                        <span className="text-neutral-500">{t('formatGuide.tagsHint')}</span>
                    </li>
                </ul>
                <p className="mt-3 text-xs text-neutral-500">
                    {t('formatGuide.variationsPart1')}{' '}
                    <code className="font-mono">1.)</code>,{' '}
                    <code className="font-mono">(A)</code> {t('formatGuide.variationsPart2')}{' '}
                    <code className="font-mono">Tag:</code> {t('formatGuide.variationsPart3')}
                </p>
            </div>

                                    <div className="flex flex-col gap-6">
                                        <div
                                            className="flex w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dotted border-primary-500 p-4"
                    onClick={onFileSelect}
                                        >
                                            <UploadFileBg className="mb-3" />
                                            <FileUploadComponent
                                                fileInputRef={fileInputRef}
                        onFileSubmit={onFileSubmit}
                                                control={form.control}
                                                name="fileUpload"
                                            />
                                        </div>
                                        <h1 className="-mt-4 text-xs text-red-500">
                                            {t('docxHelp.part1')}{' '}
                                            <a
                                                href="https://wordtohtml.net/convert/docx-to-html"
                                                target="_blank"
                                                className="text-blue-500"
                                                rel="noreferrer"
                                            >
                                                {t('docxHelp.linkText')}
                                            </a>{' '}
                                            {t('docxHelp.part2')}
                                        </h1>
                                    </div>

                                    <div className="flex flex-col gap-6">
                <h1 className="-mt-4 text-xs text-red-500">{t('docxHelp.step1')}</h1>
                <h1 className="-mt-4 text-xs text-red-500">{t('docxHelp.step2')}</h1>
                <h1 className="-mt-4 text-xs text-red-500">{t('docxHelp.step3')}</h1>
                                        <img src={ConvertToHTML} alt={t('docxHelp.imageAlt')} />
                                    </div>

            {fileUpload && (
                                        <div className="flex w-full items-center gap-2 rounded-md bg-neutral-100 p-2">
                                            <div className="rounded-md bg-primary-100 p-2">
                                                <File
                                                    size={32}
                                                    fillOpacity={1}
                                                    weight="fill"
                                                    className="text-primary-500"
                                                />
                                            </div>
                                            <div className="flex w-full flex-col">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="break-all text-sm font-bold">
                                {fileUpload?.name}
                                                    </p>
                                                    <X
                                                        size={16}
                                                        className={`mt-0.5 ${isProgress ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                                                        onClick={() => {
                                                            if (!isProgress) onRemoveFile();
                                                        }}
                                                    />
                                                </div>

                                                <p className="my-1 whitespace-normal text-xs">
                                                    {(
                                (((fileUpload?.size || 0) / (1024 * 1024)) * uploadProgress) /
                                                        100
                                                    ).toFixed(2)}{' '}
                                                    MB /{' '}
                            {((fileUpload?.size || 0) / (1024 * 1024)).toFixed(2)}
                                                    &nbsp;MB
                                                </p>

                                                <div className="flex items-center gap-2">
                                                    <Progress
                                                        value={uploadProgress}
                                                        className="w-full bg-primary-500"
                                                    />
                                                    {isProcessingOnServer ? (
                                                        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-primary-500">
                                                            <CircleNotch
                                                                size={14}
                                                                className="animate-spin"
                                                            />
                                                            {t('upload.processing')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs">
                                                            {uploadProgress}%
                                                        </span>
                                                    )}
                                                </div>
                                                {isProcessingOnServer && (
                                                    <p className="mt-1 text-xs text-neutral-500">
                                                        {t('upload.processingHint')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
    );
};

// Helper component for basic form fields
export const BasicFormFields = ({ form, YearClassFilterData, SubjectFilterData, defaultSubject }: {
    form: any;
    YearClassFilterData: any[];
    SubjectFilterData: any[];
    defaultSubject?: string;
}) => {
    const { getTerminology } = useNamingSettings();
    const { t } = useTranslation('assessmentQuestionPaperUpload');

    return (
        <>
                            <CustomInput
                                control={form.control}
                                name="title"
                                label={t('fields.titleLabel')}
                                placeholder={t('fields.titlePlaceholder')}
                                required
                            />
                            {!defaultSubject && (
                                <div className="flex items-center gap-4">
                                    <SelectField
                                        label={getTerminology('Level', 'Year/Class')}
                                        name="yearClass"
                                        options={YearClassFilterData.map((option, index) => ({
                                            value: option.name,
                                            label: convertCapitalToTitleCase(option.name),
                                            _id: index,
                                        }))}
                                        control={form.control}
                                        className="!w-full"
                                    />
                                    <SelectField
                                        label={getTerminology('Subject', 'Subject')}
                                        name="subject"
                                        options={SubjectFilterData.map((option, index) => ({
                                            value: option.name,
                                            label: convertCapitalToTitleCase(option.name),
                                            _id: index,
                                        }))}
                                        control={form.control}
                                        className="!w-full"
                                    />
                                </div>
                            )}
        </>
    );
};

// Helper component for action buttons
const ActionButtons = ({
    isProgress,
    isManualCreated,
    fileUpload,
    formValidation,
    questionPaperId,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType,
    form
}: {
    isProgress: boolean;
    isManualCreated: boolean;
    fileUpload: any;
    formValidation: any;
    questionPaperId: string;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: (index: number) => void;
    examType: string;
    form: any;
}) => {
    const { t } = useTranslation('assessmentQuestionPaperUpload');
    return (
                            <div className="flex justify-between">
                                {isProgress ? (
            <Button type="button" variant="outline" className="w-52 border-2">
                                        {t('buttons.loading')}
                                    </Button>
                                ) : (
                                    !isManualCreated &&
                                    fileUpload && (
                                        <QuestionPaperTemplate
                                            form={form}
                                            questionPaperId={questionPaperId}
                                            isViewMode={false}
                                            buttonText={t('buttons.preview')}
                                            currentQuestionIndex={currentQuestionIndex}
                                            setCurrentQuestionIndex={(value: number | ((prevState: number) => number)) => {
                                                if (typeof value === 'function') {
                                                    setCurrentQuestionIndex(value(currentQuestionIndex));
                                                } else {
                                                    setCurrentQuestionIndex(value);
                                                }
                                            }}
                                            examType={examType}
                                        />
                                    )
                                )}

                                {isManualCreated && (
                                    <QuestionPaperTemplate
                                        form={form}
                                        questionPaperId={questionPaperId}
                                        isViewMode={false}
                                        isManualCreated={isManualCreated}
                                        buttonText={t('buttons.addQuestions')}
                                        currentQuestionIndex={currentQuestionIndex}
                                        setCurrentQuestionIndex={(value: number | ((prevState: number) => number)) => {
                                            if (typeof value === 'function') {
                                                setCurrentQuestionIndex(value(currentQuestionIndex));
                                            } else {
                                                setCurrentQuestionIndex(value);
                                            }
                                        }}
                                        examType={examType}
                                    />
                                )}

                                {fileUpload && (
                                    <Button
                                        disabled={
                                            isManualCreated
                        ? !formValidation.isFormValidWhenManuallyCreated
                        : !formValidation.isFormValidWhenUploaded
                                        }
                                        type="submit"
                                        className="ml-7 w-56 bg-primary-500 text-white"
                                    >
                                        {t('buttons.done')}
                                    </Button>
                                )}

                                {!fileUpload && !isManualCreated && (
                                    <Button
                                        disabled={
                                            isManualCreated
                        ? !formValidation.isFormValidWhenManuallyCreated
                        : !formValidation.isFormValidWhenUploaded
                                        }
                                        type="submit"
                className="w-56 bg-primary-500 text-white"
                                    >
                                        {t('buttons.done')}
                                    </Button>
                                )}

                                {!fileUpload && isManualCreated && (
                                    <Button
                                        disabled={
                                            isManualCreated
                        ? !formValidation.isFormValidWhenManuallyCreated
                        : !formValidation.isFormValidWhenUploaded
                                        }
                                        type="submit"
                                        className={`w-56 bg-primary-500 text-white ${
                    formValidation.hasQuestions ? 'block' : 'hidden'
                                        }`}
                                    >
                                        {t('buttons.done')}
                                    </Button>
                                )}
                            </div>
    );
};

export const QuestionPaperUpload = ({
    isManualCreated,
    index,
    sectionsForm,
    studyLibraryAssignmentForm,
    isStudyLibraryAssignment,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType = 'EXAM',
    defaultSubject,
}: QuestionPaperUploadProps) => {
    const { t } = useTranslation('assessmentQuestionPaperUpload');
    const queryClient = useQueryClient();
    const { instituteDetails } = useInstituteDetailsStore();
    const { YearClassFilterData, SubjectFilterData } = useFilterDataForAssesment(instituteDetails);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    /**
     * What the section already held when this dialog opened.
     *
     * Both write paths below (the preview mirror and the post-save write) used to
     * REPLACE the section's questions, so uploading a document into a section that
     * already had questions silently discarded them. They cannot simply append either:
     * the preview mirror re-runs every time the user skips or keeps a flagged question,
     * and appending there would duplicate the whole set each time.
     *
     * Capturing the pre-existing questions once and always writing baseline + current
     * makes both paths idempotent AND non-destructive.
     */
    const sectionBaselineRef = useRef<MyQuestion[] | null>(null);
    const getSectionBaseline = (): MyQuestion[] => {
        if (sectionBaselineRef.current === null) {
            sectionBaselineRef.current =
                index !== undefined
                    ? ((sectionsForm?.getValues(
                          `section.${index}.adaptive_marking_for_each_question`
                      ) ?? []) as unknown as MyQuestion[])
                    : [];
        }
        return sectionBaselineRef.current;
    };


    const form = useQuestionPaperForm(examType);
    const { getValues, setValue, watch } = form;

    // Auto-fill subject from parent assessment context
    useEffect(() => {
        if (defaultSubject) {
            setValue('subject', defaultSubject);
        }
    }, [defaultSubject, setValue]);

    const formValidation = useFormValidation(form);

    const questionPaperId = getValues('questionPaperId') || 'default';
    const questionIdentifier = getValues('questionsType');
    const optionIdentifier = getValues('optionsType');
    const answerIdentifier = getValues('answersType');
    const explanationIdentifier = getValues('explanationsType');
    const fileUpload = getValues('fileUpload');
    watch('fileUpload');

    const [uploadProgress, setUploadProgress] = useState(0);
    const [isProgress, setIsProgress] = useState(false);
    const [isFormSubmitting, setIsFormSubmitting] = useState(false);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [pendingQuestions, setPendingQuestions] = useState<MyQuestion[]>([]);
    const [pendingIssues, setPendingIssues] = useState<QuestionIssue[]>([]);
    const {
        setIsMainQuestionPaperAddDialogOpen,
        setIsManualQuestionPaperDialogOpen,
        setIsUploadFromDeviceDialogOpen,
    } = useDialogStore();

    // Mutation for form submission
    const handleSubmitFormData = useMutation({
        mutationFn: ({ data }: { data: MyQuestionPaperFormInterface }) => addQuestionPaper(data),
        onMutate: () => setIsFormSubmitting(true),
        onSettled: () => setIsFormSubmitting(false),
        onSuccess: async (data) => {
            const getQuestionPaper = await getQuestionPaperById(data.saved_question_paper_id);
            const transformQuestionsData: MyQuestion[] = transformResponseDataToMyQuestionsSchema(
                getQuestionPaper.question_dtolist
            );
            setCurrentQuestionIndex(0);
            toast.success(t('toasts.questionPaperAdded'), {
                className: 'success-toast',
                duration: 2000,
            });

            if (isStudyLibraryAssignment) {
                studyLibraryAssignmentForm?.setValue('uploaded_question_paper', data.saved_question_paper_id);
                studyLibraryAssignmentForm?.setValue(
                    `adaptive_marking_for_each_question`,
                    transformQuestionsData.map((question) => {
                        // Extract options based on question type
                        let rawOptions: { id?: string; name?: string }[] = [];
                        if (question.questionType === 'MCQS' || question.questionType === 'CMCQS') {
                            rawOptions = question.singleChoiceOptions || question.csingleChoiceOptions || [];
                        } else if (question.questionType === 'MCQM' || question.questionType === 'CMCQM') {
                            rawOptions = question.multipleChoiceOptions || question.cmultipleChoiceOptions || [];
                        } else if (question.questionType === 'TRUE_FALSE') {
                            rawOptions = question.trueFalseOptions || [];
                        }
                        return {
                            questionId: question.questionId,
                            questionName: question.questionName,
                            questionType: question.questionType,
                            newQuestion: true,
                            options: rawOptions
                                .filter((opt) => opt.id || opt.name)
                                .map((opt) => ({
                                    id: opt.id || '',
                                    text: { content: opt.name || '' },
                                })),
                        };
                    })
                );
            }

            if (index !== undefined) {
                const incoming = transformQuestionsData.map((question) => ({
                    questionId: question.questionId,
                    questionName: question.questionName,
                    questionType: question.questionType,
                    questionMark: question.questionMark,
                    questionPenalty: question.questionPenalty,
                    ...(question.questionType === 'MCQM' && {
                        correctOptionIdsCnt: question?.multipleChoiceOptions?.filter(
                            (item) => item.isSelected
                        ).length,
                    }),
                    questionDuration: {
                        hrs: question.questionDuration.hrs,
                        min: question.questionDuration.min,
                    },
                    parentRichText: question.parentRichTextContent,
                }));
                // Written against the baseline, not the section's current value, so this
                // supersedes whatever the preview mirror put there without duplicating it.
                const mergeResult = mergeSectionQuestions(
                    getSectionBaseline() as unknown as typeof incoming,
                    incoming
                );
                sectionsForm?.setValue(
                    `section.${index}.adaptive_marking_for_each_question`,
                    mergeResult.merged
                );
                sectionsForm?.setValue(
                    `section.${index}.total_marks`,
                    String(calculateTotalMarks(mergeResult.merged))
                );
                sectionsForm?.trigger(`section.${index}.adaptive_marking_for_each_question`);
                toast.success(describeMerge(mergeResult));
            }

            setIsMainQuestionPaperAddDialogOpen(false);
            setIsManualQuestionPaperDialogOpen(false);
            setIsUploadFromDeviceDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTION_PAPER_FILTERED_DATA'] });
        },
        onError: (error: unknown) => {
            toast.error(error as string);
        },
    });

    // Mutation for file upload
    const addDocsFileMutation = useMutation({
        mutationFn: ({
            questionIdentifier,
            optionIdentifier,
            answerIdentifier,
            explanationIdentifier,
            file,
            setUploadProgress,
        }: {
            questionIdentifier: string;
            optionIdentifier: string;
            answerIdentifier: string;
            explanationIdentifier: string;
            file: File;
            setUploadProgress: React.Dispatch<React.SetStateAction<number>>;
        }) =>
            uploadDocsFile(
                questionIdentifier,
                optionIdentifier,
                answerIdentifier,
                explanationIdentifier,
                file,
                setUploadProgress
            ),
        onMutate: () => setIsProgress(true),
        onSettled: () => setIsProgress(false),
        onSuccess: async (data) => {
            const transformQuestionsData = transformResponseDataToMyQuestionsSchema(data);
            const issues = validateUploadedQuestions(transformQuestionsData, examType);

            if (issues.length === 0) {
                commitQuestions(transformQuestionsData);
                return;
            }

            setPendingQuestions(transformQuestionsData);
            setPendingIssues(issues);
            setDiagnosticsOpen(true);
        },
        onError: (error: unknown) => {
            toast.error(error as string);
        },
    });

    const onSubmit = (values: z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>) => {
        const getIdYearClass = getIdByLevelName(instituteDetails?.levels || [], values.yearClass);
        const getIdSubject = getIdBySubjectName(instituteDetails?.subjects || [], values.subject);

        if (index !== undefined) {
            const currentSection = sectionsForm?.getValues(`section.${index}`);

            const newSectionName = currentSection?.sectionName &&
                           currentSection.sectionName !== 'N/A' &&
                           currentSection.sectionName !== '' &&
                           !currentSection.sectionName.startsWith('Section ')
                    ? currentSection.sectionName
                    : ((values.subject && values.subject !== 'N/A') ? values.subject : currentSection?.sectionName) || `Section ${index + 1}`;

            sectionsForm?.setValue(`section.${index}`, {
                ...currentSection,
                sectionId: currentSection?.sectionId || '',
                uploaded_question_paper: currentSection?.uploaded_question_paper || null,
                question_duration: currentSection?.question_duration || { min: '0', hrs: '0' },
                section_description: currentSection?.section_description || '',
                section_duration: currentSection?.section_duration || { min: '0', hrs: '0' },
                marks_per_question: currentSection?.marks_per_question || '',
                negative_marking: currentSection?.negative_marking || { value: '', checked: false },
                total_marks: currentSection?.total_marks || '',
                partial_marking: currentSection?.partial_marking || false,
                cutoff_marks: currentSection?.cutoff_marks || { value: '', checked: false },
                problem_randomization: currentSection?.problem_randomization || false,
                adaptive_marking_for_each_question: currentSection?.adaptive_marking_for_each_question || [],
                questionPaperTitle: values.title,
                subject: values.subject || '',
                yearClass: values.yearClass || '',
                sectionName: newSectionName,
            });
        }

        handleSubmitFormData.mutate({
            data: {
                ...values,
                yearClass: getIdYearClass,
                subject: getIdSubject,
            } as MyQuestionPaperFormInterface,
        });
    };

    const onInvalid = (err: unknown) => {
        console.error(err);
        toast.error(t('toasts.incompleteQuestions'), {
            className: 'error-toast',
            duration: 3000,
        });
    };

    const handleFileSubmit = (file: File) => {
        setValue('fileUpload', file);
        addDocsFileMutation.mutate({
            questionIdentifier,
            optionIdentifier,
            answerIdentifier,
            explanationIdentifier,
            file,
            setUploadProgress,
        });
    };

    const handleFileSelect = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleRemoveQuestionPaper = () => {
        setValue('fileUpload', null as unknown as File);
        setValue('questions', []);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const commitQuestions = (questionsToCommit: MyQuestion[]) => {
        setValue('questions', questionsToCommit);

        if (index !== undefined) {
            const incoming = questionsToCommit.map((question) => ({
                questionId: question.questionId,
                questionName: question.questionName,
                questionType: question.questionType,
                questionMark: question.questionMark,
                questionPenalty: question.questionPenalty,
                questionDuration: {
                    hrs: question.questionDuration.hrs,
                    min: question.questionDuration.min,
                },
                decimals: question.decimals,
                numericType: question.numericType,
                validAnswers: question.validAnswers,
                parentRichText: question.parentRichTextContent,
                subjectiveAnswerText: question.subjectiveAnswerText,
            }));
            sectionsForm?.setValue(`section.${index}`, {
                ...sectionsForm?.getValues(`section.${index}`),
                // baseline + this dialog's working set. Re-running (skip / keep-all)
                // replaces the working set rather than stacking another copy of it.
                adaptive_marking_for_each_question: mergeSectionQuestions(
                    getSectionBaseline() as unknown as typeof incoming,
                    incoming
                ).merged,
            });
        }
        form.trigger('questions');
    };

    const handleDiagnosticsSkipAndProceed = (skipIndices: Set<number>) => {
        const kept = filterQuestionsBySkipSet(pendingQuestions, skipIndices);
        const skipped = pendingQuestions.length - kept.length;
        commitQuestions(kept);
        setDiagnosticsOpen(false);
        setPendingQuestions([]);
        setPendingIssues([]);
        if (skipped > 0) {
            toast.success(
                t('toasts.addedAndSkipped', { count: kept.length, skipped }),
                { duration: 3500 }
            );
        }
    };

    const handleDiagnosticsKeepAll = () => {
        commitQuestions(pendingQuestions);
        setDiagnosticsOpen(false);
        const total = pendingQuestions.length;
        const flagged = new Set(pendingIssues.map((i) => i.questionIndex)).size;
        setPendingQuestions([]);
        setPendingIssues([]);
        toast.info(
            t('toasts.loadedAll', { count: total, flagged }),
            { duration: 4000 }
        );
    };

    const handleDiagnosticsCancel = () => {
        setDiagnosticsOpen(false);
        setPendingQuestions([]);
        setPendingIssues([]);
        handleRemoveQuestionPaper();
    };

    return (
        <>
            <FormProvider {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit, onInvalid)}
                    className={/* design-lint-ignore: viewport-relative scroll cap, no token equivalent */ 'no-scrollbar max-h-[60vh] space-y-8 overflow-y-auto p-4 pt-2'}
                >
                    {!isFormSubmitting ? (
                        <>
                            {!isManualCreated && (
                                <FileUploadSection
                                    form={form}
                                    fileInputRef={fileInputRef}
                                    onFileSubmit={handleFileSubmit}
                                    onFileSelect={handleFileSelect}
                                    onRemoveFile={handleRemoveQuestionPaper}
                                    uploadProgress={uploadProgress}
                                    isProgress={isProgress}
                                />
                            )}

                            <BasicFormFields
                                form={form}
                                YearClassFilterData={YearClassFilterData}
                                SubjectFilterData={SubjectFilterData}
                                defaultSubject={defaultSubject}
                            />

                            <ActionButtons
                                isProgress={isProgress}
                                isManualCreated={isManualCreated}
                                fileUpload={fileUpload}
                                formValidation={formValidation}
                                questionPaperId={questionPaperId}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                examType={examType}
                                form={form}
                            />
                        </>
                    ) : (
                        <DashboardLoader />
                    )}
                </form>
            </FormProvider>
            <UploadDiagnosticsDialog
                open={diagnosticsOpen}
                onOpenChange={(open) => {
                    if (!open) handleDiagnosticsCancel();
                }}
                issues={pendingIssues}
                totalQuestions={pendingQuestions.length}
                onSkipAndProceed={handleDiagnosticsSkipAndProceed}
                onKeepAllAndEdit={handleDiagnosticsKeepAll}
                onCancel={handleDiagnosticsCancel}
            />
        </>
    );
};
