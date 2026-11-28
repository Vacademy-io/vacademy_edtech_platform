import { Button } from '@/components/ui/button';
import { Plus, Sparkle, X } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { QuestionPaperUpload } from './QuestionPaperUpload';
import { useIsMobile } from '@/hooks/use-mobile';
import useDialogStore from '../-global-states/question-paper-dialogue-close';
import { Dispatch, SetStateAction, useState } from 'react';
import { GenerateWithAiDialog } from './GenerateWithAiDialog';
import { useTranslation } from 'react-i18next';

interface QuestionPaperHeadingInterface {
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
}

export const QuestionPapersHeading = ({
    currentQuestionIndex,
    setCurrentQuestionIndex,
}: QuestionPaperHeadingInterface) => {
    const { t } = useTranslation('assessmentQuestionPapersHeading');
    const [generateOpen, setGenerateOpen] = useState(false);
    const isMobile = useIsMobile();
    const {
        isMainQuestionPaperAddDialogOpen,
        isManualQuestionPaperDialogOpen,
        isUploadFromDeviceDialogOpen,
        setIsMainQuestionPaperAddDialogOpen,
        setIsManualQuestionPaperDialogOpen,
        setIsUploadFromDeviceDialogOpen,
    } = useDialogStore();

    return (
        <div
            className={`flex items-center justify-between gap-10 ${
                isMobile ? 'flex-wrap gap-4' : ''
            }`}
        >
            <div className="flex flex-col">
                <h1 className="text-h3 font-bold text-neutral-600">
                    {t('heading')}
                </h1>
                <p className="text-neutral-600">{t('description')}</p>
            </div>
            <AlertDialog
                open={isMainQuestionPaperAddDialogOpen}
                onOpenChange={setIsMainQuestionPaperAddDialogOpen}
            >
                <AlertDialogTrigger>
                    <Button className="bg-primary-500 text-white">
                        <Plus />
                        {t('addQuestionPaper')}
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="p-0">
                    <div className="flex items-center justify-between rounded-md bg-primary-50">
                        <h1 className="rounded-sm p-4 text-primary-500">
                            {t('addQuestionPaper')}
                        </h1>
                        <AlertDialogCancel
                            onClick={() => setIsMainQuestionPaperAddDialogOpen(false)}
                            className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                        >
                            <X className="text-neutral-600" />
                        </AlertDialogCancel>
                    </div>
                    <div className="mb-6 mt-2 flex flex-col items-center justify-center gap-6">
                        {/* Generate with AI — the Acadine-style path: pick a book or
                            knowledge base, then configure syllabus, question mix and
                            test details in the paper wizard. */}
                        <Button
                            variant="outline"
                            className="w-40 border-primary-300 text-primary-600"
                            onClick={() => {
                                setIsMainQuestionPaperAddDialogOpen(false);
                                setGenerateOpen(true);
                            }}
                        >
                            <Sparkle className="mr-1 size-4" />
                            {t('generateWithAi')}
                        </Button>
                        {/* Create Manually Dialog */}
                        <AlertDialog
                            open={isManualQuestionPaperDialogOpen}
                            onOpenChange={setIsManualQuestionPaperDialogOpen}
                        >
                            <AlertDialogTrigger>
                                <Button variant="outline" className="w-40 text-neutral-600">
                                    {t('createManually')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="p-0">
                                <div className="flex items-center justify-between rounded-md bg-primary-50">
                                    <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                        {t('createQuestionPaperManually')}
                                    </h1>
                                    <AlertDialogCancel
                                        onClick={() => setIsManualQuestionPaperDialogOpen(false)}
                                        className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    >
                                        <X className="text-neutral-600" />
                                    </AlertDialogCancel>
                                </div>
                                <QuestionPaperUpload
                                    isManualCreated={true}
                                    currentQuestionIndex={currentQuestionIndex}
                                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                                />
                            </AlertDialogContent>
                        </AlertDialog>

                        {/* Upload from Device Dialog */}
                        <AlertDialog
                            open={isUploadFromDeviceDialogOpen}
                            onOpenChange={setIsUploadFromDeviceDialogOpen}
                        >
                            <AlertDialogTrigger>
                                <Button variant="outline" className="w-40 text-neutral-600">
                                    {t('uploadFromDevice')}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="p-0">
                                <div className="flex items-center justify-between rounded-md bg-primary-50">
                                    <h1 className="rounded-sm p-4 font-bold text-primary-500">
                                        {t('uploadQuestionPaperFromDevice')}
                                    </h1>
                                    <AlertDialogCancel
                                        onClick={() => setIsUploadFromDeviceDialogOpen(false)}
                                        className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                                    >
                                        <X className="text-neutral-600" />
                                    </AlertDialogCancel>
                                </div>
                                <QuestionPaperUpload
                                    isManualCreated={false}
                                    currentQuestionIndex={currentQuestionIndex}
                                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                                />
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
            <GenerateWithAiDialog open={generateOpen} onOpenChange={setGenerateOpen} />
        </div>
    );
};
