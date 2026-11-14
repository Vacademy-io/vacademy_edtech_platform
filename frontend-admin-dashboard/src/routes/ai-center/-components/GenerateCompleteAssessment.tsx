import { useEffect, useState, useRef } from 'react';
import { FormProvider, useFieldArray, UseFormReturn } from 'react-hook-form';
import { transformQuestionsToGenerateAssessmentAI } from '../-utils/helper';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { getPPTViewTitle } from '@/routes/assessment/question-papers/-utils/helper';
import { QuestionType } from '@/constants/dummy-data';
import { DotsSixVertical, Copy, Trash, DotsThreeVertical } from '@phosphor-icons/react';
import { PPTComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/PPTComponentFactory';
import { Separator } from '@/components/ui/separator';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { z } from 'zod';
import { generateCompleteAssessmentFormSchema } from '../-utils/generate-complete-assessment-schema';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import { Input } from '@/components/ui/input';
import { AIAssessmentResponseInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import ExportQuestionPaperAI from './export-ai-question-paper/ExportQuestionPaperAI';
import { QuestionsFromTextDialog } from '../ai-tools/vsmart-prompt/-components/QuestionsFromTextDialog';
import { QuestionsFromTextData } from '../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { useAICenter } from '../-contexts/useAICenterContext';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useTranslation } from 'react-i18next';
// Infer the form type from the schema
type GenerateCompleteAssessmentFormType = z.infer<typeof generateCompleteAssessmentFormSchema>;

interface GenerateCompleteAssessmentProps {
    form: UseFormReturn<GenerateCompleteAssessmentFormType>;
    openCompleteAssessmentDialog: boolean;
    setOpenCompleteAssessmentDialog: React.Dispatch<React.SetStateAction<boolean>>;
    assessmentData: AIAssessmentResponseInterface | null;
    handleGenerateQuestionsForAssessment: (audioId?: string) => void;
    propmtInput: string;
    setPropmtInput: React.Dispatch<React.SetStateAction<string>>;
    isMoreQuestionsDialog: boolean;
    setIsMoreQuestionsDialog: React.Dispatch<React.SetStateAction<boolean>>;
    numQuestions?: number | null;
    setNumQuestions?: React.Dispatch<React.SetStateAction<number | null>>;
    difficulty?: string | null;
    setDifficulty?: React.Dispatch<React.SetStateAction<string | null>>;
    language?: string | null;
    setLanguage?: React.Dispatch<React.SetStateAction<string | null>>;
    audioId?: string;
    handleSubmitSuccessForText?: (data: QuestionsFromTextData) => void;
    isTextDialog?: boolean;
    submitButtonForText?: JSX.Element;
    handleDisableSubmitBtn?: (value: boolean) => void;
    submitFormFn?: (submitFn: () => void) => void;
    dialogForm?: UseFormReturn<QuestionsFromTextData>;
    keyProp: string | null;
}

const GenerateCompleteAssessment = ({
    form,
    openCompleteAssessmentDialog,
    setOpenCompleteAssessmentDialog,
    assessmentData,
    handleGenerateQuestionsForAssessment,
    propmtInput,
    setPropmtInput,
    isMoreQuestionsDialog,
    setIsMoreQuestionsDialog,
    numQuestions,
    setNumQuestions,
    difficulty,
    setDifficulty,
    language,
    setLanguage,
    audioId,
    submitButtonForText,
    handleSubmitSuccessForText,
    handleDisableSubmitBtn,
    submitFormFn,
    dialogForm,
    keyProp,
}: GenerateCompleteAssessmentProps) => {
    const { t } = useTranslation('aiCenterGenerateCompleteAssessment');
    const { t: tHelper } = useTranslation('aiCenterHelper');
    const { instituteLogo } = useInstituteLogoStore();
    const transformQuestionsData = transformQuestionsToGenerateAssessmentAI(
        assessmentData?.questions,
        tHelper
    );
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const { loader, key: keyContext } = useAICenter();

    const { getValues } = form;

    // UseFieldArray to manage questions array
    const { fields, move, insert, remove } = useFieldArray({
        control: form.control,
        name: 'questions', // Name of the field array
    });

    const contentRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState<string | number>('auto');

    useEffect(() => {
        const updateHeight = () => {
            if (contentRef.current) {
                const scaled = contentRef.current.scrollHeight * 0.28 + 10;
                setContainerHeight(scaled);
            }
        };

        const timeoutId = setTimeout(updateHeight, 100);

        const resizeObserver = new ResizeObserver(() => {
            updateHeight();
        });

        if (contentRef.current) {
            resizeObserver.observe(contentRef.current);
        }

        return () => {
            clearTimeout(timeoutId);
            resizeObserver.disconnect();
        };
    }, [fields]);

    const questions = form.getValues('questions');

    const handlePageClick = (pageIndex: number) => {
        setCurrentQuestionIndex(pageIndex);
        form.trigger();
    };

    useEffect(() => {
        form.reset({
            ...form.getValues(),
            title: assessmentData?.title,
            questions: transformQuestionsData,
        });
    }, []);

    return (
        <>
            <Dialog
                open={openCompleteAssessmentDialog}
                onOpenChange={setOpenCompleteAssessmentDialog}
            >
                <DialogContent className="no-scrollbar !m-0 flex h-full !w-screen !max-w-none flex-col !gap-0 overflow-hidden !rounded-none !p-0 bg-background text-foreground [&>button]:hidden">
                    <FormProvider {...form}>
                        <form className="flex h-full flex-col">
                            {/* Header */}
                            <div className="flex bg-background h-16 w-full items-center justify-between border-b px-6 shadow-sm z-10 shrink-0">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={instituteLogo}
                                            alt={t('header.logoAlt')}
                                            className="size-9 rounded-full border bg-muted object-contain"
                                        />
                                        <span className="text-sm font-bold leading-tight text-foreground/90">
                                            {form.getValues('title')}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {submitFormFn &&
                                        handleSubmitSuccessForText &&
                                        handleDisableSubmitBtn &&
                                        dialogForm ? (
                                        <QuestionsFromTextDialog
                                            form={dialogForm}
                                            open={isMoreQuestionsDialog}
                                            onOpenChange={setIsMoreQuestionsDialog}
                                            trigger={
                                                <MyButton
                                                    type="button"
                                                    scale="small"
                                                    buttonType="secondary"
                                                    className="text-primary hover:text-primary/80"
                                                    onClick={() => {
                                                        setIsMoreQuestionsDialog(true);
                                                    }}
                                                >
                                                    {t('generateMore.triggerButton')}
                                                </MyButton>
                                            }
                                            onSubmitSuccess={handleSubmitSuccessForText}
                                            submitButton={submitButtonForText || <></>}
                                            handleDisableSubmitBtn={handleDisableSubmitBtn}
                                            submitForm={submitFormFn}
                                            taskId={keyProp || ''}
                                        />
                                    ) : (
                                        <Dialog
                                            open={isMoreQuestionsDialog}
                                            onOpenChange={setIsMoreQuestionsDialog}
                                        >
                                            <DialogTrigger asChild>
                                                <MyButton
                                                    type="button"
                                                    scale="small"
                                                    buttonType="secondary"
                                                    className="text-primary hover:text-primary/80"
                                                >
                                                    {t('generateMore.triggerButton')}
                                                </MyButton>
                                            </DialogTrigger>
                                            <DialogContent className="p-0 sm:max-w-md overflow-hidden rounded-lg">
                                                <div className="bg-primary/5 p-4 border-b">
                                                    <h1 className="font-semibold text-primary">
                                                        {t('generateMore.dialogTitle')}
                                                    </h1>
                                                </div>
                                                <div className="flex flex-col gap-4 p-6">
                                                    <Input
                                                        placeholder={t('generateMore.topicsPlaceholder')}
                                                        value={propmtInput}
                                                        onChange={(e) =>
                                                            setPropmtInput(e.target.value)
                                                        }
                                                        className="border-muted-foreground/20"
                                                    />
                                                    {setNumQuestions && (
                                                        <Input
                                                            type="number"
                                                            placeholder={t('generateMore.numQuestionsPlaceholder')}
                                                            value={numQuestions || ''}
                                                            onChange={(e) =>
                                                                setNumQuestions(
                                                                    Number(e.target.value)
                                                                )
                                                            }
                                                            className="border-muted-foreground/20"
                                                        />
                                                    )}
                                                    {setDifficulty && (
                                                        <Input
                                                            placeholder={t('generateMore.difficultyPlaceholder')}
                                                            value={difficulty || ''}
                                                            onChange={(e) =>
                                                                setDifficulty(e.target.value)
                                                            }
                                                            className="border-muted-foreground/20"
                                                        />
                                                    )}
                                                    {setLanguage && (
                                                        <Input
                                                            placeholder={t('generateMore.languagePlaceholder')}
                                                            value={language || ''}
                                                            onChange={(e) =>
                                                                setLanguage(e.target.value)
                                                            }
                                                            className="border-muted-foreground/20"
                                                        />
                                                    )}
                                                    <div className="flex justify-end pt-2">
                                                        {loader && keyContext == keyProp ? (
                                                            <MyButton
                                                                type="button"
                                                                scale="medium"
                                                                buttonType="primary"
                                                                disable
                                                            >
                                                                <DashboardLoader />
                                                            </MyButton>
                                                        ) : (
                                                            <MyButton
                                                                type="button"
                                                                scale="medium"
                                                                buttonType="primary"
                                                                onClick={() =>
                                                                    handleGenerateQuestionsForAssessment(
                                                                        audioId || ''
                                                                    )
                                                                }
                                                            >
                                                                {t('generateMore.submitButton')}
                                                            </MyButton>
                                                        )}
                                                    </div>
                                                </div>
                                            </DialogContent>
                                        </Dialog>
                                    )}

                                    <ExportQuestionPaperAI
                                        responseQuestionsData={assessmentData?.questions}
                                    />
                                    <div className="h-5 w-px bg-border mx-1" />
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="secondary"
                                        className="text-muted-foreground hover:text-foreground md:min-w-20"
                                        onClick={() => {
                                            setNumQuestions && setNumQuestions(null);
                                            setDifficulty && setDifficulty(null);
                                            setLanguage && setLanguage(null);
                                            setOpenCompleteAssessmentDialog(false);
                                        }}
                                    >
                                        {t('closeButton')}
                                    </MyButton>
                                </div>
                            </div>

                            {/* Content Body */}
                            <div className="flex flex-1 overflow-hidden">
                                {/* Sidebar / Slides Strip */}
                                <div className="flex w-56 flex-col border-r bg-muted/5">
                                    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 scrollbar-thin scrollbar-thumb-muted-foreground/20">
                                        <Sortable
                                            value={fields}
                                            onMove={({ activeIndex, overIndex }) =>
                                                move(activeIndex, overIndex)
                                            }
                                        >
                                            <div style={{ height: containerHeight, overflow: 'hidden' }}>
                                                <div ref={contentRef} className="origin-top-left scale-[0.28] w-[350%] flex flex-col gap-6 pb-20"> {/* design-lint-ignore: scale/width pair computed to fit a fixed thumbnail strip container, no fixed token exists */}
                                                    {fields.map((field, index) => {
                                                        const isSelected = currentQuestionIndex === index;
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
                                                                    className={`relative rounded-3xl border-4 p-6 transition-all duration-200 group
                                                                    ${isSelected
                                                                            ? 'border-blue-600 bg-white ring-8 ring-blue-50'
                                                                            : 'border-transparent bg-white shadow-sm hover:shadow-md'
                                                                        }`}
                                                                >
                                                                    <div className="flex flex-col gap-4">
                                                                        <div className="flex items-center justify-between gap-4">
                                                                            <div className="flex items-center gap-4">
                                                                                <h1 className={`text-5xl font-bold ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                                                                                    {index + 1}
                                                                                </h1>
                                                                                <span className="text-3xl font-medium text-gray-500 truncate max-w-96">
                                                                                    {getPPTViewTitle(
                                                                                        getValues(
                                                                                            `questions.${index}.questionType`
                                                                                        ) as QuestionType
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <DropdownMenu>
                                                                                    <DropdownMenuTrigger asChild>
                                                                                        <MyButton
                                                                                            type="button"
                                                                                            scale="large"
                                                                                            buttonType="secondary"
                                                                                            className="size-16 p-0 text-muted-foreground hover:text-foreground"
                                                                                            onClick={(e) => e.stopPropagation()}
                                                                                        >
                                                                                            <DotsThreeVertical className="!size-10" />
                                                                                        </MyButton>
                                                                                    </DropdownMenuTrigger>
                                                                                    <DropdownMenuContent align="end" className="w-56">
                                                                                        <DropdownMenuItem
                                                                                            className="py-3 text-lg"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                insert(index + 1, getValues(`questions.${index}`));
                                                                                            }}
                                                                                        >
                                                                                            <Copy className="mr-3 size-5" />
                                                                                            {t('questionCard.duplicate')}
                                                                                        </DropdownMenuItem>
                                                                                        <DropdownMenuItem
                                                                                            className="py-3 text-lg text-destructive focus:text-destructive"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                remove(index);
                                                                                                if (currentQuestionIndex >= index && currentQuestionIndex > 0) {
                                                                                                    setCurrentQuestionIndex(currentQuestionIndex - 1);
                                                                                                }
                                                                                            }}
                                                                                        >
                                                                                            <Trash className="mr-3 size-5" />
                                                                                            {t('questionCard.delete')}
                                                                                        </DropdownMenuItem>
                                                                                    </DropdownMenuContent>
                                                                                </DropdownMenu>
                                                                                <SortableDragHandle
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="size-16 opacity-50 hover:opacity-100 cursor-grab active:cursor-grabbing"
                                                                                >
                                                                                    <DotsSixVertical className="!size-12" />
                                                                                </SortableDragHandle>
                                                                            </div>
                                                                        </div>
                                                                        <div className="pointer-events-none opacity-90">
                                                                            <PPTComponentFactory
                                                                                key={index}
                                                                                type={
                                                                                    getValues(
                                                                                        `questions.${currentQuestionIndex}.questionType`
                                                                                    ) as QuestionType
                                                                                }
                                                                                props={{
                                                                                    form: form as any,
                                                                                    currentQuestionIndex:
                                                                                        index,
                                                                                    setCurrentQuestionIndex:
                                                                                        setCurrentQuestionIndex,
                                                                                    className:
                                                                                        'relative mt-4 rounded-xl border-2 border-gray-100 bg-white p-0 overflow-hidden',
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </SortableItem>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </Sortable>
                                    </div>
                                </div>

                                <div className="flex-1 h-full w-full bg-muted/10 relative overflow-hidden">
                                    {questions && questions.length === 0 ? (
                                        <div className="flex h-full w-full items-center justify-center">
                                            <h1 className="text-muted-foreground font-medium">{t('noQuestions')}</h1>
                                        </div>
                                    ) : (
                                        <div className="h-full w-full overflow-y-auto p-8">
                                            <div className="mx-auto w-full max-w-5xl rounded-xl bg-background border shadow-sm min-h-[600px] p-10"> {/* design-lint-ignore: 600px canvas min-height has no matching standard scale step (min-h-96=384px too small), pixel-exact value needed for the question preview surface */}
                                                <MainViewComponentFactory
                                                    key={currentQuestionIndex}
                                                    type={
                                                        getValues(
                                                            `questions.${currentQuestionIndex}.questionType`
                                                        ) as QuestionType
                                                    }
                                                    props={{
                                                        form: form as any,
                                                        currentQuestionIndex: currentQuestionIndex,
                                                        setCurrentQuestionIndex: setCurrentQuestionIndex,
                                                        className:
                                                            'flex w-full flex-col gap-6',
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </form>
                    </FormProvider>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default GenerateCompleteAssessment;
