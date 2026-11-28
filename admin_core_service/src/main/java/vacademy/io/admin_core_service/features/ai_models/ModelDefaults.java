package vacademy.io.admin_core_service.features.ai_models;

/**
 * Platform model defaults, used only when ai_model_defaults cannot answer (the row is
 * missing or the database read failed). Same values as ai_service's
 * {@code app/constants/model_defaults.py} - keep the two in step.
 */
public final class ModelDefaults {

    /** Default for every chat-LLM feature (served via Isoquant when llm.model_routes says so). */
    public static final String GLM_DEFAULT = "z-ai/glm-5.3-flash";

    /** The one non-GLM model every chain ends on, so a GLM outage never leaves a feature dark. */
    public static final String NON_GLM_FALLBACK = "google/gemini-2.5-flash";

    private ModelDefaults() {
    }

    /**
     * True for Z.ai GLM models ("z-ai/glm-5.3-flash", "glm-5.3-flash", "z-ai/glm-5.3-flash:batch").
     * They always reason, and the reasoning counts against max_tokens.
     */
    public static boolean isGlm(String modelId) {
        if (modelId == null) {
            return false;
        }
        String id = modelId.trim().toLowerCase();
        int slash = id.indexOf('/');
        if (slash >= 0) {
            id = id.substring(slash + 1);
        }
        return id.startsWith("glm-");
    }
}
