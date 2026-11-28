package vacademy.io.admin_core_service.features.student_analysis.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.student_analysis.dto.StudentAnalysisData;
import vacademy.io.admin_core_service.features.student_analysis.dto.StudentReportData;
import vacademy.io.admin_core_service.features.student_analysis.entity.UserLinkedData;
import vacademy.io.admin_core_service.features.student_analysis.repository.UserLinkedDataRepository;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import vacademy.io.admin_core_service.features.ai_models.service.AIModelRegistryService;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;

/**
 * Service to generate student analysis reports using LLM
 * Fixed memory leaks with proper connection pooling
 * Implements fallback mechanism with model priority
 */
@Slf4j
@Service
public class StudentReportLLMService {

        /** GLM reasons before it writes; a full report at effort low needs more than 60 s. */
        private static final int RESPONSE_TIMEOUT_SECONDS = 120;

        private static final int MAX_RETRIES_PER_MODEL = 2;

        private final ObjectMapper objectMapper;
        private final UserLinkedDataRepository userLinkedDataRepository;
        private final AiTokenUsageService aiTokenUsageService;
        private final AIModelRegistryService aiModelRegistryService;
        private final CreditClient creditClient;
        private final LlmGatewayRouter gatewayRouter;

        public StudentReportLLMService(
                        ObjectMapper objectMapper,
                        UserLinkedDataRepository userLinkedDataRepository,
                        AiTokenUsageService aiTokenUsageService,
                        AIModelRegistryService aiModelRegistryService,
                        CreditClient creditClient,
                        LlmGatewayRouter gatewayRouter) {
                this.objectMapper = objectMapper;
                this.userLinkedDataRepository = userLinkedDataRepository;
                this.aiTokenUsageService = aiTokenUsageService;
                this.aiModelRegistryService = aiModelRegistryService;
                this.creditClient = creditClient;
                this.gatewayRouter = gatewayRouter;
        }

        /**
         * Generate comprehensive student report from aggregated data
         * Implements fallback mechanism across multiple models
         */
        public Mono<StudentReportData> generateStudentReport(StudentAnalysisData data, String instituteId) {
                log.info("[Student-Report-LLM] Generating report for date range: {} to {}",
                                data.getStartDateIso(), data.getEndDateIso());

                // Fetch existing user-linked data
                List<UserLinkedData> existingData = userLinkedDataRepository.findByUserId(data.getUserId());

                String prompt = createStudentReportPrompt(data, existingData);

                List<String> modelPriority = aiModelRegistryService.getModelPriority("analytics");
                if (modelPriority == null || modelPriority.isEmpty()) {
                        log.error("[Student-Report-LLM] No AI models available for the analytics use case.");
                        return Mono.error(new RuntimeException("No AI models available for generating student reports."));
                }

                // Try each model in priority order with retries
                return tryModelsWithFallback(prompt, modelPriority, 0, data.getUserId(), instituteId);
        }

        /**
         * Recursively try models with fallback logic
         * 
         * @param prompt     The prompt to send to LLM
         * @param modelPriority List of prioritized model ids
         * @param modelIndex Current model index in priority list
         * @param userId     The user ID for the report
         * @return Mono containing the report or error
         */
        private Mono<StudentReportData> tryModelsWithFallback(String prompt, List<String> modelPriority, int modelIndex, String userId, String instituteId) {
                if (modelIndex >= modelPriority.size()) {
                        log.error("[Student-Report-LLM] All models failed after retries");
                        return Mono.error(new RuntimeException("All LLM models failed. Tried: " + modelPriority));
                }

                String currentModel = modelPriority.get(modelIndex);

                return generateWithModel(prompt, currentModel, userId, instituteId)
                                .retryWhen(Retry.fixedDelay(MAX_RETRIES_PER_MODEL, Duration.ofSeconds(2))
                                                .doBeforeRetry(signal -> log.warn(
                                                                "[Student-Report-LLM] Retry {}/{} for model: {}",
                                                                signal.totalRetries() + 1, MAX_RETRIES_PER_MODEL,
                                                                currentModel))
                                                .onRetryExhaustedThrow((spec, signal) -> {
                                                        log.error("[Student-Report-LLM] Model {} exhausted retries ({})",
                                                                        currentModel, MAX_RETRIES_PER_MODEL);
                                                        return signal.failure();
                                                }))
                                .onErrorResume(error -> {
                                        log.error("[Student-Report-LLM] Model {} failed: {}. Trying next model...",
                                                        currentModel, error.getMessage());
                                        return tryModelsWithFallback(prompt, modelPriority, modelIndex + 1, userId, instituteId);
                                });
        }

