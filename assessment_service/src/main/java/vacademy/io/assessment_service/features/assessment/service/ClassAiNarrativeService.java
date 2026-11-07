package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * The ONE model call behind the class AI report: turns a compact facts blob
 * into the prose a teacher actually reads — an overall assessment of the paper,
 * a prioritised action plan, and per-topic teaching guidance.
 *
 * <p><b>What is deliberately NOT sent.</b> Not the roster (one row per learner
 * tells the model nothing the score bands do not), and never the raw
 * per-learner analyses — at 6-10k tokens each, 250 of them is over a million
 * tokens. {@link ClassAiInsightsAggregator} exists precisely so the model gets
 * counted facts instead. The payload is therefore constant in cohort size:
 * the same for 20 learners as for 563.
 *
 * <p><b>Why the explicit cap and the finish_reason check.</b> admin_core has a
 * documented incident where a completion cap truncated the JSON mid-object,
 * parsing threw, the chain fell through to a fallback model, and BOTH models
 * were billed while nothing completed. A truncated response costs full price
 * and yields nothing, so it is treated as a hard failure and never retried.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClassAiNarrativeService {

    /**
     * Above admin_core's measured 6,338-10,754-token real completions, with room
     * to spare. The point is that a cap EXISTS — the sibling grading client sets
     * none at all, so it truncates at whatever the provider's silent default is.
     */
    private static final int MAX_COMPLETION_TOKENS = 12000;
    private static final int RESPONSE_TIMEOUT_SECONDS = 120;
    /** Keeps one enormous question stem from crowding out the rest of the paper. */
    private static final int MAX_STEM_CHARS = 180;

    /** ai_service model-registry use case for this report. */
    static final String USE_CASE = "class_report";
    /** The model the legacy direct path used before the registry; kept for that path only. */
    static final String LEGACY_MODEL = "google/gemini-2.5-pro";
    private static final String SYSTEM_PROMPT =
            "You are an experienced head of department writing to the teacher who "
                    + "will teach this class next. Be specific and grounded in the "
                    + "figures given. Never invent a number, a topic or a student.";

    private final ObjectMapper objectMapper;
    private final AiServiceLlmClient aiServiceLlmClient;

    @Value("${openrouter.api.key:}")
    private String openRouterApiKey;

    /**
     * Optional override. Blank (the default) = ai_service picks the model from the
     * {@code class_report} row of {@code ai_model_defaults}. Set = this model is called
     * directly on OpenRouter, as before the registry.
     */
    @Value("${assessment.class-ai-report.model:}")
    private String modelOverride;

    public record Narrative(String json, String model) {
    }

    /** {@link #generate(Map, String, String)} without an institute to attribute usage to. */
    public Narrative generate(Map<String, Object> facts, String assessmentName) {
        return generate(facts, assessmentName, null);
    }

    /**
     * @param facts       the aggregated class facts — counts, section/topic accuracy,
     *                    hardest questions, Bloom's, shared misconceptions
     * @param instituteId attributes ai_service's token-usage row; credits are still
     *                    charged by the caller, never by ai_service
     * @throws VacademyException on truncation, an unparseable body, or transport
     *                           failure. The caller has already claimed the row,
     *                           so a failure must surface rather than be retried
     *                           into a second paid call.
     */
    public Narrative generate(Map<String, Object> facts, String assessmentName, String instituteId) {
        String prompt = buildPrompt(facts, assessmentName);
        List<Map<String, String>> messages = List.of(
                Map.of("role", "system", "content", SYSTEM_PROMPT),
                Map.of("role", "user", "content", prompt));

        if (modelOverride != null && !modelOverride.isBlank()) {
            return generateDirect(messages, modelOverride.trim(), assessmentName, prompt.length());
        }

        log.info("Class AI report: prompt {} chars, use case {}", prompt.length(), USE_CASE);
        AiServiceLlmClient.Completion completion;
        try {
            completion = aiServiceLlmClient.complete(USE_CASE, messages, true, MAX_COMPLETION_TOKENS,
                    "low", instituteId, Duration.ofSeconds(RESPONSE_TIMEOUT_SECONDS));
        } catch (AiServiceLlmClient.PolicyRefusalException e) {
            // Refused by policy (AI usage limit / plan): no model ran, and the direct call
            // must not run it unbilled. Terminal; the teacher sees the limit's own message.
            log.info("Class AI report: refused by policy for '{}' ({}): {}", assessmentName, e.getCode(),
                    e.getMessage());
            throw new VacademyException(e.getMessage());
        } catch (AiServiceLlmClient.UnavailableException e) {
            // No model ran (token unset, endpoint not deployed yet, ai_service down):
            // the old direct call cannot double-bill anything.
            log.warn("Class AI report: ai_service model registry unavailable ({}); using {} directly",
                    e.getMessage(), LEGACY_MODEL);
            return generateDirect(messages, LEGACY_MODEL, assessmentName, prompt.length());
        } catch (AiServiceLlmClient.CompletionException e) {
            // No retry: the row is claimed and a retry after a truncation is how
            // the admin_core incident billed twice.
            log.error("Class AI report: model call failed for '{}': {}", assessmentName, e.getMessage());
            if (e.getMessage() != null && e.getMessage().contains("truncated")) {
                throw new VacademyException("The AI analysis came back incomplete. Please try again.");
            }
            throw new VacademyException("The AI analysis could not be generated. Please try again.");
        }
        String model = completion.model() != null ? completion.model() : USE_CASE;
        return new Narrative(assertParses(completion.content(), assessmentName), model);
    }

    /** The pre-registry path: one direct OpenRouter call with an explicit model. */
    private Narrative generateDirect(List<Map<String, String>> messages, String model, String assessmentName,
                                     int promptChars) {
        if (openRouterApiKey == null || openRouterApiKey.isBlank()) {
            throw new VacademyException("AI is not configured for this environment");
        }
        log.info("Class AI report: prompt {} chars, model {} (direct)", promptChars, model);

        Map<String, Object> payload = Map.of(
                "model", model,
                "max_tokens", MAX_COMPLETION_TOKENS,
                "messages", messages,
                "response_format", Map.of("type", "json_object"));

        WebClient client = WebClient.builder()
                .baseUrl("https://openrouter.ai")
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + openRouterApiKey)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader("HTTP-Referer", "https://vacademy.io")
                .defaultHeader("X-Title", "Vacademy Class Assessment Report")
                .build();

        JsonNode root;
        try {
            String body = client.post()
                    .uri("/api/v1/chat/completions")
                    .bodyValue(payload)
                    .retrieve()
                    .bodyToMono(String.class)
                    // No retry. The row is already claimed and a retry after a
                    // truncation is how the admin_core incident billed twice.
                    .block(Duration.ofSeconds(RESPONSE_TIMEOUT_SECONDS));
            root = objectMapper.readTree(body);
        } catch (Exception e) {
            log.error("Class AI report: model call failed for '{}': {}", assessmentName, e.getMessage());
            throw new VacademyException("The AI analysis could not be generated. Please try again.");
        }

        JsonNode choice = root.path("choices").path(0);
        String finishReason = choice.path("finish_reason").asText("");
        if ("length".equalsIgnoreCase(finishReason)) {
            // Truncated output is unparseable AND already paid for. Fail loudly
            // rather than retrying into a second charge.
            log.error("Class AI report: response truncated at the {}-token cap for '{}'",
                    MAX_COMPLETION_TOKENS, assessmentName);
            throw new VacademyException("The AI analysis came back incomplete. Please try again.");
        }

        String content = choice.path("message").path("content").asText("");
        if (content.isBlank()) {
            throw new VacademyException("The AI analysis came back empty. Please try again.");
        }
        return new Narrative(assertParses(content, assessmentName), model);
    }

    /** Assert it parses BEFORE the caller persists and charges. */
    private String assertParses(String content, String assessmentName) {
        String json = stripFence(content);
        try {
            objectMapper.readTree(json);
        } catch (Exception e) {
            log.error("Class AI report: unparseable JSON for '{}': {}", assessmentName, e.getMessage());
            throw new VacademyException("The AI analysis could not be read. Please try again.");
        }
        return json;
    }

    /** GLM sometimes wraps json_object output in a ```json fence. */
    static String stripFence(String content) {
        String t = content.trim();
        if (t.startsWith("```")) {
            t = t.replaceFirst("^```(?:json|JSON)?\\s*", "");
            if (t.endsWith("```")) t = t.substring(0, t.length() - 3);
            t = t.trim();
        }
        return t;
    }

    private String buildPrompt(Map<String, Object> facts, String assessmentName) {
        String factsJson;
        try {
            factsJson = objectMapper.writeValueAsString(facts);
        } catch (Exception e) {
            throw new VacademyException("Could not assemble the assessment facts");
        }
        return """
                Write a class-level analysis of this assessment for the teacher who will teach
                this class next.

                Assessment: %s

                These are COUNTED facts from the real results. Treat every number as given —
                do not recompute, contradict or invent any.

                %s

                Return JSON with exactly these keys:

                {
                  "performance_analysis": "2-3 paragraphs on how the class performed: where the
                     marks went, whether the weakness is concentrated or spread, and what the
                     distribution says about the paper itself.",

                  "blooms_reading": "1-2 sentences on what the cognitive profile means for
                     teaching — recall versus application versus reasoning.",

                  "areas_of_improvement": "Markdown bullet list of 3-5 specific areas, each tied
                     to a figure above.",

                  "action_plan": [
                    {
                      "priority": 1,
                      "topic": "Topic name taken from the facts above",
                      "suggestion": "What to reteach and how, in 1-2 sentences. Be concrete —
                         name the method, not just the topic.",
                      "estimated_time": "e.g. 2 lessons + 1 practice set",
                      "affected_students": 21
                    }
                  ],

                  "topic_guidance": [
                    { "topic": "Topic name", "advice": "One line a teacher can act on." }
                  ]
                }

                GUIDELINES
                1. Order the action plan by how many marks it would recover across the cohort —
                   a large weak section outranks a small catastrophic one.
                2. Prefer the misconceptions listed above when explaining WHY the class lost
                   marks; they are the highest-yield thing to reteach.
                3. If a section of the facts is empty, say nothing about it rather than guessing.
                4. Keep the whole response under 900 words.
                """.formatted(assessmentName, factsJson);
    }

    /** Trims a question stem for the facts blob. */
    public static String shortStem(String text) {
        if (text == null) return "";
        String t = text.replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").trim();
        return t.length() <= MAX_STEM_CHARS ? t : t.substring(0, MAX_STEM_CHARS - 1) + "…";
    }
}
