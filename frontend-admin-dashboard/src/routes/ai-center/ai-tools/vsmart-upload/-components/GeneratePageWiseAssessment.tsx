import { useEffect, useRef, useState } from 'react';
import ReactQuill from 'react-quill';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    convertSVGsToBase64,
    transformQuestionsToGenerateAssessmentAI,
} from '@/routes/ai-center/-utils/helper';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { generateCompleteAssessmentFormSchema } from '@/routes/ai-center/-utils/generate-complete-assessment-schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { AIAssessmentResponseInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import GeneratePageWiseAssessmentQuestionsDialog from './GeneratePageWiseAssessmentQuestionsDialog';
import { useMutation } from '@tanstack/react-query';
import { handleGenerateAssessmentQuestionsPageWise } from '@/routes/ai-center/-services/ai-center-service';

interface GeneratePageWiseAssessmentProps {
    openPageWiseAssessmentDialog: boolean;
    setOpenPageWiseAssessmentDialog: React.Dispatch<React.SetStateAction<boolean>>;
    htmlData: string | null;
}

const GeneratePageWiseAssessment = ({
    openPageWiseAssessmentDialog,
    setOpenPageWiseAssessmentDialog,
    htmlData,
}: GeneratePageWiseAssessmentProps) => {
    const { t } = useTranslation('aiCenterGeneratePageWiseAssessment');
    const { t: tHelper } = useTranslation('aiCenterHelper');

    const rightEditorRef = useRef<ReactQuill | null>(null);
    const leftContentRef = useRef<HTMLDivElement | null>(null);

    const [popupVisible, setPopupVisible] = useState(false);
    const [selectedText, setSelectedText] = useState('');
    const [assessmentData, setAssessmentData] = useState<AIAssessmentResponseInterface>({
        title: '',
        tags: [],
        difficulty: '',
        description: '',
        subjects: [],
        classes: [],
        questions: [],
    });
    const [openCompleteAssessmentDialog, setOpenCompleteAssessmentDialog] = useState(false);
    const [propmtInput, setPropmtInput] = useState('');
    const [isMoreQuestionsDialog, setIsMoreQuestionsDialog] = useState(false);

    const form = useForm<z.infer<typeof generateCompleteAssessmentFormSchema>>({
        resolver: zodResolver(generateCompleteAssessmentFormSchema),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '1',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: undefined,
            questions: [],
        },
    });

    const handleLeftSelection = (event: React.MouseEvent<HTMLDivElement>) => {
        const selection = window.getSelection();

        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = document.createElement('div');
            container.appendChild(range.cloneContents());
            const html = container.innerHTML.trim();

            if (html.length > 0) {
                setSelectedText(html); // Save selected HTML
                setPopupVisible(true);
                return;
            }
        }

        // Handle direct clicks on images or SVGs (no selection)
        const target = event.target as HTMLElement;
        const closestSvg = target.closest('svg');
        const closestImg = target.closest('img');

        if (closestSvg) {
            setSelectedText(closestSvg.outerHTML);
            setPopupVisible(true);
        } else if (closestImg) {
            setSelectedText(closestImg.outerHTML);
            setPopupVisible(true);
        }
    };

    const handleConfirmCopy = () => {
        const rightEditor = rightEditorRef.current?.getEditor();
        const currentLength = rightEditor?.getLength() ?? 0;

        if (selectedText) {
            // Use dangerouslyPasteHTML to insert full HTML (including images, svg, etc.)
            rightEditor?.clipboard.dangerouslyPasteHTML(currentLength, selectedText);
        }

        setPopupVisible(false);
        setSelectedText('');
    };

    /* Generate Assessment Complete */
    const MAX_POLL_ATTEMPTS = 10;
    const pollingCountRef = useRef(0);
    const pollingTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
    const pendingRef = useRef(false);

    const clearPolling = () => {
        if (pollingTimeoutIdRef.current) {
            clearTimeout(pollingTimeoutIdRef.current);
            pollingTimeoutIdRef.current = null;
        }
    };

    const generateAssessmentMutation = useMutation({
        mutationFn: ({
            html,
            userPrompt,
            taskId,
        }: {
            html: string;
            userPrompt: string;
            taskId: string;
        }) => handleGenerateAssessmentQuestionsPageWise(html, userPrompt, taskId),
        onSuccess: (response) => {
            // Check if response indicates pending state
            if (response?.status === 'pending') {
                pendingRef.current = true;
                // Don't schedule next poll - we'll wait for an error to resume
                return;
            }

            // Reset pending state if response is no longer pending
            pendingRef.current = false;

            // If we have complete data, we're done
            if (response === 'Done' || response?.questions) {
                setAssessmentData((prev) => ({
                    ...prev,
                    questions: [...(prev.questions ?? []), ...(response?.questions ?? [])],
                }));
                const addedQuestions = [
                    ...(assessmentData.questions ?? []),
                    ...(response?.questions ?? []),
                ];
                const transformQuestionsData = transformQuestionsToGenerateAssessmentAI(
                    addedQuestions,
                    tHelper
                );
                form.reset({
                    ...form.getValues(),
                    title: assessmentData?.title,
                    questions: transformQuestionsData,
                });
                form.trigger();
                clearPolling();
                setPropmtInput('');
                setIsMoreQuestionsDialog(false);
                return;
            }

            // Otherwise schedule next poll
            scheduleNextPoll();
        },
        onError: () => {
            // If we were in a pending state, resume polling on error
            if (pendingRef.current) {
                pendingRef.current = false;
                scheduleNextPoll();
                return;
            }

            // Normal error handling
            pollingCountRef.current += 1;
            if (pollingCountRef.current >= MAX_POLL_ATTEMPTS) {
                clearPolling();
                return;
            }

            // Schedule next poll on error (if not max attempts)
            scheduleNextPoll();
        },
    });

    const scheduleNextPoll = () => {
        clearPolling(); // Clear any existing timeout

        // Only schedule next poll if not in pending state
        if (!pendingRef.current) {
            pollingTimeoutIdRef.current = setTimeout(() => {
                pollGenerateAssessment();
            }, 10000);
        }
    };

    const pollGenerateAssessment = () => {
        // Don't call API if in pending state
        if (pendingRef.current) {
            return;
        }
        generateAssessmentMutation.mutate({
            html: String(rightEditorRef.current?.value),
            userPrompt: propmtInput,
            taskId: '',
        });
    };

    const handleGenerateQuestionsForAssessment = () => {
        if (!htmlData) return;

        // Prevent double API calls by checking if polling is already in progress
        if (pollingTimeoutIdRef.current) {
            return;
        }

        clearPolling();
        pollingCountRef.current = 0;
        pendingRef.current = false;

        // Make initial call
        pollGenerateAssessment();
    };

    useEffect(() => {
        return () => {
            clearPolling();
        };
    }, []);
    return (
        <>
            <Dialog
                open={openPageWiseAssessmentDialog}
                onOpenChange={setOpenPageWiseAssessmentDialog}
            >
                <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0 [&>button]:hidden">
                    <div className="flex justify-end gap-4 bg-primary-50 p-2">
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            layoutVariant="default"
                            className="text-sm"
                            onClick={() => setOpenPageWiseAssessmentDialog(false)}
                        >
                            {t('actions.close')}
                        </MyButton>
                        <GeneratePageWiseAssessmentQuestionsDialog
                            form={form}
                            openCompleteAssessmentDialog={openCompleteAssessmentDialog}
                            setOpenCompleteAssessmentDialog={setOpenCompleteAssessmentDialog}
                            assessmentData={assessmentData}
                            handleGenerateQuestionsForAssessment={
                                handleGenerateQuestionsForAssessment
                            }
                            propmtInput={propmtInput}
                            setPropmtInput={setPropmtInput}
                            isMoreQuestionsDialog={isMoreQuestionsDialog}
                            setIsMoreQuestionsDialog={setIsMoreQuestionsDialog}
                            loadingState={generateAssessmentMutation.status}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4 p-4">
                        {/* Left Viewer */}
                        <div onMouseUp={handleLeftSelection}>
                            <h2 className="mb-2 text-lg font-semibold">
                                {t('viewer.allQuestions')}
                            </h2>
                            <div
                                ref={leftContentRef}
                                onMouseUp={handleLeftSelection}
                                className="rounded border p-4"
                                dangerouslySetInnerHTML={{
                                    __html: convertSVGsToBase64(htmlData ?? '', tHelper) || '',
                                }}
                            />
                        </div>

                        {/* Right Editor */}
                        <div>
                            <h2 className="mb-2 text-lg font-semibold">
                                {t('viewer.selectedQuestions')}
                            </h2>
                            <ReactQuill ref={rightEditorRef} theme="snow" />
                        </div>
                    </div>
                    {/* Popup */}
                    <Dialog open={popupVisible} onOpenChange={setPopupVisible}>
                        <DialogContent className="flex w-auto flex-col gap-4 p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('copyConfirm.title')}
                            </h1>
                            <p className="px-4">{t('copyConfirm.message')}</p>
                            <div className="flex items-center justify-between gap-4 px-4 pb-4">
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    layoutVariant="default"
                                    className="text-sm"
                                    onClick={() => setPopupVisible(false)}
                                >
                                    {t('copyConfirm.no')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="text-sm"
                                    onClick={handleConfirmCopy}
                                >
                                    {t('copyConfirm.yes')}
                                </MyButton>
                            </div>
                        </DialogContent>
                    </Dialog>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default GeneratePageWiseAssessment;
