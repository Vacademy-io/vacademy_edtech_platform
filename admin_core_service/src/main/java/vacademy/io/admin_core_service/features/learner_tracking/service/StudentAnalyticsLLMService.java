package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import vacademy.io.admin_core_service.features.ai_models.service.AIModelRegistryService;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service to analyze student activity data using LLM
 * Implements fallback mechanism with model priority
 */
@Slf4j
@Service
public class StudentAnalyticsLLMService {

        private static final int RESPONSE_TIMEOUT_SECONDS = 120;

        private static final int MAX_RETRIES_PER_MODEL = 2;

        /**
         * Hard ceiling on generated tokens.
         *
         * Sized from what the insight schema actually needs: successful completions
         * measured in prod ran 6,338-10,754 tokens per activity log (sonnet-4.5 6,338,
         * minimax-m3 9,478, gemini-2.5-pro 10,754). An earlier 2,000 cap truncated the
         * JSON mid-object, so parseResponse threw "Unexpected end-of-input", the chain
         * fell through to the fallback model, and BOTH models were billed for every log
         * while nothing completed. Keep meaningful headroom above the observed maximum -
         * a truncated response costs full price and yields nothing.
         */
        private static final int MAX_COMPLETION_TOKENS = 12000;

        private final ObjectMapper objectMapper;
        private final AiTokenUsageService aiTokenUsageService;
        private final AIModelRegistryService aiModelRegistryService;
        private final CreditClient creditClient;
        private final LlmGatewayRouter gatewayRouter;

        public StudentAnalyticsLLMService(
                        ObjectMapper objectMapper,
                        AiTokenUsageService aiTokenUsageService,
                        AIModelRegistryService aiModelRegistryService,
                        CreditClient creditClient,
                        LlmGatewayRouter gatewayRouter) {
                this.objectMapper = objectMapper;
                this.aiTokenUsageService = aiTokenUsageService;
                this.aiModelRegistryService = aiModelRegistryService;
                this.creditClient = creditClient;
                this.gatewayRouter = gatewayRouter;
        }

        /**
         * Generate student insights from raw activity data
         * Implements fallback mechanism across multiple models
         * 
         * @param rawJson      The raw JSON string containing student submission data
         * @param activityType Type of activity (quiz, question, assignment, assessment)
         * @param instituteId  Institute that owns the activity, for usage attribution
         *                     and credit deduction. May be null when it cannot be
         *                     resolved, in which case the spend stays unattributed.
         * @param userId       Learner the activity belongs to. May be null.
         * @return Mono containing the processed insights as JsonNode
         */
        public Mono<JsonNode> generateStudentInsights(String rawJson, String activityType,
                        String instituteId, String userId) {
                String prompt = createStudentAnalysisPrompt(rawJson, activityType);

                List<String> modelPriority = aiModelRegistryService.getModelPriority("analytics");
                if (modelPriority == null || modelPriority.isEmpty()) {
                        log.error("[LLM-Analytics] No AI models available for the analytics use case.");
                        return Mono.error(new RuntimeException("No AI models available for generating student insights."));
                }

                log.debug("[LLM-Analytics] Model priority size: {}, ActivityType: {}, PromptChars: {}, InstituteId: {}",
                                modelPriority.size(), activityType, prompt.length(), instituteId);

                // Try each model in priority order with retries
                return tryModelsWithFallback(prompt, modelPriority, 0, instituteId, userId);
        }

        /**
         * The model the next analytics call will most likely use. Exposed so callers can
         * run an affordability check against the right price point before building a
         * prompt, without needing the model registry themselves.
         *
         * @return the highest-priority analytics model, or null if none are configured
         */
        public String getPrimaryAnalyticsModel() {
                List<String> modelPriority = aiModelRegistryService.getModelPriority("analytics");
                return (modelPriority == null || modelPriority.isEmpty()) ? null : modelPriority.get(0);
        }