        /**
         * Generate report with specific model
         */
        private Mono<StudentReportData> generateWithModel(String prompt, String model, String userId, String instituteId) {
                Map<String, Object> payload = Map.of(
                                "model", model,
                                "messages", List.of(
                                                Map.of("role", "system", "content",
                                                                "You are an expert educational analyst specializing in comprehensive student performance evaluation. "
                                                                                +
                                                                                "You analyze student activity data, learning patterns, and engagement metrics to provide detailed insights in strict JSON format."),
                                                Map.of("role", "user", "content", prompt)),
                                "response_format", Map.of("type", "json_object"));

                // Isoquant for routed models (one OpenRouter try on a gateway failure), GLM
                // reasoning headroom + effort low. Usage stays under the registry id.
                return gatewayRouter.callModel(model, payload, Duration.ofSeconds(RESPONSE_TIMEOUT_SECONDS), null)
                                .doOnNext(response -> logTokenUsage(response, model, userId, instituteId))
                                .flatMap(response -> parseResponse(response, model, userId));
        }

        /**
         * Log token usage from API response
         */
        private void logTokenUsage(String responseBody, String model, String userId, String instituteId) {
                try {
                        JsonNode root = objectMapper.readTree(responseBody);
                        JsonNode usage = root.get("usage");

                        if (usage != null) {
                                int promptTokens = usage.has("prompt_tokens") ? usage.get("prompt_tokens").asInt() : 0;
                                int completionTokens = usage.has("completion_tokens")
                                                ? usage.get("completion_tokens").asInt()
                                                : 0;

                                UUID userUuid = null;
                                try {
                                        if (userId != null) {
                                                userUuid = UUID.fromString(userId);
                                        }
                                } catch (IllegalArgumentException e) {
                                        // userId is not a valid UUID, leave as null
                                }
                                UUID instituteUuid = null;
                                try {
                                        if (instituteId != null) {
                                                instituteUuid = UUID.fromString(instituteId);
                                        }
                                } catch (IllegalArgumentException e) {
                                        // instituteId is not a valid UUID, leave as null
                                }

                                aiTokenUsageService.recordUsageAsync(
                                                ApiProvider.OPENAI,
                                                RequestType.ANALYTICS,
                                                model,
                                                promptTokens,
                                                completionTokens,
                                                instituteUuid,
                                                userUuid);

                                if (instituteId != null && !instituteId.isBlank()) {
                                        // Metering only: the learner rides in usage_context, so the
                                        // ledger row stays exactly as before (no user, no subject).
                                        creditClient.deductCreditsAsync(
                                                        instituteId, "analytics", model,
                                                        promptTokens, completionTokens, null,
                                                        MeteringFields.system("student_report")
                                                                        .subjectUserId(userId)
                                                                        .build());
                                }
                        }
                } catch (Exception e) {
                        log.warn("[Student-Report-LLM] Failed to log token usage: {}", e.getMessage());
                }
        }

        private String createStudentReportPrompt(StudentAnalysisData data, List<UserLinkedData> existingData) {
                return String.format(
                                """
                                                Analyze the following comprehensive student data and generate a detailed performance report.

                                                        **Date Range:** %s to %s

                                                        **Login Activity:**
                                                        - Total Logins: %d
                                                        - Last Login: %s
                                                        - Average Session Duration: %.1f minutes
                                                        - Total Active Time: %d minutes (%.1f hours)

                                                        **Processed Activity Insights (Last 5):**
                                                        %s

                                                        **Learning Operations Summary:**
                                                        %s

                                                        **Existing Strengths and Weaknesses:**
                                                        %s

                                                        Generate a JSON response with the following structure.

                                                        **CRITICAL FORMATTING INSTRUCTION:** The string values inside the JSON must be **Rich Markdown**. To ensure the UI renders this correctly, you must:
                                                        1. Use **Double Newlines (`\n\n`)** before every Header (`###`), Table, and List. This is mandatory for headers to render with correct sizing.
                                                        2. Use **Level 3 Headers (`###`)** for section titles inside the text to create a distinct visual hierarchy.
                                                        3. Ensure Tables have valid Markdown syntax with clear column definitions.

                                                        {
                                                          "learning_frequency": "Rich Markdown analysis. Use `### Learning Patterns` as a header. Use tables for session patterns.",
                                                          "progress": "Rich Markdown analysis. User `### Key Trends`as header. Use comparison tables (Previous vs Current).",
                                                          "student_efforts": "Rich Markdown summary. Use `### Efforts` as a header. Must include a table: `| Activity 📚 | Time ⏱️ | Status ✅ |`.",
                                                          "topics_of_improvement": "Rich Markdown list. Use `### Improvements` as a header. Use bullet points.",
                                                          "topics_of_degradation": "Rich Markdown list. Use `### Need Attention` as a header. Use warning emojis (⚠️).",
                                                          "remedial_points": "Rich Markdown checklist. Use `### Immediate Actions` and `### Long-term Goals` headers. Use `- [ ]` for items.",
                                                          "strengths": {
                                                            "Topic Name 1": 85,
                                                            "Topic Name 2": 90
                                                          },
                                                          "weaknesses": {
                                                            "Topic Name 1": 35,
                                                            "Topic Name 2": 42
                                                          }
                                                        }

                                                        **Important Guidelines:**

                                                        **1. Visual Hierarchy & Spacing (Crucial):**
                                                           - **Headers:** Always use `###` for headers. **ALWAYS** put `\n\n` before a header.
                                                           - **Tables:** ensure the table syntax is correct (e.g., `|---|---|`). Put `\n\n` before the table starts.
                                                           - **Spacing:** Do not create dense walls of text. Use newlines generously to separate ideas.

                                                        **2. Visual Presentation:**
                                                           - **Tables:** Use Markdown tables for comparing data (e.g., Time spent vs. Output).
                                                           - **Emojis:** Use relevant emojis (🎯, 💡, ✅, 📉) to break up text and add visual cues.
                                                           - **Styling:** Use **Bold** for key metrics.

                                                        **3. Content Logic:**
                                                           - **Learning Frequency:** Focus on consistency and gaps.
                                                           - **Progress:** Specific data points (e.g., 'Score increased by 15%%').
                                                           - **Topics:** Extract from activity data. 70-100 = Strength, 0-50 = Weakness/Degradation.
                                                           - **Remedial Points:** 5-10 actionable items in a checklist format.

                                                        **4. Strengths/Weaknesses (Data Structure):**
                                                           - **Consolidation:** Update existing scores if topics match. Merge similar topics.
                                                           - **Naming:** Strict **Title Case** (e.g., 'Newtonian Physics'). Meaningful academic topics only.
                                                           - **No Duplicates.**

                                                        **General Rules:**
                                                           - Base analysis on actual data.
                                                           - All fields must be populated; no empty strings.
                                                           - Be data-driven but easy to read.
                                                           - **Return ONLY valid JSON.**
                                                                                                        """,
                                data.getStartDateIso(),
                                data.getEndDateIso(),
                                data.getTotalLogins(),
                                data.getLastLoginTime() != null ? data.getLastLoginTime() : "No data",
                                data.getAvgSessionDurationMinutes(),
                                data.getTotalActiveTimeMinutes(),
                                data.getTotalActiveTimeMinutes() / 60.0,
                                formatActivityLogs(data.getProcessedActivityLogs()),
                                formatLearnerOperations(data.getLearnerOperations()),
                                formatExistingData(existingData));
        }

