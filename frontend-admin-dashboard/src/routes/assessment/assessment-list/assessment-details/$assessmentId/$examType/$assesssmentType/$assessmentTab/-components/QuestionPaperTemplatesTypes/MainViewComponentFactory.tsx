import React from 'react';
import { SingleCorrectQuestionPaperTemplateMainView } from './MCQ(Single Correct)/SingleCorrectQuestionPaperTemplateMainView';
import { MultipleCorrectQuestionPaperTemplateMainView } from './MCQ(Multiple Correct)/MultipleCorrectQuestionPaperTemplateMainView';
import { SectionQuestionPaperFormProps } from '../../-utils/assessment-question-paper';
import { QuestionType } from '@/constants/dummy-data';
import { NumericQuestionPaperTemplateMainView } from './NumericType/NumericQuestionPaperTemplateMainView';
import { ComprehensiveSingleCorrectQuestionPaperTemplateMainView } from './Comprehensive MCQ(Single Correct)/ComprehensiveSingleCorrectQuestionPaperTemplateMainView';
import { ComprehensiveMultipleCorrectQuestionPaperTemplateMainView } from './Comprehensive MCQ(Multiple Correct)/ComprehensiveMultipleCorrectQuestionPaperTemplateMainView';
import { ComprehensiveNumericQuestionPaperTemplateMainView } from './ComprehensiveNumericType/ComprehensiveNumericQuestionPaperTemplateMainView';
import { OneWordQuestionPaperTemplateMainView } from './OneWordType/OneWordQuestionPaperTemplateMainView';
import { LongAnswerQuestionPaperTemplateMainView } from './LongAnswerType/LongAnswerQuestionPaperTemplateMainView';
import { TrueFalseQuestionPaperTemplateMainView } from './TrueFalse/TrueFalseQuestionPaperTemplateMainView';
import { CodingQuestionPaperTemplateMainView } from './Coding/CodingQuestionPaperTemplateMainView';
import { CbeResponseQuestionPaperTemplateMainView } from './CbeResponse/CbeResponseQuestionPaperTemplateMainView';

type MainViewComponentType = QuestionType;

type MainViewComponent = (props: SectionQuestionPaperFormProps) => React.ReactElement;

const MainViewComponentsMap: Record<MainViewComponentType, MainViewComponent> = {
    MCQS: SingleCorrectQuestionPaperTemplateMainView,
    MCQM: MultipleCorrectQuestionPaperTemplateMainView,
    NUMERIC: NumericQuestionPaperTemplateMainView,
    CMCQS: ComprehensiveSingleCorrectQuestionPaperTemplateMainView,
    CMCQM: ComprehensiveMultipleCorrectQuestionPaperTemplateMainView,
    CNUMERIC: ComprehensiveNumericQuestionPaperTemplateMainView,
    ONE_WORD: OneWordQuestionPaperTemplateMainView,
    LONG_ANSWER: LongAnswerQuestionPaperTemplateMainView,
    TRUE_FALSE: TrueFalseQuestionPaperTemplateMainView,
    CODING: CodingQuestionPaperTemplateMainView,
    CBE_RESPONSE: CbeResponseQuestionPaperTemplateMainView,
};

export const MainViewComponentFactory = (params: {
    type: MainViewComponentType;
    props: SectionQuestionPaperFormProps;
}) => {
    if (params.type && MainViewComponentsMap[params.type]) {
        // Added check for existence in map
        const Component = MainViewComponentsMap[params.type];
        return <Component {...params.props} />;
    }
    // Return null when you don't want to render anything
    return null;
};
