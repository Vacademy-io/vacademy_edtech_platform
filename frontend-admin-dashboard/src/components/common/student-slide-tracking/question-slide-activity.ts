/**
 * Readable text for the question-slide rows of the Activity Stats dialog: the learner's
 * response and the slide's correct answer, without the editor HTML they are stored in.
 */
import { htmlToPlainText } from '@/components/cbe/types';

type OptionLike = { id?: string | null; name?: string | null; isSelected?: boolean };
type RawOption = { id?: string | null; text?: { content?: string | null } | null };

/** The question as the slide editor holds it (form shape) or as the backend sends it (raw). */
type QuestionLike = {
    questionType?: string;
    singleChoiceOptions?: OptionLike[];
    multipleChoiceOptions?: OptionLike[];
    csingleChoiceOptions?: OptionLike[];
    cmultipleChoiceOptions?: OptionLike[];
    trueFalseOptions?: OptionLike[];
    validAnswers?: (number | string)[];
    subjectiveAnswerText?: string;
    question_type?: string;
    auto_evaluation_json?: string | null;
    options?: RawOption[];
};

const OPTION_KEYS: Record<string, keyof QuestionLike> = {
    MCQS: 'singleChoiceOptions',
    MCQM: 'multipleChoiceOptions',
    CMCQS: 'csingleChoiceOptions',
    CMCQM: 'cmultipleChoiceOptions',
    TRUE_FALSE: 'trueFalseOptions',
};

const TRUE_FALSE_LABELS = ['True', 'False'];

const parseJson = (value: string | null | undefined): unknown => {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const optionLabel = (name: string | null | undefined, index: number, type: string): string => {
    const text = htmlToPlainText(name ?? '');
    if (type === 'TRUE_FALSE') {
        if (/^true$/i.test(text)) return 'True';
        if (/^false$/i.test(text)) return 'False';
        return text || TRUE_FALSE_LABELS[index] || '';
    }
    return text;
};

const fromFormShape = (q: QuestionLike, type: string): string => {
    const key = OPTION_KEYS[type];
    if (key) {
        const options = (q[key] as OptionLike[] | undefined) ?? [];
        return options
            .map((opt, index) => (opt?.isSelected ? optionLabel(opt.name, index, type) : ''))
            .filter(Boolean)
            .join(', ');
    }
    if (type === 'NUMERIC' || type === 'CNUMERIC') {
        return (q.validAnswers ?? []).map(String).join(', ');
    }
    if (type === 'ONE_WORD' || type === 'LONG_ANSWER') {
        return htmlToPlainText(q.subjectiveAnswerText ?? '');
    }
    return '';
};

const fromRawShape = (q: QuestionLike, type: string): string => {
    const key = parseJson(q.auto_evaluation_json) as {
        data?: {
            correctOptionIds?: (string | number)[];
            validAnswers?: (string | number)[];
            answer?: string | { content?: string };
        };
    } | null;
    const data = key?.data;
    if (!data) return '';
    if (OPTION_KEYS[type]) {
        const options = q.options ?? [];
        return (data.correctOptionIds ?? [])
            .map((id) => {
                const byId = options.findIndex((o) => o?.id === String(id));
                const index =
                    byId >= 0 ? byId : /^\d+$/.test(String(id)) ? Number(id) : -1;
                const option = options[index];
                return option ? optionLabel(option.text?.content, index, type) : '';
            })
            .filter(Boolean)
            .join(', ');
    }
    if (type === 'NUMERIC' || type === 'CNUMERIC') {
        return (data.validAnswers ?? []).map(String).join(', ');
    }
    const answer = typeof data.answer === 'string' ? data.answer : data.answer?.content;
    return htmlToPlainText(answer ?? '');
};

/** The slide's correct answer as plain text; '' when it has none (or it cannot be read). */
export function questionSlideCorrectAnswer(question: unknown): string {
    if (!question || typeof question !== 'object') return '';
    const q = question as QuestionLike;
    if (q.questionType) return fromFormShape(q, q.questionType);
    if (q.question_type) return fromRawShape(q, q.question_type);
    return '';
}

/** What the learner submitted, as plain text (option labels joined, or the typed answer). */
export function questionSlideResponseText(responseJson: string | null | undefined): string {
    const parsed = parseJson(responseJson) as {
        selectedOptions?: { id?: string; name?: string }[];
    } | null;
    return (parsed?.selectedOptions ?? [])
        .map((option) => htmlToPlainText(option?.name ?? option?.id ?? ''))
        .filter(Boolean)
        .join(', ');
}

/** The question text of a stored response, as plain text. */
export function questionSlideQuestionName(responseJson: string | null | undefined): string {
    const parsed = parseJson(responseJson) as { questionName?: string } | null;
    return parsed?.questionName ?? '';
}
