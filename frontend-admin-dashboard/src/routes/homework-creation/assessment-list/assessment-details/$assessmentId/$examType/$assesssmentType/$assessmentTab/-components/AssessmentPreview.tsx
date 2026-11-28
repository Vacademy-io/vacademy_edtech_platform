import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Route } from '..';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
    handlePostAssessmentPreview,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import {
    copyToClipboard,
    handleDownloadQRCode,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import { Copy, DotsSixVertical, DownloadSimple, SpeakerLow } from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    addQuestionIdToSections,
    compareAndUpdateSections,
    extractEmptyIdQuestions,
    getSectionsWithEmptyQuestionIds,
    handleAddedQuestionsToSections,
    mergeSectionData,
    // announcementDialogTrigger,
    transformPreviewDataToSections,
    transformSectionQuestions,
    transformSectionsAndQuestionsData,
} from '../-utils/helper';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { buildSectionsEditQuestionFormSchema } from '../-utils/sections-edit-question-form-schema';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { Separator } from '@/components/ui/separator';
import { MainViewComponentFactory } from './QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { PPTComponentFactory } from './QuestionPaperTemplatesTypes/PPTComponentFactory';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DotOutline } from '@phosphor-icons/react';
import AnnouncementComponent from './AnnouncementComponent';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { savePrivateQuestions } from '../-services/assessment-details-services';
import { AssessmentDetailQuestions } from '../-utils/assessment-details-interface';
import { transformResponseDataToMyQuestionsSchema } from '@/routes/assessment/question-papers/-utils/helper';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { getAssessmentJoinUrl } from '@/lib/learner-portal-url';
import { useTranslation } from 'react-i18next';

interface Announcement {
    id: string;
    title: string;
    instructions: string | undefined;
}

export type sectionsEditQuestionFormType = z.infer<
    ReturnType<typeof buildSectionsEditQuestionFormSchema>
