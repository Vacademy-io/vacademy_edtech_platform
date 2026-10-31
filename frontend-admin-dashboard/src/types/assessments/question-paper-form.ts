export interface MyQuestionPaperFormInterface {
    questionPaperId?: string; // Optional string
    isFavourite?: boolean; // Default value: false
    title?: string; // Required string
    createdOn?: Date; // Default value: current date
    yearClass?: string; // Required string
    subject?: string; // Required string
    questionsType?: string; // Required string
    optionsType?: string; // Required string
    answersType?: string; // Required string
    explanationsType?: string; // Required string
    fileUpload?: File; // Optional file
    questions?: MyQuestion[]; // Required array of questions
}

export interface MyQuestion {
    id: string;
    questionId?: string; // Optional string
    questionName: string; // Required string, must have at least 1 character
    explanation?: string; // Optional string
    questionType: string; // Default value: "MCQS"
    questionMark: string; // Required string
    questionPenalty: string;
    /** The paper's section a digitised question was printed under (Vsmart Extract). */
    sectionName?: string;
    tags?: string[];
    level?: string;
    questionDuration: {
        hrs: string;
        min: string;
    };
    singleChoiceOptions: MySingleChoiceOption[]; // Array of single choice options
    multipleChoiceOptions: MyMultipleChoiceOption[]; // Array of multiple choice options
    csingleChoiceOptions: MySingleChoiceOption[]; // Array of single choice options
    cmultipleChoiceOptions: MyMultipleChoiceOption[]; // Array of multiple choice options
    trueFalseOptions: MyMultipleChoiceOption[]; // Array of multiple choice options
    validAnswers?: number[];
    decimals?: number;
    numericType?: string;
    parentRichTextContent?: string | null;
    subjectiveAnswerText?: string;
    timestamp?: string;
    newQuestion?: boolean;
    reattemptCount?: string;
    status?: string;
    canSkip?: boolean;
    // --- Add missing fields for type safety ---
    comprehensionText?: string;
    passage?: string;
    parent_rich_text?: { id?: string; content?: string };
    text?: { id?: string; content?: string };
    text_data?: { id?: string; content?: string };
    parentRichTextId?: string;
    textId?: string;
    textDataId?: string;
    explanation_text?: { id?: string; content?: string };
    explanation_text_data?: { id?: string; content?: string };
    explanationTextId?: string;
    explanationTextDataId?: string;
    questionText?: string;
    codingConfig?: MyCodingConfig;
}

export interface MyCodingTestCase {
    id: string;
    label?: string;
    stdin: string;
    expectedStdout: string;
    // Optional acceptable outputs; pass if output matches any. Absent ⇒
    // [expectedStdout]. acceptedOutputs[0] is kept === expectedStdout.
    acceptedOutputs?: string[];
    visible: boolean;
}

export interface MyCodingConfig {
    problemHtml: string;
    allowedLanguages: string[];
    starterCode: Record<string, string>;
    testCases: MyCodingTestCase[];
    perRunLimits: { cpuSeconds: number; memoryKb: number };
    maxPoints: number;
    sessionTimeMinutes?: number | null;
    evaluationMode: 'AUTO' | 'MANUAL';
}

export interface MySingleChoiceOption {
    id?: string;
    name?: string; // Optional string
    isSelected?: boolean; // Optional boolean
}

export interface MyMultipleChoiceOption {
    id?: string;
    name?: string; // Optional string
    isSelected?: boolean; // Optional boolean
}

export interface MyImage {
    imageId?: string; // Optional string
    imageName?: string; // Optional string
    imageTitle?: string; // Optional string
    imageFile?: string; // Optional string
    isDeleted?: boolean; // Optional boolean
}

export interface MyQuestionPaperFormEditInterface {
    questionPaperId: string | undefined; // Optional string
    title: string; // Required string
    level_id?: string; // Required string
    subject_id?: string; // Required string
    questions: MyQuestion[];
}
