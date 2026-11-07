import {
    MCQS,
    MCQM,
    Numerical,
    TrueFalse,
    // Match,
    LongAnswer,
    SingleWord,
    CMCQS,
    CMCQM,
    // CompTrueFalse,
    // CompLongAnswer,
    // CompSingleWord,
} from '@/svgs';
import {
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { QuestionPaperUpload } from './QuestionPaperUpload';
import { Code, X } from '@phosphor-icons/react';
import useDialogStore from '../-global-states/question-paper-dialogue-close';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QuestionType as QuestionTypeList } from '@/constants/dummy-data';
import {
    QuestionTypeProps,
    QuestionPaperHeadingInterface,
} from '@/types/assessments/question-type-types';

export function QuestionTypeSelection({
    currentQuestionIndex,
    setCurrentQuestionIndex,
    isDirectAdd = true,
    handleSelect,
}: QuestionPaperHeadingInterface) {
    const { t } = useTranslation('assessmentQuestionTypeSelection');
    const { setIsManualQuestionPaperDialogOpen } = useDialogStore();
    const [questionType, setQuestionType] = useState<QuestionTypeList>(QuestionTypeList.MCQS);
    console.log(questionType);
    const CodingIcon = (
        <div className="flex size-10 items-center justify-center rounded-md bg-orange-100">
            <Code size={22} className="text-orange-500" weight="bold" />
        </div>
    );
    const QuestionType: React.FC<QuestionTypeProps> = ({
        icon,
        text,
        type = QuestionTypeList.MCQS,
    }) => {
        return (
            <div
                className="w-full"
                onClick={() => {
                    if (isDirectAdd) {
                        setQuestionType(type);
                    } else if (handleSelect) {
                        handleSelect(type);
                    }
                }}
            >
                {isDirectAdd ? (
                    <AlertDialogTrigger className="w-full">
                        <div className="flex w-full cursor-pointer flex-row items-center gap-4 rounded-md border px-4 py-3">
                            {icon}
                            <div className="text-body">{text}</div>
                        </div>
                    </AlertDialogTrigger>
                ) : (
                    <div className="flex w-full cursor-pointer flex-row items-center gap-4 rounded-md border px-4 py-3">
                        {icon}
                        <div className="text-body">{text}</div>
                    </div>
                )}
            </div>
        );
    };
    return (
        <div className="flex flex-col gap-6 p-6">
            <>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.quickAccess')}</div>
                    <QuestionType
                        icon={<MCQS />}
                        text={t('questionTypes.mcqSingle')}
                        type={QuestionTypeList.MCQS}
                    ></QuestionType>
                    <QuestionType
                        icon={<MCQM />}
                        text={t('questionTypes.mcqMultiple')}
                        type={QuestionTypeList.MCQM}
                    ></QuestionType>
                    <QuestionType
                        icon={<Numerical />}
                        text={t('questionTypes.numerical')}
                        type={QuestionTypeList.NUMERIC}
                    ></QuestionType>
                    <QuestionType
                        type={QuestionTypeList.TRUE_FALSE}
                        icon={<TrueFalse />}
                        text={t('questionTypes.trueFalse')}
                    ></QuestionType>
                    <QuestionType
                        type={QuestionTypeList.CODING}
                        icon={CodingIcon}
                        text={t('questionTypes.coding')}
                    ></QuestionType>
                </div>
                <div className="border"></div>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.programming')}</div>
                    <QuestionType
                        type={QuestionTypeList.CODING}
                        icon={CodingIcon}
                        text={t('questionTypes.coding')}
                    ></QuestionType>
                </div>
                <div className="border"></div>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.optionBased')}</div>
                    <QuestionType
                        icon={<MCQS />}
                        text={t('questionTypes.mcqSingle')}
                        type={QuestionTypeList.MCQS}
                    ></QuestionType>
                    <QuestionType
                        icon={<MCQM />}
                        text={t('questionTypes.mcqMultiple')}
                        type={QuestionTypeList.MCQM}
                    ></QuestionType>
                    {/* <QuestionType icon={<TrueFalse />} text="True False"></QuestionType> */}
                    {/* <QuestionType icon={<Match />} text="Match the Collunm"></QuestionType> */}
                </div>
                <div className="border"></div>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.mathBased')}</div>
                    <QuestionType
                        icon={<Numerical />}
                        text={t('questionTypes.numerical')}
                        type={QuestionTypeList.NUMERIC}
                    ></QuestionType>
                </div>
                <div className="border"></div>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.writingSkills')}</div>
                    <QuestionType
                        icon={<LongAnswer />}
                        type={QuestionTypeList.LONG_ANSWER}
                        text={t('questionTypes.longAnswer')}
                    ></QuestionType>
                    <QuestionType
                        icon={<SingleWord />}
                        type={QuestionTypeList.ONE_WORD}
                        text={t('questionTypes.singleWord')}
                    ></QuestionType>
                </div>
                <div className="border"></div>
                <div className="flex flex-col gap-4">
                    <div className="text-subtitle font-semibold">{t('sections.readingSkills')}</div>
                    <QuestionType
                        icon={<CMCQS />}
                        text={t('questionTypes.comprehensionMcqSingle')}
                        type={QuestionTypeList.CMCQS}
                    ></QuestionType>
                    <QuestionType
                        icon={<CMCQM />}
                        text={t('questionTypes.comprehensionMcqMultiple')}
                        type={QuestionTypeList.CMCQM}
                    ></QuestionType>
                    <QuestionType
                        icon={<CMCQM />}
                        text={t('questionTypes.comprehensionNumeric')}
                        type={QuestionTypeList.CNUMERIC}
                    ></QuestionType>
                    {/* <QuestionType
                        icon={<CompTrueFalse />}
                        text="Comprehension True False"
                    ></QuestionType>
                    <QuestionType
                        icon={<CompLongAnswer />}
                        text="Comprehension Long Answer"
                    ></QuestionType>
                    <QuestionType
                        icon={<CompSingleWord />}
                        text="Comprehension Single Word"
                    ></QuestionType> */}
                </div>
            </>
            {isDirectAdd && (
                <AlertDialogContent className="p-0">
                    <div className="flex items-center justify-between rounded-md bg-primary-50">
                        <h1 className="rounded-sm p-4 font-bold text-primary-500">
                            {t('dialog.title')}
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
            )}
        </div>
    );
}