>;
const AssessmentPreview = ({ handleCloseDialog }: { handleCloseDialog: () => void }) => {
    const { t } = useTranslation([
        'homeworkCreationAssessmentPreview',
        'homeworkCreationSectionsEditQuestionFormSchema',
    ]);
    const sectionsEditQuestionFormSchema = buildSectionsEditQuestionFormSchema(t);
    const queryClient = useQueryClient();
    const { assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    // Institute's own learner domain — a learner.vacademy.io link leaks Vacademy
    // branding in the URL itself and in its WhatsApp link preview.
    const joinUrl = getAssessmentJoinUrl(
        assessmentDetails[0]?.saved_data.assessment_url,
        instituteDetails?.learner_portal_base_url
    );
    const [announcementList, setAnnouncementList] = useState<Announcement[]>([]);
    const [currentQuestionIndexes, setCurrentQuestionIndexes] = useState<{
        [sectionId: string]: number;
    }>({});
    const [selectedSection, setSelectedSection] = useState(
        assessmentDetails[1]?.saved_data.sections?.[0]?.id || ''
    );
    const { data: questionsDataSectionWise, isLoading: isQuestionsLoading } = useSuspenseQuery(
        getQuestionDataForSection({
            assessmentId,
            sectionIds: assessmentDetails[1]?.saved_data.sections
                ?.map((section) => section.id)
                .join(','),
        })
    );

    const form = useForm<sectionsEditQuestionFormType>({
        resolver: zodResolver(sectionsEditQuestionFormSchema),
        mode: 'onChange',
        defaultValues: {
            sections: [
                {
                    sectionId: '',
                    sectionName: '',
                    questions: [
                        {
                            id: '',
                            questionId: '',
                            questionName: '',
                            explanation: '',
                            questionType: 'MCQS',
                            questionPenalty: '',
                            questionDuration: {
                                hrs: '',
                                min: '',
                            },
                            questionMark: '',
                            singleChoiceOptions: [
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                            ],
                            multipleChoiceOptions: [
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                                {
                                    name: '',
                                    isSelected: false,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });

    const { reset, getValues } = form;

    // Find the selected section index
    const selectedSectionIndex =
        assessmentDetails[1]?.saved_data.sections?.findIndex(
            (section) => section.id === selectedSection
        ) || 0;

    // Get the total number of questions in the current section
    const currentSectionQuestions =
        form.getValues(`sections.${selectedSectionIndex}.questions`) || [];
    const maxQuestions = currentSectionQuestions.length;
    // Get the current question index for the selected section
    const currentQuestionIndex = currentQuestionIndexes[selectedSection] || 0;
    const handlePageClick = (pageIndex: number) => {
        if (pageIndex >= 0 && pageIndex < maxQuestions) {
            setCurrentQuestionIndexes((prev) => ({
                ...prev,
                [selectedSection]: pageIndex,
            }));
        }
    };

    const addQuestionToSelectedSection = () => {
        // Get the current list of questions for the selected section
        const currentQuestions = form.getValues(`sections.${selectedSectionIndex}.questions`) || [];

        // Prepare a new question object to append
        const newQuestion = {
            id: String(currentQuestions.length),
            questionId: '',
            questionName: '',
            explanation: '',
            questionType: 'MCQS',
            questionPenalty: '',
            questionDuration: {
                hrs: '',
                min: '',
            },
            questionMark: '',
            singleChoiceOptions: Array(4).fill({
                name: '',
                isSelected: false,
            }),
            multipleChoiceOptions: Array(4).fill({
                name: '',
                isSelected: false,
            }),
        };

        // Append the new question to the existing list
        const updatedQuestions = [...currentQuestions, newQuestion];

        // Update form state
        form.setValue(`sections.${selectedSectionIndex}.questions`, updatedQuestions);
        form.trigger(`sections.${selectedSectionIndex}.questions`);

        // Update current question index for the selected section
        setCurrentQuestionIndexes((prev) => ({
            ...prev,
            [selectedSection]: updatedQuestions.length - 1, // Move to the last added question
        }));
    };

    const handleSubmitSectionsForm = useMutation({
        mutationFn: ({ data }: { data: AssessmentDetailQuestions }) => savePrivateQuestions(data),
        onSuccess: async (data) => {
            const transformedQuestionsData: MyQuestion[] = transformResponseDataToMyQuestionsSchema(
                data.questions
            );

            const getSectionsWithAddedQuestionsCnt = getSectionsWithEmptyQuestionIds(
                form.getValues()
            );

            const sectionsWithAddedQuestions = handleAddedQuestionsToSections(
                getSectionsWithAddedQuestionsCnt,
                transformedQuestionsData
            );

            const sectionsDataWithAddedQuestionIds = addQuestionIdToSections(
                form.getValues('sections'),
                sectionsWithAddedQuestions
            );

            const transformToStep2Data = transformPreviewDataToSections(
                assessmentDetails[1]?.saved_data.sections
            );

            const mergedData = mergeSectionData(
                sectionsDataWithAddedQuestionIds,
                transformToStep2Data.updated_sections
            );

            const updatedSectionsData = compareAndUpdateSections(
                previousSections.current,
                mergedData
            );

            const finalData = {
                test_duration: {
                    entire_test_duration: assessmentDetails[1]?.saved_data.duration,
                    distribution_duration: assessmentDetails[1]?.saved_data.duration_distribution,
                },
                updated_sections: updatedSectionsData || [],
                added_sections: [],
                deleted_sections: [],
            };
            await handlePostAssessmentPreview(
                finalData,
                assessmentId,
                instituteDetails?.id,
                examType
            );
            queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS'] });
            handleCloseDialog();
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(error.message, {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                // Handle non-Axios errors if necessary
                console.error('Unexpected error:', error);
            }
        },
    });

    const onInvalid = (err: unknown) => {
        console.error(err);
        toast.error(t('errors.incompleteQuestions'), {
            className: 'error-toast',
            duration: 2000,
        });
    };

    function onSubmit(values: z.infer<typeof sectionsEditQuestionFormSchema>) {
        const extractAddedQuestions = extractEmptyIdQuestions(values);
        const convertedQuestions = transformSectionQuestions(extractAddedQuestions);
        handleSubmitSectionsForm.mutate({
            data: convertedQuestions,
        });
    }

    // Update section while keeping question index valid
    const handleSectionChange = (newSectionId: string) => {
        setSelectedSection(newSectionId);
        setCurrentQuestionIndexes((prev) => ({
            ...prev,
            [newSectionId]: prev[newSectionId] || 0, // Default to first question if not set
        }));
    };

    const previousSections = useRef<sectionsEditQuestionFormType['sections']>();

    useEffect(() => {
        if (!assessmentDetails[1]?.saved_data.sections) return;

        const transformedData = transformSectionsAndQuestionsData(
            assessmentDetails[1]?.saved_data.sections || [],
            questionsDataSectionWise
        );

        previousSections.current = transformedData;
        reset({ sections: transformedData });
    }, []);

    useEffect(() => {
        const maxQuestionsInNewSection =
            form.getValues(`sections.${selectedSectionIndex}.questions`)?.length || 0;
        setCurrentQuestionIndexes((prev) => ({
            ...prev,
            [selectedSection]: Math.min(prev[selectedSection] || 0, maxQuestionsInNewSection - 1),
        }));
    }, [selectedSection]);

    useEffect(() => {
        // announcementDialogTrigger(
        //     previousSections.current,
        //     form.getValues("sections"),
        //     selectedSectionIndex,
        //     currentQuestionIndex,
        // );
    }, [currentQuestionIndex]);

    useEffect(() => {
        if (selectedSection && currentQuestionIndexes[selectedSection] !== undefined) {
            const sectionIndex = form
                .getValues('sections')
                .findIndex((section) => section.sectionId === selectedSection);

            if (sectionIndex !== -1) {
                const questionIndex = currentQuestionIndexes[selectedSection];
                const currentQuestion = form.getValues(
                    `sections.${sectionIndex}.questions.${questionIndex}` as `sections.${number}.questions.${number}`
                );

                if (currentQuestion) {
                    // Force a form update for the current question
                    form.setValue(
                        `sections.${sectionIndex}.questions.${questionIndex}` as `sections.${number}.questions.${number}`,
                        {
                            ...currentQuestion,
                        },
                        {
                            shouldDirty: true,
                            shouldTouch: true,
                        }
                    );
                }
            }
        }
    }, [selectedSection, currentQuestionIndexes]);

    if (isLoading || isQuestionsLoading) return <DashboardLoader />;
    return (
        <div className="flex flex-col">
            <div className="flex h-20 items-center justify-between bg-primary-100 p-6">
                <div className="flex items-center">
                    <h1 className="text-sm font-semibold">{t('joinLink.label')}</h1>
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-4">
                            <span className="px-3 py-2 text-sm underline">{joinUrl}</span>
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                className="h-9 min-w-10"
                                onClick={() => copyToClipboard(joinUrl)}
                            >
                                <Copy size={32} />
                            </MyButton>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <QRCode value={joinUrl} className="size-14" id={`qr-code-svg-participants`} />
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="h-9 min-w-10"
                        onClick={() => handleDownloadQRCode('qr-code-svg-participants')}
                    >
                        <DownloadSimple size={32} />
                    </MyButton>
                </div>
            </div>
            <Tabs value={selectedSection} onValueChange={handleSectionChange}>
                <div className="flex items-center justify-end gap-4 bg-primary-50 p-4">
                    <Dialog>
                        <DialogTrigger className="cursor-pointer rounded-full border p-2">
                            <SpeakerLow size={20} />
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex h-[80vh] !w-full !max-w-[80vw] flex-col gap-4 overflow-y-auto !p-0">{/* design-lint-ignore: vh/vw dialog sizing matches MyDialog primitive */}
                            <h1 className="h-14 bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('announcement.dialogTitle')}
                            </h1>
                            <AnnouncementComponent
                                announcementList={announcementList}
                                setAnnouncementList={setAnnouncementList}
                            />
                            <div className="flex max-h-screen flex-col gap-4 overflow-y-auto p-4 pt-0">
                                {announcementList.length === 0 ? (
                                    <p className="text-center">{t('announcement.empty')}</p>
                                ) : (
                                    announcementList?.map((announcement: Announcement) => (
                                        <Card
                                            key={announcement.id}
                                            className="w-full bg-neutral-50 pb-3 shadow-none"
                                        >
                                            <CardHeader>
                                                <CardTitle className="font-semibold text-neutral-600">
                                                    {announcement.title}
                                                </CardTitle>
                                                <CardDescription
                                                    dangerouslySetInnerHTML={{
                                                        __html: announcement.instructions || '',
                                                    }}
                                                />
                                            </CardHeader>
                                            <p className="-mt-3 ml-2 flex items-center">
                                                <DotOutline
                                                    size={32}
                                                    weight="fill"
                                                    className="text-neutral-400"
                                                />
                                                <span className="text-sm text-neutral-600">
                                                    {t('announcement.postedTodayAt')}
                                                </span>
                                            </p>
                                        </Card>
                                    ))
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        layoutVariant="default"
                        className="text-sm"
                        onClick={form.handleSubmit(onSubmit, onInvalid)}
                    >
                        {t('actions.save')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        scale="large"
                        buttonType="secondary"
                        layoutVariant="default"
                        className="text-sm"
                        onClick={handleCloseDialog}
                    >
                        {t('actions.exit')}
                    </MyButton>
                </div>
                <div className="bg-neutral-50 p-4">
                    <TabsList className="flex w-fit justify-start rounded-none border-b bg-neutral-50">
                        {assessmentDetails[1]?.saved_data?.sections?.map((section) => (
                            <TabsTrigger
                                key={section.id}
                                value={section.id}
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedSection === section.id
                                        ? 'rounded-t-sm border border-primary-200 !border-b-neutral-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                {section.name}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                <FormProvider {...form}>
                    <form className="no-scrollbar h-screen space-y-8 overflow-y-auto px-4">
                        <TabsContent value={selectedSection}>
                            <div className="flex h-screen items-start">
                                <div className="mt-4 flex w-40 flex-col items-center justify-center gap-2">
                                    <Button
                                        type="button"
                                        className="max-w-sm bg-primary-500 text-xs text-white shadow-none"
                                        onClick={addQuestionToSelectedSection}
                                    >
                                        {t('actions.addQuestion')}
                                    </Button>
                                    <div className="flex h-[325vh] w-40 flex-col items-start justify-between gap-4 overflow-x-hidden overflow-y-scroll p-2">{/* design-lint-ignore: viewport-relative sizing has no spacing token */}
                                        <Sortable
                                            value={
                                                form.getValues(
                                                    `sections.${selectedSectionIndex}.questions`
                                                ) || []
                                            }
                                            onMove={({ activeIndex, overIndex }) => {
                                                const currentQuestions =
                                                    form.getValues(
                                                        `sections.${selectedSectionIndex}.questions`
                                                    ) || [];
                                                const updatedQuestions = [...currentQuestions];

                                                // Perform the move operation in the array
                                                const [removed] = updatedQuestions.splice(
                                                    activeIndex,
                                                    1
                                                );

                                                // Ensure that removed is not undefined
                                                if (removed) {
                                                    updatedQuestions.splice(overIndex, 0, removed);

                                                    // Update the form with the new order of questions
                                                    form.setValue(
                                                        `sections.${selectedSectionIndex}.questions`,
                                                        updatedQuestions
                                                    );
                                                }
                                            }}
                                        >
                                            <div className="flex origin-top-left scale-[0.26] flex-col gap-8 overflow-x-hidden">
                                                {form
                                                    .getValues(
                                                        `sections.${selectedSectionIndex}.questions`
                                                    )
                                                    .map((field, index) => {
                                                        return (
                                                            <SortableItem
                                                                key={field.id}
                                                                value={field.id}
                                                                asChild
                                                            >
                                                                <div
                                                                    key={index}
                                                                    onClick={() =>
                                                                        handlePageClick(index)
                                                                    }
                                                                    className={`rounded-xl border-4 bg-primary-50 p-6 ${
                                                                        currentQuestionIndex ===
                                                                        index
                                                                            ? 'border-primary-500 bg-none'
                                                                            : 'bg-none'
                                                                    }`}
                                                                >
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center justify-start gap-4">
                                                                            <h1 className="left-0 w-96 whitespace-nowrap text-4xl font-bold">
                                                                                {index + 1}
                                                                                &nbsp;
                                                                                {getValues(
                                                                                    `sections.${selectedSectionIndex}.questions.${index}.questionType`
                                                                                ) === 'MCQS'
                                                                                    ? t(
                                                                                          'questionType.MCQS'
                                                                                      )
                                                                                    : t(
                                                                                          'questionType.MCQM'
                                                                                      )}
                                                                            </h1>
                                                                            <SortableDragHandle
                                                                                variant="outline"
                                                                                size="icon"
                                                                                className="size-16"
                                                                            >
                                                                                <DotsSixVertical className="!size-12" />
                                                                            </SortableDragHandle>
                                                                        </div>
                                                                        <PPTComponentFactory
                                                                            type={
                                                                                getValues(
                                                                                    `sections.${selectedSectionIndex}.questions.${index}.questionType`
                                                                                ) as 'MCQS' | 'MCQM'
                                                                            }
                                                                            props={{
                                                                                form: form,
                                                                                selectedSection:
                                                                                    selectedSection,
                                                                                currentQuestionIndexes:
                                                                                    currentQuestionIndexes,
                                                                                setCurrentQuestionIndexes:
                                                                                    setCurrentQuestionIndexes,
                                                                                currentQuestionIndex:
                                                                                    index,
                                                                                className:
                                                                                    'relative mt-4 rounded-xl border-4 border-primary-300 bg-white p-4',
                                                                                selectedSectionIndex:
                                                                                    selectedSectionIndex,
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </SortableItem>
                                                        );
                                                    })}
                                            </div>
                                        </Sortable>
                                    </div>
                                </div>
                                <Separator orientation="vertical" className="min-h-screen" />
                                <MainViewComponentFactory
                                    type={
                                        getValues(
                                            `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionType`
                                        ) as 'MCQS' | 'MCQM'
                                    }
                                    props={{
                                        form: form,
                                        selectedSection: selectedSection,
                                        currentQuestionIndexes: currentQuestionIndexes,
                                        setCurrentQuestionIndexes: setCurrentQuestionIndexes,
                                        currentQuestionIndex: currentQuestionIndex,
                                        className: 'ml-6 flex w-full flex-col gap-6 pr-6 pt-4',
                                        selectedSectionIndex: selectedSectionIndex,
                                    }}
                                />
                            </div>
                        </TabsContent>
                    </form>
                </FormProvider>
            </Tabs>
        </div>
    );
};

export default AssessmentPreview;