        /**
         * Recursively try models with fallback logic
         *
         * @param prompt     The prompt to send to LLM
         * @param modelIndex Current model index in priority list
         * @return Mono containing the insights or error
         */
        private Mono<JsonNode> tryModelsWithFallback(String prompt, List<String> modelPriority, int modelIndex,
                        String instituteId, String userId) {
                if (modelIndex >= modelPriority.size()) {
                        log.error("All LLM models failed after retries. Tried: {}", modelPriority);
                        return Mono.error(new RuntimeException("All LLM models failed. Tried: " + modelPriority));
                }

                String currentModel = modelPriority.get(modelIndex);

                log.debug("[LLM-Analytics] Trying model {}/{}: {}",
                                modelIndex + 1, modelPriority.size(), currentModel);

                return generateWithModel(prompt, currentModel, instituteId, userId)
                                .retryWhen(Retry.fixedDelay(MAX_RETRIES_PER_MODEL, Duration.ofSeconds(2))
                                                .filter(StudentAnalyticsLLMService::isRetryable)
                                                .doBeforeRetry(signal -> log.warn(
                                                                "Retry {}/{} for model: {}",
                                                                signal.totalRetries() + 1, MAX_RETRIES_PER_MODEL,
                                                                currentModel))
                                                .onRetryExhaustedThrow((spec, signal) -> {
                                                        log.error("Model {} exhausted retries ({})",
                                                                        currentModel, MAX_RETRIES_PER_MODEL);
                                                        return signal.failure();
                                                }))
                                .onErrorResume(error -> {
                                        log.warn("Model {} failed: {}. Trying next model...",
                                                        currentModel, error.getMessage());
                                        return tryModelsWithFallback(prompt, modelPriority, modelIndex + 1,
                                                        instituteId, userId);
                                });
        }

        /**
         * Only retry failures that a retry could plausibly fix.
         *
         * The chain previously retried everything, so a 402 (out of credit) or a 404
         * (model id does not exist) burned three attempts per model across the whole
         * priority list - 42 requests for a single activity log, none of which could
         * ever have succeeded. 429 and 5xx are genuinely transient and still retry.
         */
        private static boolean isRetryable(Throwable error) {
                if (error instanceof WebClientResponseException webError) {
                        int status = webError.getStatusCode().value();
                        if (status == 429) {
                                return true;
                        }
                        return status < 400 || status >= 500;
                }
                // Timeouts and connection resets are transient.
                return true;
        }

        /**
         * Generate insights with specific model
         */
        private Mono<JsonNode> generateWithModel(String prompt, String model, String instituteId, String userId) {
                Map<String, Object> payload = Map.of(
                                "model", model,
                                "messages", List.of(
                                                Map.of("role", "system", "content",
                                                                "You are an expert educational data analyst specializing in student performance analysis. "
                                                                                + "You analyze student submission data and provide actionable insights in strict JSON format."),
                                                Map.of("role", "user", "content", prompt)),
                                "max_tokens", MAX_COMPLETION_TOKENS,
                                "response_format", Map.of("type", "json_object"));

                // The router picks the gateway per attempt (Isoquant for routed models, one
                // OpenRouter try when it fails) and adds GLM reasoning headroom + effort low.
                // Deferred inside, so every retry re-resolves the route and honours a cooldown.
                return Mono.defer(() -> {
                        long requestStart = System.nanoTime();
                        return gatewayRouter.callModel(model, payload, Duration.ofSeconds(RESPONSE_TIMEOUT_SECONDS), null)
                                        .doOnSubscribe(sub -> log.debug("[LLM-Analytics] POST model={} payloadChars={}",
                                                        model, prompt.length()))
                                        .doOnNext(response -> {
                                                long durationMs = Duration.ofNanos(System.nanoTime() - requestStart).toMillis();
                                                log.info("[LLM-Analytics] Response received model={} in {} ms, size={} chars",
                                                                model, durationMs, response.length());
                                                // Recorded and charged under the registry id - that is what ai_models prices.
                                                logTokenUsage(response, model, instituteId, userId);
                                        })
                                        .doOnError(error -> {
                                                long durationMs = Duration.ofNanos(System.nanoTime() - requestStart).toMillis();
                                                log.warn("[LLM-Analytics] Request failed model={} after {} ms: {}",
                                                                model, durationMs, error.getMessage());
                                        });
                })
                                .flatMap(response -> parseResponse(response, model));
        }

        /**
         * Record token usage against the owning institute and charge it.
         *
         * Both calls are @Async so neither the DB write nor the ai_service HTTP round
         * trip runs on the Reactor event loop, and both swallow their own failures -
         * billing must never break analytics processing.
         */
        /** ai_usage_event use case for these charges (ai_use_case_catalog key). */
        static final String USE_CASE_LEARNER_ANALYTICS = "learner_analytics";

