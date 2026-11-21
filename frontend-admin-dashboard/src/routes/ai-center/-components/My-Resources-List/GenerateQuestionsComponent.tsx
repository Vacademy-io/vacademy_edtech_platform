import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    handleConvertPDFToHTML,
    handleGenerateAssessmentQuestions,
} from '../../-services/ai-center-service';
import AITasksList from '../AITasksList';
import { GenerateAssessmentDialog } from '../../ai-tools/vsmart-upload/-components/GenerateAssessmentDialog';
import GeneratePageWiseAssessment from '../../ai-tools/vsmart-upload/-components/GeneratePageWiseAssessment';
import { getRandomTaskName } from '../../-utils/helper';

const GenerateQuestionsComponent = ({ fileId }: { fileId: string }) => {
    const { t } = useTranslation('aiCenterMyResourcesGenerateQuestions');
    const [prompt, setPrompt] = useState('');
    const [enableDialog, setEnableDialog] = useState(false);
    const [extractQuestionsDialog, setExtractQuestionsDialog] = useState(false);
    const queryClient = useQueryClient();
    const [allPagesGenerateQuestionsStatus, setAllPagesGenerateQuestionsStatus] = useState(false);
    const [pageWiseGenerateQuestionsStatus, setPageWiseGenerateQuestionsStatus] = useState(false);
    const [openPageWiseAssessmentDialog, setOpenPageWiseAssessmentDialog] = useState(false);
    const [htmlData, setHtmlData] = useState(null);
    const [openAssessmentDialog, setOpenAssessmentDialog] = useState(false);

    const handleOpenAssessmentDialog = (open: boolean) => {
        setOpenAssessmentDialog(open);
    };

    /* Generate Assessment Complete */
    const generateAssessmentMutation = useMutation({
        mutationFn: ({
            pdfId,
            userPrompt,
            taskName,
            taskId,
        }: {
            pdfId: string;
            userPrompt: string;
            taskName: string;
            taskId?: string;
        }) => {
            return handleGenerateAssessmentQuestions(pdfId, userPrompt, taskName, taskId || '');
        },
        onMutate: () => {
            setAllPagesGenerateQuestionsStatus(true);
        },
        onSuccess: () => {
            setAllPagesGenerateQuestionsStatus(false);
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
            }, 100);
            setEnableDialog(true);
        },
        onError: (error: unknown) => {
            console.log(error);
        },
    });

    const handleExtractQuestions = () => {
        generateAssessmentMutation.mutate({
            pdfId: fileId || '',
            userPrompt: prompt || '',
            taskName: getRandomTaskName(),
            taskId: '',
        });
    };

    const handleCloseExtractQuestionDialog = () => {
        setExtractQuestionsDialog(!extractQuestionsDialog);
        setEnableDialog(false);
    };

    /* Generate Assessment Pagewise */
    const convertPollingCountRef = useRef(0);
    const convertPollingTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
    const MAX_CONVERT_ATTEMPTS = 10;
    const convertPendingRef = useRef(false);

    const handleConvertPDFToHTMLMutation = useMutation({
        mutationFn: ({ pdfId, taskName }: { pdfId: string; taskName: string }) =>
            handleConvertPDFToHTML(pdfId, taskName),
        onSuccess: async (response) => {
            // Check if response indicates pending state
            if (response?.status === 'pending') {
                setPageWiseGenerateQuestionsStatus(true);
                convertPendingRef.current = true;
                // Don't schedule next poll - we'll wait for an error to resume
                return;
            }

            // Reset pending state
            convertPendingRef.current = false;

            // If conversion is complete and we have HTML data
            if (response === 'Done' || response?.html) {
                setPageWiseGenerateQuestionsStatus(false);
                stopConvertPolling();
                setHtmlData(response?.html);
                setOpenPageWiseAssessmentDialog(true);

                return;
            }

            // If response exists but no HTML yet, schedule next poll
            scheduleNextConvertPoll();
        },
        onError: (error: unknown) => {
            console.error('⛔️ Convert Error:', error);

            // If we were in a pending state, resume polling on error
            if (convertPendingRef.current) {
                setPageWiseGenerateQuestionsStatus(true);
                convertPendingRef.current = false;
                scheduleNextConvertPoll();
                return;
            }

            // Increment count and check max attempts
            convertPollingCountRef.current += 1;
            if (convertPollingCountRef.current >= MAX_CONVERT_ATTEMPTS) {
                setPageWiseGenerateQuestionsStatus(false);
                stopConvertPolling();
                return;
            }

            // Schedule next poll if not max attempts yet
            scheduleNextConvertPoll();
        },
    });

    const stopConvertPolling = () => {
        if (convertPollingTimeoutIdRef.current) {
            clearTimeout(convertPollingTimeoutIdRef.current);
            convertPollingTimeoutIdRef.current = null;
        }
    };

    const scheduleNextConvertPoll = () => {
        stopConvertPolling(); // Clear any existing timeout

        // Only schedule next poll if not in pending state
        if (!convertPendingRef.current) {
            console.log('Scheduling next conversion poll in 10 seconds');
            convertPollingTimeoutIdRef.current = setTimeout(() => {
                pollConvertPDFToHTML();
            }, 10000);
        }
    };

    const pollConvertPDFToHTML = () => {
        // Don't call API if in pending state
        if (convertPendingRef.current) {
            return;
        }
        handleConvertPDFToHTMLMutation.mutate({ pdfId: fileId, taskName: getRandomTaskName() });
    };

    const handleConvertPDFToHTMLFn = () => {
        if (!fileId) return;
        stopConvertPolling();
        convertPollingCountRef.current = 0;
        convertPendingRef.current = false;
        setPageWiseGenerateQuestionsStatus(true);
        // Make initial call
        pollConvertPDFToHTML();
    };

    return (
        <>
            <Dialog open={extractQuestionsDialog} onOpenChange={handleCloseExtractQuestionDialog}>
                <DialogTrigger>
                    <Badge className="cursor-pointer whitespace-nowrap bg-danger-50">
                        {t('trigger.label')}
                    </Badge>
                </DialogTrigger>
                <DialogContent className="p-0">
                    <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                        {t('dialog.title')}
                    </h1>
                    <div className="flex flex-col gap-4 p-4">
                        <MyInput
                            inputType="text"
                            inputPlaceholder={t('dialog.promptPlaceholder')}
                            input={prompt}
                            onChangeFunction={(e) => setPrompt(e.target.value)}
                            required={true}
                            label={t('dialog.promptLabel')}
                            className="w-full"
                        />

                        <Dialog
                            open={openAssessmentDialog}
                            onOpenChange={handleOpenAssessmentDialog}
                        >
                            <DialogTrigger>
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="text-sm"
                                    disable={!prompt}
                                >
                                    {t('dialog.generateButton')}
                                </MyButton>
                            </DialogTrigger>
                            <DialogContent>
                                <GenerateAssessmentDialog
                                    open={openAssessmentDialog}
                                    handleOpen={handleOpenAssessmentDialog}
                                    handleGenerateCompleteFile={handleExtractQuestions}
                                    handleGeneratePageWise={handleConvertPDFToHTMLFn}
                                    allPagesGenerateQuestionsStatus={
                                        allPagesGenerateQuestionsStatus
                                    }
                                    pageWiseGenerateQuestionsStatus={
                                        pageWiseGenerateQuestionsStatus
                                    }
                                />
                            </DialogContent>
                        </Dialog>
                    </div>
                </DialogContent>
            </Dialog>
            <GeneratePageWiseAssessment
                openPageWiseAssessmentDialog={openPageWiseAssessmentDialog}
                setOpenPageWiseAssessmentDialog={setOpenPageWiseAssessmentDialog}
                htmlData={htmlData}
            />
            {enableDialog && (
                <AITasksList
                    heading={t('tasksList.heading')}
                    enableDialog={enableDialog}
                    setEnableDialog={setEnableDialog}
                />
            )}
        </>
    );
};

export default GenerateQuestionsComponent;
