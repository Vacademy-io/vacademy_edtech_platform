export const QUESTION_TYPES = [
    { code: 'MCQS', display: 'Multiple Choice (Single)' },
    { code: 'MCQM', display: 'Multiple Choice (Multiple)' },
    { code: 'NUMERIC', display: 'Numeric Answer' },
    { code: 'CMCQS', display: 'Comprehensive Multiple Choice (Single)' },
    { code: 'CMCQM', display: 'Comprehensive Multiple Choice (Multiple)' },
    { code: 'CNUMERIC', display: 'Comprehensive Numeric Answer' },
    { code: 'ONE_WORD', display: 'One Word Answer' },
    { code: 'LONG_ANSWER', display: 'Long Answer Type Question' },
    { code: 'TRUE_FALSE', display: 'True of false type Question' },
    { code: 'CODING', display: 'Coding Question' },
    { code: 'CBE_RESPONSE', display: 'Spreadsheet & Written Response' },
];

export enum QuestionType {
    MCQS = 'MCQS',
    MCQM = 'MCQM',
    NUMERIC = 'NUMERIC',
    CMCQS = 'CMCQS',
    CMCQM = 'CMCQM',
    CNUMERIC = 'CNUMERIC',
    ONE_WORD = 'ONE_WORD',
    LONG_ANSWER = 'LONG_ANSWER',
    TRUE_FALSE = 'TRUE_FALSE',
    CODING = 'CODING',
    CBE_RESPONSE = 'CBE_RESPONSE',
}

export const NUMERIC_TYPES = [
    'SINGLE_DIGIT_NON_NEGATIVE_INTEGER', // 0 - 9 integers
    'INTEGER', // positive and negative integers
    'POSITIVE_INTEGER', // all positive integers
    'DECIMAL',
];

export const QUESTION_LABELS = ['(1.)', '1.)', '(1)', '1)'];
export const OPTIONS_LABELS = ['(a.)', 'a.)', '(a)', 'a)', '(A.)', 'A.)', '(A)', 'A)'];
export const ANSWER_LABELS = ['Ans:', 'Answer:', 'Ans.', 'Answer.'];
export const EXPLANATION_LABELS = ['Exp:', 'Explanation:', 'Exp.', 'Explanation.'];

export const scheduleTestTabsData = [
    {
        value: 'liveTests',
        message: 'No tests are currently live.',
        data: [],
    },
    {
        value: 'upcomingTests',
        message: 'No upcoming tests scheduled.',
        data: [],
    },
    {
        value: 'previousTests',
        message: 'No previous tests available.',
        data: [],
    },
    {
        value: 'draftTests',
        message: 'No draft tests available.',
        data: [],
    },
];

export const timeLimit = ['1 min', '2 min', '3 min', '5 min', '10 min', '15 min'];
export const languageSupport: [string, string] = ['ENGLISH', 'HINDI'];
export const teachingMethod = [
    'Concept-First – Introduce the core idea before diving into details',
    'Storytelling – Explain concepts through engaging narratives',
    'Problem-Solution – Present a problem first, then explain how to solve it',
    'Question-Led – Guide the lecture by asking thought-provoking questions',
    'Step-by-Step Tutorial – Break concepts into clear, sequential steps',
    'Gamified – Include quiz-style or game-based explanation format',
    'Case-Based Learning – Teach using detailed case studies',
];

export const EvaluationType = ['Auto', 'Manual', 'PDF', 'VIDEO'];

export const InstituteType = ['Coaching Institute', 'School', 'University', 'Corporate'];

export const RoleType = [
    { id: '1', name: 'ADMIN' },
    { id: '2', name: 'CONTENT CREATOR' },
    { id: '3', name: 'ASSESSMENT CREATOR' },
    { id: '4', name: 'EVALUATOR' },
    { id: '5', name: 'TEACHER' },
    { id: '6', name: 'STUDENT' },
];

export const RoleTypeExceptStudent = [
    { id: '1', name: 'ADMIN' },
    { id: '2', name: 'CONTENT CREATOR' },
    { id: '3', name: 'ASSESSMENT CREATOR' },
    { id: '4', name: 'EVALUATOR' },
    { id: '5', name: 'TEACHER' },
];

export const RoleTypeUserStatus = [
    { id: '1', name: 'ACTIVE' },
    { id: '2', name: 'DISABLED' },
];

export const BulkActionDropdownStudentSubmissionsList = [
    'Provide Reattempt',
    'Revaluate',
    'Release Result',
];

export const QUIZ_LANGUAGES = [
    { value: 'ENGLISH', label: 'English' },
    { value: 'HINDI', label: 'Hindi' },
    { value: 'FRENCH', label: 'French' },
    { value: 'SPANISH', label: 'Spanish' },
    { value: 'ARABIC', label: 'Arabic' },
    { value: 'TAMIL', label: 'Tamil' },
    { value: 'BENGALI', label: 'Bengali' },
    { value: 'KANNADA', label: 'Kannada' },
];
