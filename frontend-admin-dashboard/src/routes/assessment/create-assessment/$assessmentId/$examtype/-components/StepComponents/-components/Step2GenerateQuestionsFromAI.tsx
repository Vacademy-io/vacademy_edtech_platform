import { MyButton } from '@/components/design-system/button';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { StarFour, X } from '@phosphor-icons/react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { AICenterProvider } from '@/routes/ai-center/-contexts/useAICenterContext';
import GenerateAIAssessmentComponent from '@/routes/ai-center/ai-tools/vsmart-upload/-components/GenerateAssessment';
import { GenerateQuestionsFromAudio } from '@/routes/ai-center/ai-tools/vsmart-audio/-components/GenerateQuestionsFromAudio';
import { GenerateQuestionsFromText } from '@/routes/ai-center/ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import GenerateAiQuestionPaperComponent from '@/routes/ai-center/ai-tools/vsmart-extract/-components/GenerateQuestionPaper';
import GenerateAiQuestionFromImageComponent from '@/routes/ai-center/ai-tools/vsmart-image/-components/GenerateQuestionPaper';
import { UseFormReturn } from 'react-hook-form';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { z } from 'zod';
import { useAIQuestionDialogStore } from '../../../-utils/zustand-global-states/ai-add-questions-dialog-zustand';
import { useTranslation } from 'react-i18next';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
const Step2GenerateQuestionsFromAI = ({
    form,
    index,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
}) => {
    const {
        isAIQuestionDialog1,
        setIsAIQuestionDialog1,
        isAIQuestionDialog2,
        setIsAIQuestionDialog2,
        isAIQuestionDialog3,
        setIsAIQuestionDialog3,
        isAIQuestionDialog4,
        setIsAIQuestionDialog4,
        isAIQuestionDialog5,
        setIsAIQuestionDialog5,
        isAIQuestionDialog6,
        setIsAIQuestionDialog6,
        isAIQuestionDialog7,
        setIsAIQuestionDialog7,
        isAIQuestionDialog8,
        setIsAIQuestionDialog8,
    } = useAIQuestionDialogStore();
    const { t } = useTranslation('assessmentStep2GenerateQuestionsFromAI');
    return (
        <AlertDialog open={isAIQuestionDialog6} onOpenChange={setIsAIQuestionDialog6}>
            <AlertDialogTrigger asChild>
                <button
                    type="button"
                    className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-gradient-to-br from-primary-50/60 via-white to-purple-50/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
                >
                    <div className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-purple-500 text-white shadow-sm">
                        <StarFour size={20} weight="fill" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-neutral-800">
                                {t('trigger.title')}
                            </span>
                            <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-primary-600">
                                {t('trigger.badge')}
                            </span>
                        </div>
                        <div className="text-xs text-neutral-500">
                            {t('trigger.subtitle')}
                        </div>
                    </div>
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="p-0">
                <div className="flex items-center justify-between rounded-md bg-primary-50">
                    <h1 className="rounded-sm p-4 font-bold text-primary-500">
                        {t('dialog.title')}
                    </h1>
                    <AlertDialogCancel className="border-none bg-primary-50 shadow-none hover:bg-primary-50">
                        <X className="text-neutral-600" />
                    </AlertDialogCancel>
                </div>
                <div className="flex flex-col gap-4 px-4 pb-4">
                    {/* Generate Questions */}
                    <Dialog open={isAIQuestionDialog7} onOpenChange={setIsAIQuestionDialog7}>
                        <DialogTrigger>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <StarFour weight="fill" className="text-primary-500" />
                                        {t('generateSection.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('generateSection.cardDescription')}
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('generateSection.dialogTitle')}
                            </h1>
                            <div className="flex flex-col gap-4 overflow-auto p-4">
                                <Dialog
                                    open={isAIQuestionDialog1}
                                    onOpenChange={setIsAIQuestionDialog1}
                                >
                                    <DialogTrigger>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('generateSection.vsmartUpload.title')}
                                                    <p className="text-body">
                                                        {t(
                                                            'generateSection.vsmartUpload.subtitle'
                                                        )}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>
                                                            {t(
                                                                'generateSection.vsmartUpload.description'
                                                            )}
                                                        </p>
                                                    </div>
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAIAssessmentComponent
                                                form={form}
                                                currentSectionIndex={index}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                                <Dialog
                                    open={isAIQuestionDialog2}
                                    onOpenChange={setIsAIQuestionDialog2}
                                >
                                    <DialogTrigger>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('generateSection.vsmartAudio.title')}
                                                    <p className="text-body">
                                                        {t(
                                                            'generateSection.vsmartAudio.subtitle'
                                                        )}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>
                                                            {t(
                                                                'generateSection.vsmartAudio.description'
                                                            )}
                                                        </p>
                                                    </div>
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateQuestionsFromAudio
                                                form={form}
                                                currentSectionIndex={index}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                                <Dialog
                                    open={isAIQuestionDialog3}
                                    onOpenChange={setIsAIQuestionDialog3}
                                >
                                    <DialogTrigger>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('generateSection.vsmartTopics.title')}
                                                    <p className="text-body">
                                                        {t(
                                                            'generateSection.vsmartTopics.subtitle'
                                                        )}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>
                                                            {t(
                                                                'generateSection.vsmartTopics.description'
                                                            )}
                                                        </p>
                                                    </div>
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateQuestionsFromText
                                                form={form}
                                                currentSectionIndex={index}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* Extract Questions */}
                    <Dialog open={isAIQuestionDialog8} onOpenChange={setIsAIQuestionDialog8}>
                        <DialogTrigger>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <StarFour weight="fill" className="text-primary-500" />
                                        {t('extractSection.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('extractSection.cardDescription')}
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('extractSection.dialogTitle')}
                            </h1>
                            <div className="flex flex-col gap-4 overflow-auto p-4">
                                <Dialog
                                    open={isAIQuestionDialog4}
                                    onOpenChange={setIsAIQuestionDialog4}
                                >
                                    <DialogTrigger>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('extractSection.vsmartExtract.title')}
                                                    <p className="text-body">
                                                        {t(
                                                            'extractSection.vsmartExtract.subtitle'
                                                        )}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>
                                                            {t(
                                                                'extractSection.vsmartExtract.description'
                                                            )}
                                                        </p>
                                                    </div>
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAiQuestionPaperComponent
                                                form={form}
                                                currentSectionIndex={index}
                                                sectionSplit
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                                <Dialog
                                    open={isAIQuestionDialog5}
                                    onOpenChange={setIsAIQuestionDialog5}
                                >
                                    <DialogTrigger>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('extractSection.vsmartImage.title')}
                                                    <p className="text-body">
                                                        {t(
                                                            'extractSection.vsmartImage.subtitle'
                                                        )}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>
                                                            {t(
                                                                'extractSection.vsmartImage.description'
                                                            )}
                                                        </p>
                                                    </div>
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAiQuestionFromImageComponent
                                                form={form}
                                                currentSectionIndex={index}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default Step2GenerateQuestionsFromAI;