        private String formatActivityLogs(List<String> logs) {
                if (logs == null || logs.isEmpty()) {
                        return "No processed activity logs available.";
                }

                StringBuilder formatted = new StringBuilder();
                for (int i = 0; i < logs.size(); i++) {
                        formatted.append(String.format("Activity %d:\n%s\n\n", i + 1, logs.get(i)));
                }
                return formatted.toString();
        }

        private String formatLearnerOperations(
                        List<vacademy.io.admin_core_service.features.student_analysis.dto.LearnerOperationSummary> operations) {
                if (operations == null || operations.isEmpty()) {
                        return "No learner operations recorded.";
                }

                StringBuilder formatted = new StringBuilder();
                for (var op : operations) {
                        formatted.append(String.format("- Source: %s, Operation: %s, Value: %s, Time: %s\n",
                                        op.getSource(), op.getOperation(), op.getValue(), op.getTimestamp()));
                }
                return formatted.toString();
        }

        private String formatExistingData(List<UserLinkedData> existingData) {
                if (existingData == null || existingData.isEmpty()) {
                        return "No existing strengths and weaknesses recorded.";
                }

                StringBuilder formatted = new StringBuilder();
                for (UserLinkedData data : existingData) {
                        formatted.append(String.format("- %s: %s (%d%%)\n",
                                        data.getType(), data.getData(), data.getPercentage()));
                }
                return formatted.toString();
        }

        private Mono<StudentReportData> parseResponse(String responseBody, String model, String userId) {
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

                        // Parse into StudentReportData
                        StudentReportData reportData = StudentReportData.builder()
                                        .learningFrequency(parsedContent.path("learning_frequency").asText())
                                        .progress(parsedContent.path("progress").asText())
                                        .studentEfforts(parsedContent.path("student_efforts").asText())
                                        .topicsOfImprovement(parsedContent.path("topics_of_improvement").asText())
                                        .topicsOfDegradation(parsedContent.path("topics_of_degradation").asText())
                                        .remedialPoints(parsedContent.path("remedial_points").asText())
                                        .strengths(parseTopicMap(parsedContent.path("strengths")))
                                        .weaknesses(parseTopicMap(parsedContent.path("weaknesses")))
                                        .build();

                        log.info("[Student-Report-LLM] Successfully generated report using model: {}", model);
                        return Mono.just(reportData);

                } catch (Exception e) {
                        log.error("[Student-Report-LLM] Error parsing LLM response from model {}: {}", model,
                                        e.getMessage());
                        return Mono.error(new RuntimeException("Failed to parse LLM response: " + e.getMessage(), e));
                }
        }

        private Map<String, Integer> parseTopicMap(JsonNode node) {
                Map<String, Integer> result = new HashMap<>();
                if (node.isObject()) {
                        node.fields().forEachRemaining(entry -> {
                                result.put(entry.getKey(), entry.getValue().asInt());
                        });
                }
                return result;
        }

}
