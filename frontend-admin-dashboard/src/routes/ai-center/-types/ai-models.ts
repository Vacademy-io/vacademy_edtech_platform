// AI Model Types for model selection feature
import type { TFunction } from 'i18next';

/** The namespace this file's own strings live under — used so callers whose
 *  bound `t` defaults to a different namespace (e.g. student-attempt-dropdown.tsx,
 *  default ns `assessmentStudentAttemptDropdown`) still resolve these keys
 *  correctly. Callers must include this namespace in their own
 *  `useTranslation([...])` array so it's loaded before this runs. */
const NAMESPACE = 'aiCenterAiModels';

/**
 * The model AI copy evaluation uses unless a teacher deliberately picks another.
 *
 * There is exactly one right place for this value. It used to be defaulted in
 * three drifted places at once — this picker (`google/gemini-3.1-pro-preview`,
 * $2/$12 per M), the trigger service (`mistralai/devstral-2512:free`, a coding
 * model) and the Python grader — and because the picker always sends
 * `preferred_model`, its ultra-tier default silently overrode the pipeline's
 * own. One 10-question copy was billed 133.62 credits (₹124.27) against a
 * 10-credit floor, ~90% of it invisible reasoning tokens.
 *
 * `z-ai/glm-5.3-flash` is $0.075/$0.25 per M, reads handwriting (the copy-check
 * pipeline re-reads every page with it), and is the same default the grader
 * uses server-side, so picking nothing and picking this agree.
 *
 * The pickers no longer SEND this by default: they start on
 * PLATFORM_DEFAULT_MODEL and omit `preferred_model`, so the super-admin's
 * "evaluation" use-case default (ai_model_defaults) decides. This stays as
 * the label key for GLM and the fallback the grader itself uses.
 */
export const DEFAULT_EVALUATION_MODEL = 'z-ai/glm-5.3-flash';

/**
 * Picker value meaning "send no preferred_model; the platform default for the
 * evaluation use case applies". Not a model id — never send it to the API
 * (use toPreferredModel). Radix Select forbids an empty-string item value,
 * hence a sentinel.
 */
export const PLATFORM_DEFAULT_MODEL = '__platform_default__';

/** Picker value -> the preferred_model to send (undefined = platform default). */
export const toPreferredModel = (pickerValue: string | null | undefined): string | undefined =>
    pickerValue && pickerValue !== PLATFORM_DEFAULT_MODEL ? pickerValue : undefined;

/**
 * Models a teacher may pick explicitly for copy evaluation, in display order.
 * `google/gemini-3-pro-preview` is gone: it is inactive in the model registry.
 * The picker also hides any of these the live registry list (active models
 * only) does not contain, once that list has loaded.
 */
export const EVALUATION_PICKER_MODEL_IDS: readonly string[] = [
    DEFAULT_EVALUATION_MODEL,
    'anthropic/claude-opus-4.5',
    'google/gemini-3.1-pro-preview',
    'openai/gpt-5.4',
];

/**
 * The explicit choices to show: EVALUATION_PICKER_MODEL_IDS filtered to the
 * registry's active models. `activeModelIds` undefined (still loading, or the
 * registry call failed) keeps the static list, so the picker never empties.
 */
export const pickableEvaluationModels = (activeModelIds?: ReadonlySet<string>): string[] =>
    EVALUATION_PICKER_MODEL_IDS.filter((id) => !activeModelIds || activeModelIds.has(id));

export interface ModelInfo {
    id: string;
    name: string;
    description: string;
    isDefault?: boolean;
}

/**
 * Build display name mappings for AI models.
 * Model names/providers are proper nouns and stay consistent across locales;
 * `t` is threaded through so this stays translation-ready and consistent
 * with the rest of the ai-center i18n rollout.
 */
export const buildModelDisplayNames = (
    t: TFunction
): Record<string, { name: string; description: string }> => ({
    [DEFAULT_EVALUATION_MODEL]: {
        name: t('models.glm53Flash.name', { ns: NAMESPACE }),
        description: t('models.glm53Flash.description', { ns: NAMESPACE }),
    },
    'anthropic/claude-opus-4.5': {
        name: t('models.claudeOpus45.name', { ns: NAMESPACE }),
        description: t('models.claudeOpus45.description', { ns: NAMESPACE }),
    },
    'google/gemini-3-pro-preview': {
        name: t('models.gemini3ProPreview.name', { ns: NAMESPACE }),
        description: t('models.gemini3ProPreview.description', { ns: NAMESPACE }),
    },
    'google/gemini-3.1-pro-preview': {
        name: t('models.gemini31ProPreview.name', { ns: NAMESPACE }),
        description: t('models.gemini31ProPreview.description', { ns: NAMESPACE }),
    },
    'openai/gpt-5.4': {
        name: t('models.gpt54.name', { ns: NAMESPACE }),
        description: t('models.gpt54.description', { ns: NAMESPACE }),
    },
});

/**
 * Get display info for a model ID
 */
export const getModelDisplayInfo = (modelId: string, t: TFunction): ModelInfo => {
    const displayInfo = buildModelDisplayNames(t)[modelId];
    if (displayInfo) {
        return {
            id: modelId,
            name: displayInfo.name,
            description: displayInfo.description,
        };
    }
    // Fallback for unknown models - extract name from ID
    const parts = modelId.split('/');
    const name = parts.length > 1 ? parts[1] : modelId;
    const formattedName = name
        ? name.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
        : modelId;
    return {
        id: modelId,
        name: formattedName,
        description: t('fallbackDescription', { ns: NAMESPACE }),
    };
};
