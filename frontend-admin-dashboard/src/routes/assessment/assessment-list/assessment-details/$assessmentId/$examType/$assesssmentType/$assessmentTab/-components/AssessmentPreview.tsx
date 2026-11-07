import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
    getAssessmentJoinLink,
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
import { sectionsEditQuestionFormSchema } from '../-utils/sections-edit-question-form-schema';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
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
import { QuestionType } from '@/constants/dummy-data';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface Announcement {
    id: string;
    title: string;
    instructions: string | undefined;
}

export type sectionsEditQuestionFormType = z.infer<typeof sectionsEditQuestionFormSchema>;
const AssessmentPreview = ({ handleCloseDialog }: { handleCloseDialog: () => void }) => {
    const { t } = useTranslation('assessmentPreview');
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
                    questions: [],
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
            toast.success(t('toasts.updateSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
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
        toast.error(t('toasts.incompleteQuestions'), {
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

    const joinLink = getAssessmentJoinLink(
        instituteDetails?.learner_portal_base_url,
        assessmentDetails[0]?.saved_data.assessment_url
    );

    if (isLoading || isQuestionsLoading) return <DashboardLoader />;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* One compact band instead of a fixed h-20 with p-6: the join link and QR
                are reference material, not the point of this screen. */}
            {/* One header strip, not two. The join link and QR sat in a primary-100 band
                with Save/Exit stacked in a second primary-50 band underneath — roughly 110px
                of chrome for a link and three buttons, and at narrow widths the second band
                read as an empty cream slab because its contents are right-aligned. */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-primary-100 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                    <h1 className="shrink-0 text-caption font-semibold">
                        {t('header.joinLinkLabel')}
                    </h1>
                    <div className="flex min-w-0 items-center gap-8">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-caption underline">{joinLink}</span>
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                className="!h-8 !min-w-0 px-2"
                                onClick={() => copyToClipboard(joinLink)}
                            >
                                <Copy size={16} />
                            </MyButton>
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <QRCode value={joinLink} className="size-9" id={`qr-code-svg-participants`} />
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="!h-8 !min-w-0 px-2"
                        onClick={() => handleDownloadQRCode('qr-code-svg-participants')}
                    >
                        <DownloadSimple size={16} />
                    </MyButton>
                    <Dialog>
                        <DialogTrigger className="cursor-pointer rounded-full border p-2">
                            <SpeakerLow size={20} />
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex h-[80vh] !w-full !max-w-[80vw] flex-col gap-4 overflow-hidden !p-0">{/* design-lint-ignore: vh/vw dialog sizing matches MyDialog primitive */}
                            <h1 className="h-14 bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('announcementDialog.title')}
                            </h1>
                            <AnnouncementComponent
                                announcementList={announcementList}
                                setAnnouncementList={setAnnouncementList}
                            />
                            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
                                {announcementList.length === 0 ? (
                                    <p className="text-center">{t('announcementDialog.empty')}</p>
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
                                                        __html: sanitizeRichHtml(
                                                            announcement.instructions
                                                        ),
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
                                                    {t('announcementDialog.timestampPlaceholder')}
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
                        scale="medium"
                        buttonType="primary"
                        layoutVariant="default"
                        className="px-5 text-sm sm:!min-w-0"
                        onClick={form.handleSubmit(onSubmit, onInvalid)}
                    >
                        {t('actions.save')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="default"
                        className="px-5 text-sm sm:!min-w-0"
                        onClick={handleCloseDialog}
                    >
                        {t('actions.exit')}
                    </MyButton>
                </div>
            </div>
            <Tabs
                value={selectedSection}
                onValueChange={handleSectionChange}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="shrink-0 bg-neutral-50 px-5 pt-3">
                    <TabsList className="flex w-fit justify-start rounded-none border-b bg-neutral-50">
                        {assessmentDetails[1]?.saved_data?.sections?.map((section) => (
                            <TabsTrigger
                                key={section.id}
                                value={section.id}
                                className={`flex gap-1.5 rounded-none px-6 py-2 !shadow-none ${
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
                    {/* No h-screen: this form lives inside a 90vh dialog, so a 100vh child
                        overflowed the dialog by itself and turned the whole preview into one
                        long scroll. Height comes from the content; the dialog scrolls. */}
                    <form className="no-scrollbar flex min-h-0 flex-1 flex-col px-4 pb-4">
                        <TabsContent
                            value={selectedSection}
                            className="flex min-h-0 flex-1 overflow-hidden"
                        >
                            <div className="flex min-h-0 w-full flex-1 items-stretch">
                                <div className="flex min-h-0 w-44 shrink-0 flex-col items-center justify-start gap-2 border-r border-neutral-200 bg-neutral-50 px-2 pt-4">
                                    <Button
                                        type="button"
                                        className="max-w-sm bg-primary-500 text-xs text-white shadow-none"
                                        onClick={addQuestionToSelectedSection}
                                    >
                                        {t('actions.addQuestion')}
                                    </Button>
                                    <div className="flex min-h-0 w-40 flex-1 flex-col items-start justify-start gap-3 overflow-y-auto overflow-x-hidden p-2">
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
                                                                                          'questionTypes.mcqSingleCorrect'
                                                                                      )
                                                                                    : getValues(
                                                                                            `sections.${selectedSectionIndex}.questions.${index}.questionType`
                                                                                        ) === 'MCQM'
                                                                                      ? t(
                                                                                            'questionTypes.mcqMultipleCorrect'
                                                                                        )
                                                                                      : t(
                                                                                            'questionTypes.mcqMultipleCorrect'
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
                                                                                ) as QuestionType
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
                                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                                    {currentSectionQuestions.length === 0 ? (
                                        <div className="flex size-full items-center justify-center py-16">
                                            <h1>{t('emptyStates.noQuestions')}</h1>
                                        </div>
                                    ) : (
                                        <MainViewComponentFactory
                                            type={
                                                getValues(
                                                    `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionType`
                                                ) as QuestionType
                                            }
                                            props={{
                                                form: form,
                                                selectedSection: selectedSection,
                                                currentQuestionIndexes: currentQuestionIndexes,
                                                setCurrentQuestionIndexes:
                                                    setCurrentQuestionIndexes,
                                                currentQuestionIndex: currentQuestionIndex,
                                                className: 'flex w-full flex-col gap-6 px-5 pt-4',
                                                selectedSectionIndex: selectedSectionIndex,
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        </TabsContent>
                    </form>
                </FormProvider>
            </Tabs>
        </div>
    );
};

export default AssessmentPreview;
