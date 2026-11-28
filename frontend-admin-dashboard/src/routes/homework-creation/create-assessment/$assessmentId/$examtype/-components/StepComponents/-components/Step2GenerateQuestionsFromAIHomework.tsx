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
import { useAIQuestionDialogStore } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/zustand-global-states/ai-add-questions-dialog-zustand';
import { useTranslation } from 'react-i18next';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
const Step2GenerateQuestionsFromAIHomework = ({
    form,
    index,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
}) => {
    const { t } = useTranslation('homeworkCreationStep2GenerateQuestionsFromAI');
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
    return (
        <AlertDialog open={isAIQuestionDialog6} onOpenChange={setIsAIQuestionDialog6}>
            <AlertDialogTrigger>
                <MyButton type="button" scale="large" buttonType="secondary" className="font-thin">
                    <StarFour weight="fill" className="text-primary-500" />
                    {t('trigger.label')} <span className="text-xs">{t('trigger.badge')}</span>
                </MyButton>
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
                                        {t('generate.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>{t('generate.cardDescription')}</CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('generate.dialogTitle')}
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
                                                    {t('generate.upload.toolName')}
                                                    <p className="text-body">
                                                        {t('generate.upload.shortDescription')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>{t('generate.upload.description')}</p>
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
                                                    {t('generate.audio.toolName')}
                                                    <p className="text-body">
                                                        {t('generate.audio.shortDescription')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>{t('generate.audio.description')}</p>
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
                                                    {t('generate.topics.toolName')}
                                                    <p className="text-body">
                                                        {t('generate.topics.shortDescription')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>{t('generate.topics.description')}</p>
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
                                        {t('extract.cardTitle')}
                                    </CardTitle>
                                    <CardDescription>{t('extract.cardDescription')}</CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('extract.dialogTitle')}
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
                                                    {t('extract.file.toolName')}
                                                    <p className="text-body">
                                                        {t('extract.file.shortDescription')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>{t('extract.file.description')}</p>
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
                                                    {t('extract.image.toolName')}
                                                    <p className="text-body">
                                                        {t('extract.image.shortDescription')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription className="flex flex-col justify-between">
                                                    <div className="flex flex-col gap-3">
                                                        <p>{t('extract.image.description')}</p>
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

export default Step2GenerateQuestionsFromAIHomework;
