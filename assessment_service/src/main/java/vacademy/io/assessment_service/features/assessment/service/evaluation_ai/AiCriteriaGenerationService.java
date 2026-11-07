package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CreateCriteriaTemplateRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CriteriaRubricDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.GenerateCriteriaRequest;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.core.exception.VacademyException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class AiCriteriaGenerationService {

        private static final String API_URL = "https://openrouter.ai";
        private static final int RESPONSE_TIMEOUT_SECONDS = 60;

        private static final int MAX_RETRIES_PER_MODEL = 2;
        /** ai_service model-registry use case; ai_service walks its default → fallback chain. */
        static final String USE_CASE = "evaluation";
        /** GLM reasons before answering, so the registry path gets more room than the direct one. */
        private static final int REGISTRY_TIMEOUT_SECONDS = 120;
        private static final String SYSTEM_PROMPT =
                        "You are an expert educational assessment specialist. You create detailed, fair, and structured evaluation criteria (rubrics) for grading student answers.";

        private final WebClient webClient;
        private final WebClient aiServiceWebClient;
        private final ObjectMapper objectMapper;
        private final EvaluationCriteriaService evaluationCriteriaService;
        private final AiServiceLlmClient aiServiceLlmClient;

        public AiCriteriaGenerationService(
                        @Value("${openrouter.api.key}") String apiKey,
                        @Value("${ai.service.base.url:http://ai-service:8077}") String aiServiceBaseUrl,
                        ObjectMapper objectMapper,
                        EvaluationCriteriaService evaluationCriteriaService,
                        AiServiceLlmClient aiServiceLlmClient) {
                this.objectMapper = objectMapper;
                this.evaluationCriteriaService = evaluationCriteriaService;
                this.aiServiceLlmClient = aiServiceLlmClient;
                this.webClient = WebClient.builder()
                                .baseUrl(API_URL)
                                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                .build();
                this.aiServiceWebClient = WebClient.builder()
                                .baseUrl(aiServiceBaseUrl)
                                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                .build();
        }

        public CreateCriteriaTemplateRequest generateCriteria(GenerateCriteriaRequest request, boolean save,
                        String createdBy) {
                log.info("[Criteria Gen] Q: {}, Type: {}, MaxMarks: {} (from caller)",
                                request.getQuestionId(), request.getQuestionType(), request.getMaxMarks());

                String prompt = createCriteriaPrompt(request);

                try {
                        // Blocking call to get the result synchronously. ai_service's model
                        // registry first; the legacy direct chain only when it is unreachable.
                        CriteriaRubricDto rubric = generateViaRegistry(prompt)
                                        .onErrorResume(AiServiceLlmClient.UnavailableException.class, e -> {
                                                log.warn("[AI-Criteria-Gen] ai_service model registry unavailable ({}); using the legacy direct chain",
                                                                e.getMessage());
                                                return generateViaLegacyChain(prompt);
                                        })
                                        .block();

                        CreateCriteriaTemplateRequest templateRequest = CreateCriteriaTemplateRequest.builder()
                                        .name("AI Generated Criteria for " + request.getSubject())
                                        .subject(request.getSubject())
                                        .questionType(request.getQuestionType())
                                        .criteriaJson(rubric)
                                        .description("Automatically generated criteria based on question text.")
                                        .build();

                        if (save) {
                                evaluationCriteriaService.createTemplate(templateRequest, createdBy);
                        }

                        return templateRequest;

                } catch (AiServiceLlmClient.PolicyRefusalException e) {
                        // Refused by policy (AI usage limit / plan): no model ran and the legacy
                        // direct chain is not tried. Surface the limit's own message.
                        log.info("[AI-Criteria-Gen] refused by policy ({}): {}", e.getCode(), e.getMessage());
                        throw new VacademyException(e.getMessage());
                } catch (Exception e) {
                        log.error("Failed to generate criteria with AI", e);
                        throw new VacademyException("Failed to generate criteria with AI: " + e.getMessage());
                }
        }

        /**
         * One completion through ai_service's {@code evaluation} use case. ai_service picks
         * the model and fails over between models; the retries here cover an unparseable
         * rubric or a transient ai_service error, never an unavailable endpoint.
         */
        private Mono<CriteriaRubricDto> generateViaRegistry(String prompt) {
                List<Map<String, String>> messages = List.of(
                                Map.of("role", "system", "content", SYSTEM_PROMPT),
                                Map.of("role", "user", "content", prompt));
                return Mono.defer(() -> aiServiceLlmClient.completeAsync(USE_CASE, messages, true, null, "low", null,
                                                Duration.ofSeconds(REGISTRY_TIMEOUT_SECONDS)))
                                .flatMap(completion -> parseResponse(aiServiceLlmClient.toChatCompletionBody(completion),
                                                completion.model() != null ? completion.model() : USE_CASE))
                                .retryWhen(Retry.fixedDelay(MAX_RETRIES_PER_MODEL, Duration.ofSeconds(2))
                                                .filter(error -> !(error instanceof AiServiceLlmClient.UnavailableException)
                                                                && !AiServiceLlmClient.isPolicyRefusal(error))
                                                .doBeforeRetry(signal -> log.warn(
                                                                "[AI-Criteria-Gen] Retry {}/{} via ai_service use case {}: {}",
                                                                signal.totalRetries() + 1, MAX_RETRIES_PER_MODEL, USE_CASE,
                                                                signal.failure().getMessage()))
                                                .onRetryExhaustedThrow((spec, signal) -> signal.failure()));
        }

        /** The pre-registry path: the use case's model list, each tried directly on OpenRouter. */
        private Mono<CriteriaRubricDto> generateViaLegacyChain(String prompt) {
                return getModelPriority(USE_CASE)
                                .flatMap(models -> {
                                        if (models.isEmpty()) {
                                                return Mono.error(new RuntimeException("No AI models available for criteria generation."));
                                        }
                                        return tryModelsWithFallback(prompt, models, 0);
                                });
        }

        private Mono<List<String>> getModelPriority(String useCase) {
                return aiServiceWebClient.get()
                        .uri("/ai-service/models/v2/use-case/" + useCase)
                        .retrieve()
                        .bodyToMono(String.class)
                        .map(response -> {
                                try {
                                        JsonNode root = objectMapper.readTree(response);
                                        List<String> models = new ArrayList<>();
                                        
                                        // Try getting recommended models first
                                        JsonNode recommended = root.path("recommended_models");
                                        if (recommended.isArray()) {
                                                for (JsonNode modelNode : recommended) {
                                                        String modelId = modelNode.path("model_id").asText("");
                                                        if (!modelId.isBlank()) {
                                                                models.add(modelId);
                                                        }
                                                }
                                        }
                                        
                                        // If empty or error, fallback to free tier model
                                        if (models.isEmpty() && !root.path("free_tier_model").isMissingNode()) {
                                                String fallbackId = root.path("free_tier_model").path("model_id").asText("");
                                                if (!fallbackId.isBlank()) {
                                                        models.add(fallbackId);
                                                }
                                        }
                                        
                                        return models;
                                } catch (Exception e) {
                                        log.error("Failed to parse models API response", e);
                                        return Collections.<String>emptyList();
                                }
                        })
                        .onErrorResume(e -> {
                                log.error("Failed to fetch models from ai-service", e);
                                return Mono.just(Collections.emptyList());
                        });
        }

        private Mono<CriteriaRubricDto> tryModelsWithFallback(String prompt, List<String> modelPriority, int modelIndex) {
                if (modelIndex >= modelPriority.size()) {
                        log.error("[AI-Criteria-Gen] All models failed after retries");
                        return Mono.error(new RuntimeException("All LLM models failed. Tried: " + modelPriority));
                }

                String currentModel = modelPriority.get(modelIndex);
                log.info("[AI-Criteria-Gen] Attempting with model: {} (priority {})", currentModel, modelIndex + 1);

                return generateWithModel(prompt, currentModel)
                                .retryWhen(Retry.fixedDelay(MAX_RETRIES_PER_MODEL, Duration.ofSeconds(2))
                                                .doBeforeRetry(signal -> log.warn(
                                                                "[AI-Criteria-Gen] Retry {}/{} for model: {}",
                                                                signal.totalRetries() + 1, MAX_RETRIES_PER_MODEL,
                                                                currentModel))
                                                .onRetryExhaustedThrow((spec, signal) -> {
                                                        log.error("[AI-Criteria-Gen] Model {} exhausted retries ({})",
                                                                        currentModel, MAX_RETRIES_PER_MODEL);
                                                        return signal.failure();
                                                }))
                                .onErrorResume(error -> {
                                        log.error("[AI-Criteria-Gen] Model {} failed: {}. Trying next model...",
                                                        currentModel, error.getMessage());
                                        return tryModelsWithFallback(prompt, modelPriority, modelIndex + 1);
                                });
        }

        private Mono<CriteriaRubricDto> generateWithModel(String prompt, String model) {
                Map<String, Object> payload = Map.of(
                                "model", model,
                                "messages", List.of(
                                                Map.of("role", "system", "content", SYSTEM_PROMPT),
                                                Map.of("role", "user", "content", prompt)),
                                "response_format", Map.of("type", "json_object"));

                return webClient.post()
                                .uri("/api/v1/chat/completions")
                                .bodyValue(payload)
                                .retrieve()
                                .bodyToMono(String.class)
                                .timeout(Duration.ofSeconds(RESPONSE_TIMEOUT_SECONDS))
                                .flatMap(response -> parseResponse(response, model));
        }

        private String createCriteriaPrompt(GenerateCriteriaRequest request) {
                String cleanedQuestionText = cleanQuestionText(request.getQuestionText());
                return String.format(
                                """
                                                Create a detailed evaluation criteria (rubric) for the following question.

                                                **Subject:** %s
                                                **Question Type:** %s
                                                **Max Marks:** %.1f

                                                **Question Text:**
                                                %s

                                                Generate a JSON response with the following structure:
                                                {
                                                  "max_marks": %.1f,
                                                  "partial_marking_enabled": true,
                                                  "evaluation_instructions": "General instructions for the evaluator.",
                                                  "rubric": [
                                                    {
                                                      "criteria_name": "Name of the criteria (e.g., Conceptual Understanding)",
                                                      "max_marks": 2.0,
                                                      "keywords": ["keyword1", "keyword2"],
                                                      "evaluation_guidelines": "Specific guidelines for this criteria."
                                                    }
                                                  ]
                                                }

                                                **CRITICAL GUIDELINES:**
                                                1. The sum of ALL 'max_marks' in the rubric items MUST NOT exceed %.1f (the total Max Marks).
                                                2. Break down the total %.1f marks proportionally across different evaluation criteria.
                                                3. Each criterion should have a 'max_marks' value that represents a portion of the total.
                                                4. Design criteria that comprehensively evaluate the answer while staying within the total marks limit.
                                                5. Example: For 4.0 total marks, you might have criteria with max_marks of [1.5, 1.0, 1.0, 0.5] which sum to 4.0.
                                                6. 'evaluation_guidelines' should be clear, actionable, and focused on quality over quantity.
                                                7. VERIFY that your rubric items sum to at most %.1f before returning the JSON.

                                                Return ONLY valid JSON.
                                                """,
                                request.getSubject(),
                                request.getQuestionType(),
                                request.getMaxMarks(),
                                cleanedQuestionText,
                                request.getMaxMarks(),
                                request.getMaxMarks(),
                                request.getMaxMarks(),
                                request.getMaxMarks());
        }

        private String cleanQuestionText(String rawText) {
                if (rawText == null || rawText.isEmpty())
                        return "";
                try {
                        Document doc = Jsoup.parse(rawText);

                        // Replace elements with data-latex attribute with their latex content
                        Elements latexElements = doc.select("[data-latex]");
                        for (Element el : latexElements) {
                                el.text(" " + el.attr("data-latex") + " ");
                        }

                        return doc.text();
                } catch (Exception e) {
                        log.warn("Failed to clean HTML from question text, using raw text", e);
                        return rawText;
                }
        }

        private Mono<CriteriaRubricDto> parseResponse(String responseBody, String model) {
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

                        // Parse into CriteriaRubricDto
                        CriteriaRubricDto rubric = CriteriaRubricDto.builder()
                                        .maxMarks(parsedContent.path("max_marks").asDouble())
                                        .partialMarkingEnabled(
                                                        parsedContent.path("partial_marking_enabled").asBoolean(true))
                                        .evaluationInstructions(parsedContent.path("evaluation_instructions").asText())
                                        .rubric(parseRubricItems(parsedContent.path("rubric")))
                                        .build();

                        // Validate and normalize if criteria exceed max marks
                        double criteriaSum = rubric.getRubric().stream()
                                        .mapToDouble(CriteriaRubricDto.RubricItemDto::getMaxMarks)
                                        .sum();

                        if (criteriaSum > rubric.getMaxMarks()) {
                                log.warn("[AI-Criteria-Gen] Criteria sum ({}) exceeds max marks ({}), normalizing proportionally",
                                                criteriaSum, rubric.getMaxMarks());

                                // Normalize all criteria proportionally
                                double scaleFactor = rubric.getMaxMarks() / criteriaSum;
                                List<CriteriaRubricDto.RubricItemDto> normalizedRubric = rubric.getRubric().stream()
                                                .map(item -> CriteriaRubricDto.RubricItemDto.builder()
                                                                .criteriaName(item.getCriteriaName())
                                                                .maxMarks(Math.round(
                                                                                item.getMaxMarks() * scaleFactor * 10.0)
                                                                                / 10.0) // Round to 1 decimal
                                                                .keywords(item.getKeywords())
                                                                .evaluationGuidelines(item.getEvaluationGuidelines())
                                                                .build())
                                                .toList();

                                rubric = CriteriaRubricDto.builder()
                                                .maxMarks(rubric.getMaxMarks())
                                                .partialMarkingEnabled(rubric.getPartialMarkingEnabled())
                                                .evaluationInstructions(rubric.getEvaluationInstructions())
                                                .rubric(normalizedRubric)
                                                .build();

                                log.info("[AI-Criteria-Gen] Normalized criteria to sum: {}",
                                                normalizedRubric.stream().mapToDouble(
                                                                CriteriaRubricDto.RubricItemDto::getMaxMarks).sum());
                        }

                        log.info("[AI-Criteria-Gen] Successfully generated criteria using model: {}", model);
                        return Mono.just(rubric);

                } catch (Exception e) {
                        log.error("[AI-Criteria-Gen] Error parsing LLM response from model {}: {}", model,
                                        e.getMessage());
                        return Mono.error(new RuntimeException("Failed to parse LLM response: " + e.getMessage(), e));
                }
        }

        private List<CriteriaRubricDto.RubricItemDto> parseRubricItems(JsonNode node) {
                List<CriteriaRubricDto.RubricItemDto> items = new ArrayList<>();
                if (node.isArray()) {
                        node.forEach(itemNode -> {
                                List<String> keywords = new ArrayList<>();
                                if (itemNode.has("keywords") && itemNode.get("keywords").isArray()) {
                                        itemNode.get("keywords").forEach(k -> keywords.add(k.asText()));
                                }

                                items.add(CriteriaRubricDto.RubricItemDto.builder()
                                                .criteriaName(itemNode.path("criteria_name").asText())
                                                .maxMarks(itemNode.path("max_marks").asDouble())
                                                .keywords(keywords)
                                                .evaluationGuidelines(itemNode.path("evaluation_guidelines").asText())
                                                .build());
                        });
                }
                return items;
        }
}
