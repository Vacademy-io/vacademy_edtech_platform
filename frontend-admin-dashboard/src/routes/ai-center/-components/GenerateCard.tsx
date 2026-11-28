import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { StarFour, UploadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useAICenter } from '../-contexts/useAICenterContext';
import { buildAIToolPageData } from '../-constants/AIToolPageData';
import { GetImagesForAITools } from '../-helpers/GetImagesForAITools';
import { Separator } from '@/components/ui/separator';
import AITasksList from './AITasksList';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useState } from 'react';
import { buildPromptDummyData } from './Prompt-dummy-data';
import { QuestionsFromTextData } from '../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';

type PromptType = keyof ReturnType<typeof buildPromptDummyData>;

interface GenerateCardProps {
    handleUploadClick: () => void;
    fileInputRef: React.RefObject<HTMLInputElement>;
    handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    cardTitle: string;
    cardDescription: string;
    inputFormat: string;
    keyProp: string | null;
    prompt?: string;
    setPrompt?: React.Dispatch<React.SetStateAction<string>>;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    handleGenerateQuestionsForAssessment?: (
        pdfId?: string,
        prompt?: string,
        taskName?: string,
        taskId?: string
    ) => void;
    pollGenerateQuestionsFromText?: (data: QuestionsFromTextData) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    sectionsForm?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
}
export const GenerateCard = ({
    handleUploadClick,
    fileInputRef,
    handleFileChange,
    inputFormat,
    keyProp,
    prompt,
    setPrompt,
    pollGenerateAssessment,
    handleGenerateQuestionsForAssessment,
    pollGenerateQuestionsFromText,
    pollGenerateQuestionsFromAudio,
    sectionsForm,
    currentSectionIndex,
}: GenerateCardProps) => {
    const [selectedValue, setSelectedValue] = useState<PromptType>('topic');
    const { key: keyContext, loader } = useAICenter();
    const { t } = useTranslation(['aiCenterAIToolPageData', 'aiCenterPromptDummyData']);
    const aiToolPageData = buildAIToolPageData(t);
    const promptDummyData = buildPromptDummyData(t);
    const toolData = keyProp ? aiToolPageData[keyProp] : null;
    return (
        <>
            {toolData && (
                <div className="flex w-full flex-col gap-4 px-4 text-neutral-600 sm:gap-6 sm:px-8">
                    <div className="flex w-fit items-center justify-start gap-2">
                        <div className="flex items-center gap-2 text-xl font-semibold sm:text-h2">
                            <StarFour weight="fill" className="text-primary-500 size-6 sm:size-8" />{' '}
                            {toolData.heading}
                        </div>
                        <AITasksList
                            heading={toolData.heading}
                            pollGenerateAssessment={pollGenerateAssessment}
                            handleGenerateQuestionsForAssessment={
                                handleGenerateQuestionsForAssessment
                            }
                            pollGenerateQuestionsFromText={pollGenerateQuestionsFromText}
                            pollGenerateQuestionsFromAudio={pollGenerateQuestionsFromAudio}
                            sectionsForm={sectionsForm}
                            currentSectionIndex={currentSectionIndex}
                        />
                    </div>
                    <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:gap-4">
                        <div className="scale-90 sm:scale-100">
                            {GetImagesForAITools(toolData.key)}
                        </div>
                        <div className="flex w-full flex-col gap-4 sm:w-auto">
                            {keyProp === 'sortSplitPdf' && (
                                <div className="flex flex-col gap-2">
                                    <h1>
                                        {promptDummyData[selectedValue].heading}
                                        <span className="text-red-500">*</span>
                                    </h1>
                                    <Textarea
                                        placeholder={promptDummyData[selectedValue].description}
                                        className="h-24 w-full"
                                        value={prompt}
                                        onChange={(e) => setPrompt?.(e.target.value)}
                                    />
                                    <RadioGroup
                                        defaultValue="topic"
                                        className="mt-2"
                                        value={selectedValue}
                                        onValueChange={(newValue) =>
                                            setSelectedValue(newValue as PromptType)
                                        }
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="topic" id="r1" />
                                            <Label htmlFor="r1">
                                                Select any topic questions covered
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="pages" id="r2" />
                                            <Label htmlFor="r2">
                                                Select questions from specific pages
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="questionNo" id="r3" />
                                            <Label htmlFor="r3">Select a set of questions</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                            )}
                            {loader && keyContext == keyProp && keyContext != null ? (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="w-full text-sm"
                                    disable
                                >
                                    <div className="flex items-center justify-center">
                                        <div className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                        <span>Uploading...</span>
                                    </div>
                                </MyButton>
                            ) : (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="w-full text-sm sm:w-auto"
                                    onClick={handleUploadClick}
                                    disable={keyContext !== keyProp && loader && keyContext != null}
                                >
                                    <UploadSimple size={32} />
                                    Upload
                                </MyButton>
                            )}
                            <Input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                                accept={inputFormat}
                            />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-lg font-semibold sm:text-h3">How to use {toolData.heading}</p>
                        <p className="text-sm sm:text-subtitle">{toolData.instructionsHeading}</p>
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-6">
                        {toolData.instructions.map((steps, index) => (
                            <div key={index}>
                                <div className="flex gap-2 text-base font-semibold sm:text-title">
                                    <p className="text-primary-500">Step {index + 1}</p>
                                    <p>{steps.stepHeading}</p>
                                </div>
                                <p className="text-sm sm:text-base">{steps.stepSubHeading}</p>
                                <ul className="flex flex-col text-sm sm:text-body">
                                    {steps.steps.map((step, index) => (
                                        <li key={index}>
                                            <p>{step}</p>
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-sm sm:text-base">{steps.stepFooter}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};
