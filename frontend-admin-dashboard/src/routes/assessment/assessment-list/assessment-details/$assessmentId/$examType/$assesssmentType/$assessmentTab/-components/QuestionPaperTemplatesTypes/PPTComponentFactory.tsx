import React from 'react';
import { SingleCorrectQuestionPaperTemplatePPTView } from './MCQ(Single Correct)/SingleCorrectQuestionPaperTemplatePPTView';
import { MultipleCorrectQuestionPaperTemplatePPTView } from './MCQ(Multiple Correct)/MultipleCorrectQuestionPaperTemplatePPTView';
import { SectionQuestionPaperFormProps } from '../../-utils/assessment-question-paper';
import { NumericQuestionPaperTemplatePPTView } from './NumericType/NumericQuestionPaperTemplatePPTView';
import { QuestionType } from '@/constants/dummy-data';
import { ComprehensiveMultipleCorrectQuestionPaperTemplatePPTView } from './Comprehensive MCQ(Multiple Correct)/ComprehensiveMultipleCorrectQuestionPaperTemplatePPTView';
import { ComprehensiveNumericQuestionPaperTemplatePPTView } from './ComprehensiveNumericType/ComprehensiveNumericQuestionPaperTemplatePPTView';
import { OneWordQuestionPaperTemplatePPTView } from './OneWordType/OneWordQuestionPaperTemplatePPTView';
import { LongAnswerQuestionPaperTemplatePPTView } from './LongAnswerType/LongAnswerQuestionPaperTemplatePPTView';
import { TrueFalseQuestionPaperTemplatePPTView } from './TrueFalse/TrueFalseQuestionPaperTemplatePPTView';
import { CodingQuestionPaperTemplatePPTView } from './Coding/CodingQuestionPaperTemplatePPTView';
import { CbeResponseQuestionPaperTemplatePPTView } from './CbeResponse/CbeResponseQuestionPaperTemplatePPTView';

type PPTComponentType = QuestionType;

type PPTComponent = (props: SectionQuestionPaperFormProps) => React.ReactElement;

const PPTComponentsMap: Record<PPTComponentType, PPTComponent> = {
    MCQS: SingleCorrectQuestionPaperTemplatePPTView,
    MCQM: MultipleCorrectQuestionPaperTemplatePPTView,
    NUMERIC: NumericQuestionPaperTemplatePPTView,
    CMCQS: SingleCorrectQuestionPaperTemplatePPTView,
    CMCQM: ComprehensiveMultipleCorrectQuestionPaperTemplatePPTView,
    CNUMERIC: ComprehensiveNumericQuestionPaperTemplatePPTView,
    ONE_WORD: OneWordQuestionPaperTemplatePPTView,
    LONG_ANSWER: LongAnswerQuestionPaperTemplatePPTView,
    TRUE_FALSE: TrueFalseQuestionPaperTemplatePPTView,
    CODING: CodingQuestionPaperTemplatePPTView,
    CBE_RESPONSE: CbeResponseQuestionPaperTemplatePPTView,
};

export const PPTComponentFactory = (params: {
    type: PPTComponentType;
    props: SectionQuestionPaperFormProps;
}) => {
    const Component = PPTComponentsMap[params.type];
    return <Component {...params.props} />;
};