        private void logTokenUsage(String responseBody, String model, String instituteId, String userId) {
                try {
                        JsonNode root = objectMapper.readTree(responseBody);
                        JsonNode usage = root.get("usage");

                        if (usage != null) {
                                int promptTokens = usage.has("prompt_tokens") ? usage.get("prompt_tokens").asInt() : 0;
                                int completionTokens = usage.has("completion_tokens")
                                                ? usage.get("completion_tokens").asInt()
                                                : 0;

                                aiTokenUsageService.recordUsageAsync(
                                                ApiProvider.OPENAI,
                                                RequestType.ANALYTICS,
                                                model,
                                                promptTokens,
                                                completionTokens,
                                                toUuidOrNull(instituteId),
                                                toUuidOrNull(userId));

                                if (instituteId != null && !instituteId.isBlank()) {
                                        // usage_log_id is intentionally null: the ai_token_usage row above is
                                        // written asynchronously, so its id is not available here, and
                                        // ai_service would otherwise try to link a row it cannot yet see.
                                        // Metering only: the learner rides in usage_context, so the
                                        // ledger row stays exactly as before (no user, no subject).
                                        creditClient.deductCreditsAsync(
                                                        instituteId,
                                                        RequestType.ANALYTICS.getValue(),
                                                        model,
                                                        promptTokens,
                                                        completionTokens,
                                                        null,
                                                        MeteringFields.system(USE_CASE_LEARNER_ANALYTICS)
                                                                        .subjectUserId(userId)
                                                                        .build());
                                } else {
                                        log.warn("[LLM-Analytics] No institute resolved for model={} - "
                                                        + "{} tokens recorded unattributed and NOT charged",
                                                        model, promptTokens + completionTokens);
                                }
                        }
                } catch (Exception e) {
                        log.warn("Failed to log token usage: {}", e.getMessage());
                }
        }

        /**
         * ai_token_usage stores institute_id/user_id as UUIDs while activity_log and
         * the enriched raw JSON carry them as strings. A malformed value must not sink
         * the usage record, so it degrades to null (unattributed) instead of throwing.
         */
        private static UUID toUuidOrNull(String value) {
                if (value == null || value.isBlank()) {
                        return null;
                }
                try {
                        return UUID.fromString(value.trim());
                } catch (IllegalArgumentException e) {
                        log.warn("[LLM-Analytics] Not a valid UUID, recording as unattributed: {}", value);
                        return null;
                }
        }

