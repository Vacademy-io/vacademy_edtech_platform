import { ArrowRight } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { languageSupport } from '@/constants/dummy-data';

/** The namespace this component's own strings live under — used by external
 *  callers of `buildQuestionPrompt` whose bound `t` defaults to a different
 *  namespace, so we always resolve these keys against this one explicitly. */
const NAMESPACE = 'aiCenterQuestionConfigPanel';

export const QUESTION_TYPES = ['MCQ', 'True/False', 'Numeric', 'Short answer', 'Mixed'];
export const DIFFICULTY_LEVELS = ['Easy', 'Medium', 'Hard'];
export const NUM_PRESETS = ['5', '10', '20'];

/** Enum value → translation key, for display only. The enum values above stay
 *  as-is since they're used for state equality and are embedded in prompts. */
const QUESTION_TYPE_LABEL_KEYS: Record<string, string> = {
    MCQ: 'questionTypeMcq',
    'True/False': 'questionTypeTrueFalse',
    Numeric: 'questionTypeNumeric',
    'Short answer': 'questionTypeShortAnswer',
    Mixed: 'questionTypeMixed',
};

const DIFFICULTY_LABEL_KEYS: Record<string, string> = {
    Easy: 'difficultyEasy',
    Medium: 'difficultyMedium',
    Hard: 'difficultyHard',
};

const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    ENGLISH: 'languageEnglish',
    HINDI: 'languageHindi',
};

/**
 * Builds the AI prompt fragment describing the requested question config.
 * Exported and called from several ai-center tool files, each bound to its
 * own default namespace — so every lookup here pins `ns` explicitly to this
 * component's namespace rather than relying on the caller's default. Callers
 * must include this namespace in their own `useTranslation([...])` array so
 * it's loaded before this runs.
 */
export const buildQuestionPrompt = (
    t: TFunction,
    num: string,
    type: string,
    difficulty: string,
    lang: string
): string => {
    const langLabelKey = LANGUAGE_LABEL_KEYS[lang];
    const langLabel = langLabelKey ? t(langLabelKey, { ns: NAMESPACE }) : lang;

    const typeLabelKey = QUESTION_TYPE_LABEL_KEYS[type];
    const translatedType = typeLabelKey ? t(typeLabelKey, { ns: NAMESPACE }) : type;

    const count = Number(num) || 0;
    const typeText =
        type === 'Mixed'
            ? t('promptVariousTypeQuestions', { ns: NAMESPACE, count })
            : t('promptTypedQuestions', { ns: NAMESPACE, count, type: translatedType });

    const difficultyLabelKey = DIFFICULTY_LABEL_KEYS[difficulty];
    const translatedDifficulty = difficultyLabelKey
        ? t(difficultyLabelKey, { ns: NAMESPACE })
        : difficulty;

    return t('promptTemplate', {
        ns: NAMESPACE,
        count,
        typeText,
        language: langLabel,
        difficulty: translatedDifficulty,
    });
};

type Props = {
    numQuestions: string;
    setNumQuestions: (v: string) => void;
    questionType: string;
    setQuestionType: (v: string) => void;
    difficulty: string;
    setDifficulty: (v: string) => void;
    language: string;
    setLanguage: (v: string) => void;
    onSubmit: () => void;
    title?: string;
    subtitle?: string;
    ctaLabel?: string;
    secondary?: { label: string; onClick: () => void };
};

export const QuestionConfigPanel = ({
    numQuestions,
    setNumQuestions,
    questionType,
    setQuestionType,
    difficulty,
    setDifficulty,
    language,
    setLanguage,
    onSubmit,
    title,
    subtitle,
    ctaLabel,
    secondary,
}: Props) => {
    const { t } = useTranslation(NAMESPACE);
    const canSubmit = numQuestions !== '' && Number(numQuestions) >= 1;
    const resolvedTitle = title ?? t('defaultTitle');
    const resolvedSubtitle = subtitle ?? t('defaultSubtitle');
    const resolvedCtaLabel = ctaLabel ?? t('defaultCtaLabel');

    return (
        <div className="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-5">
            <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-gray-900">{resolvedTitle}</h3>
                <p className="text-xs text-neutral-500">{resolvedSubtitle}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-neutral-600">
                        {t('howManyLabel')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                        {NUM_PRESETS.map((n) => (
                            <button
                                key={n}
                                type="button"
                                onClick={() => setNumQuestions(n)}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    numQuestions === n
                                        ? 'border-primary-300 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                }`}
                            >
                                {n}
                            </button>
                        ))}
                        <input
                            value={numQuestions}
                            onChange={(e) =>
                                setNumQuestions(e.target.value.replace(/\D/g, ''))
                            }
                            inputMode="numeric"
                            placeholder={t('customPlaceholder')}
                            className="w-20 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-center text-xs focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-neutral-600">
                        {t('difficultyLabel')}
                    </label>
                    <div className="flex gap-1.5">
                        {DIFFICULTY_LEVELS.map((d) => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => setDifficulty(d)}
                                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    difficulty === d
                                        ? 'border-primary-300 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                }`}
                            >
                                {DIFFICULTY_LABEL_KEYS[d] ? t(DIFFICULTY_LABEL_KEYS[d]) : d}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-neutral-600">
                        {t('questionTypeLabel')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                        {QUESTION_TYPES.map((q) => (
                            <button
                                key={q}
                                type="button"
                                onClick={() => setQuestionType(q)}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    questionType === q
                                        ? 'border-primary-300 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                }`}
                            >
                                {QUESTION_TYPE_LABEL_KEYS[q] ? t(QUESTION_TYPE_LABEL_KEYS[q]) : q}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-neutral-600">
                        {t('languageLabel')}
                    </label>
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    >
                        {languageSupport.map((lang) => (
                            <option key={lang} value={lang}>
                                {LANGUAGE_LABEL_KEYS[lang]
                                    ? t(LANGUAGE_LABEL_KEYS[lang])
                                    : lang.charAt(0) + lang.slice(1).toLowerCase()}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center">
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={!canSubmit}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                    {resolvedCtaLabel}
                    <ArrowRight size={16} weight="bold" />
                </button>
                {secondary && (
                    <button
                        type="button"
                        onClick={secondary.onClick}
                        className="text-sm font-medium text-primary-500 transition-colors hover:text-primary-600"
                    >
                        {secondary.label}
                    </button>
                )}
            </div>
        </div>
    );
};