        private String createStudentAnalysisPrompt(String rawJson, String activityType) {
                return """
                                Analyze the following student assessment submission and generate comprehensive AI-powered insights.

                                Activity Type: """
                                + activityType
                                + """


                                                Student Submission Data (includes question details, marks, class comparison):
                                                """
                                + rawJson
                                + """


                                                Generate a JSON response with ALL of the following sections:

                                                {
                                                  "performance_analysis": "One paragraph of 60-110 words, to the student: overall performance, strongest and weakest areas, time usage, comparison with class if class_context is available",

                                                  "strengths": { "topic_name": 90 },
                                                  "weaknesses": { "topic_name": 30 },

                                                  "areas_of_improvement": "Markdown bullet list of 3-5 specific areas",

                                                  "improvement_path": "Markdown step-by-step study plan with topics, practice recommendations, time estimates",

                                                  "flashcards": [
                                                    { "front": "Concept the student got wrong", "back": "Clear explanation" }
                                                  ],

                                                  "confidence_estimation": {
                                                    "overall_confidence": 78,
                                                    "high_confidence_correct": 15,
                                                    "high_confidence_wrong": 2,
                                                    "low_confidence_correct": 3,
                                                    "guessed_correct": 5,
                                                    "insight": "1-2 sentences about student's confidence patterns"
                                                  },

                                                  "topic_analysis": [
                                                    {
                                                      "topic": "Inferred topic name from question content",
                                                      "questions_count": 5,
                                                      "correct": 4,
                                                      "accuracy": 80,
                                                      "avg_time_seconds": 52,
                                                      "mastery_level": "Expert|Proficient|Developing|Beginner"
                                                    }
                                                  ],

                                                  "misconception_analysis": [
                                                    {
                                                      "question_summary": "Brief question description",
                                                      "student_answer": "What student chose",
                                                      "correct_answer": "What was correct",
                                                      "misconception": "Why the student got it wrong — the underlying conceptual error",
                                                      "remediation": "Specific advice to fix this misconception"
                                                    }
                                                  ],

                                                  "blooms_taxonomy": {
                                                    "remember": { "total": 5, "correct": 5 },
                                                    "understand": { "total": 8, "correct": 6 },
                                                    "apply": { "total": 7, "correct": 4 },
                                                    "analyze": { "total": 5, "correct": 2 },
                                                    "evaluate": { "total": 3, "correct": 1 },
                                                    "create": { "total": 2, "correct": 0 }
                                                  },

                                                  "behavioral_insights": {
                                                    "time_management": "Analysis of how student allocated time across questions",
                                                    "difficulty_response": "How student performed across easy/medium/hard questions",
                                                    "fatigue_indicator": "Whether accuracy dropped in later questions",
                                                    "skip_pattern": "Analysis of skipped questions or very fast responses"
                                                  },

                                                  "recommended_learning_path": [
                                                    {
                                                      "priority": 1,
                                                      "topic": "Topic name",
                                                      "current_level": "Beginner|Developing|Proficient",
                                                      "target_level": "Proficient|Expert",
                                                      "suggestion": "Specific actionable study advice",
                                                      "estimated_time": "45 minutes"
                                                    }
                                                  ]
                                                }

                                                GUIDELINES:
                                                1. TOPICS: Infer topic names from question text content. Group similar questions under the same topic.
                                                2. CONFIDENCE: Estimate from time_taken + difficulty + correctness. Fast correct = high confidence. Slow wrong = low confidence. Very fast wrong = likely guessed.
                                                3. BLOOM'S TAXONOMY: Classify each question into a cognitive level based on question wording:
                                                   - Remember: recall facts (define, list, name)
                                                   - Understand: explain concepts (describe, explain, summarize)
                                                   - Apply: use in new situations (calculate, solve, demonstrate)
                                                   - Analyze: break down (compare, contrast, differentiate)
                                                   - Evaluate: justify decisions (evaluate, judge, critique)
                                                   - Create: produce new work (design, construct, formulate)
                                                4. MISCONCEPTIONS: Only for INCORRECT questions. Explain the specific conceptual error, not just "wrong answer."
                                                5. BEHAVIORAL: Use time_taken per question data. Look for patterns (rushing, fatigue, difficulty avoidance).
                                                6. COMPARISON: If class_context is present, reference rank/percentile/class averages in performance_analysis.
                                                7. FLASHCARDS: 5-10 cards focusing on concepts from wrong/partial answers.
                                                8. LEARNING PATH: 3-5 steps ordered by priority (weakest topics first). Give estimated_time in minutes, e.g. "45 minutes".
                                                9. VOICE: The student reads this report, often with a parent. Write every narrative field
                                                   (performance_analysis, insight, behavioral_insights, misconception, remediation, suggestion,
                                                   areas_of_improvement, improvement_path, flashcard backs) to the student in the second person
                                                   ("you", "your"), never "the student". Use their first name at most once, at the start of
                                                   performance_analysis, if a name is in the data. Short, plain sentences a Class 5 to 12 student
                                                   understands; encouraging but honest; no jargon such as "metadata" or "accuracy calculation".

                                                CORRECTNESS: The per-question "status" field is the source of truth. Never re-grade a
                                                question yourself from the options or the answer text.
                                                  - CORRECT / PARTIAL_CORRECT / INCORRECT: graded, count them as they stand.
                                                  - SKIPPED: the learner did not answer. Count it as unattempted, not as a wrong answer.
                                                  - PENDING: not evaluated yet (free text awaiting a teacher, or an assignment not yet
                                                    marked). Exclude it from accuracy counts entirely and do not assume it was wrong.
                                                Use "correct_answer" where present when explaining a misconception; do not guess what
                                                the right answer was when that field is absent.

                                                GROUNDING: Every statement must be supported by the submission data above. Where the data
                                                cannot support a section, return an empty object or array for it rather than a
                                                plausible-sounding guess - an assignment submission carries no per-question responses, so
                                                there is nothing there to classify by Bloom's level, estimate confidence from, or build a
                                                topic breakdown out of. Never invent a question, topic, score, answer or time that does
                                                not appear above. A short report grounded in the data is correct; a complete-looking one
                                                built on assumptions is not.

                                                Return ONLY valid JSON. No markdown outside JSON strings.
                                                """;
        }

        private Mono<JsonNode> parseResponse(String responseBody, String model) {
                try {
                        JsonNode root = objectMapper.readTree(responseBody);
                        JsonNode contentNode = root.path("choices").path(0).path("message").path("content");

                        if (contentNode.isMissingNode()) {
                                return Mono.error(new RuntimeException("Invalid response from LLM: No content found"));
                        }

                        String contentString = contentNode.asText();

                        // Clean up if wrapped in markdown code blocks
                        if (contentString.startsWith("```json")) {
                                contentString = contentString.replace("```json", "").replace("```", "").trim();
                        } else if (contentString.startsWith("```")) {
                                contentString = contentString.replace("```", "").trim();
                        }

                        JsonNode parsedContent = objectMapper.readTree(contentString);
                        return Mono.just(parsedContent);

                } catch (Exception e) {
                        log.error("Error parsing LLM response from model {}: {}", model, e.getMessage());
                        return Mono.error(new RuntimeException("Failed to parse LLM response: " + e.getMessage(), e));
                }
        }
}
