package vacademy.io.admin_core_service.features.instructor_copilot.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.sentry.Sentry;
import io.sentry.SentryEvent;
import io.sentry.SentryLevel;
import io.sentry.protocol.Message;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.ai_models.service.AIModelRegistryService;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;

@Slf4j
@Service
public class InstructorCopilotLLMService {

  /** Per attempt. There was no ceiling before; a hung call must not hold the job forever. */
  private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(180);

  private final ObjectMapper objectMapper;
  private final AiTokenUsageService aiTokenUsageService;
  private final AIModelRegistryService aiModelRegistryService;
  private final LlmGatewayRouter gatewayRouter;

  public InstructorCopilotLLMService(
      ObjectMapper objectMapper,
      AiTokenUsageService aiTokenUsageService,
      AIModelRegistryService aiModelRegistryService,
      LlmGatewayRouter gatewayRouter) {
    this.objectMapper = objectMapper;
    this.aiTokenUsageService = aiTokenUsageService;
    this.aiModelRegistryService = aiModelRegistryService;
    this.gatewayRouter = gatewayRouter;
  }

  public Mono<JsonNode> generateContentFromTranscript(String transcript) {
    String prompt = createPrompt(transcript);

    List<String> modelPriority = aiModelRegistryService.getModelPriority("copilot");
    if (modelPriority == null || modelPriority.isEmpty()) {
      log.error("No AI models available for the copilot use case.");
      return Mono.error(new RuntimeException("No AI models available for generating instructor copilot content."));
    }

    return tryModelsWithFallback(prompt, modelPriority, 0);
  }

  private Mono<JsonNode> tryModelsWithFallback(String prompt, List<String> modelPriority, int modelIndex) {
    if (modelIndex >= modelPriority.size()) {
      log.error("All LLM models failed after retries.");
      return Mono.error(new RuntimeException("All LLM models failed. Tried: " + modelPriority));
    }

    String currentModel = modelPriority.get(modelIndex);

    return callModel(currentModel, prompt, 2)
        .onErrorResume(e -> {
          log.warn("Model {} failed, retrying with next model.", currentModel, e);
          
          if (modelIndex + 1 < modelPriority.size()) {
            String nextModel = modelPriority.get(modelIndex + 1);
            SentryEvent event = new SentryEvent();
            event.setLevel(SentryLevel.WARNING);
            Message message = new Message();
            message.setMessage("LLM model failed, attempting fallback: " + e.getMessage());
            event.setMessage(message);
            event.setTag("llm.model", currentModel);
            event.setTag("fallback.model", nextModel);
            event.setTag("operation", "generateContentFromTranscript");
            Sentry.captureEvent(event);
          }
          
          return tryModelsWithFallback(prompt, modelPriority, modelIndex + 1);
        });
  }

  private Mono<JsonNode> callModel(String model, String prompt, long maxRetries) {
    Map<String, Object> payload = Map.of(
        "model", model,
        "messages", List.of(
            Map.of("role", "system", "content",
                "You are an expert educational content creator. You analyze transcripts and output educational content in strict JSON format."),
            Map.of("role", "user", "content", prompt)),
        "response_format", Map.of("type", "json_object"));

    // Isoquant for routed models (one OpenRouter try on a gateway failure); GLM gets
    // reasoning headroom + effort low. Usage is recorded under the registry id.
    return gatewayRouter.callModel(model, payload, RESPONSE_TIMEOUT, null)
        .retryWhen(Retry.fixedDelay(maxRetries, Duration.ofSeconds(2)))
        .doOnNext(response -> logTokenUsage(response, model))
        .flatMap(this::parseResponse);
  }

  /**
   * Log token usage from API response
   */
  private void logTokenUsage(String responseBody, String model) {
    try {
      JsonNode root = objectMapper.readTree(responseBody);
      JsonNode usage = root.get("usage");

      if (usage != null) {
        int promptTokens = usage.has("prompt_tokens") ? usage.get("prompt_tokens").asInt() : 0;
        int completionTokens = usage.has("completion_tokens") ? usage.get("completion_tokens").asInt() : 0;

        aiTokenUsageService.recordUsageAsync(
            ApiProvider.OPENAI,
            RequestType.COPILOT,
            model,
            promptTokens,
            completionTokens,
            null, // No institute ID in this context
            null // No user ID in this context
        );
      }
    } catch (Exception e) {
      log.warn("Failed to log token usage: {}", e.getMessage());
    }
  }

  private String createPrompt(String transcript) {
    return """
        Analyze the following transcript and generate a JSON response containing a title, summary, flashnotes, flashcards, classwork, and homework.

        The JSON structure must be exactly as follows:
        {
          "title": "A concise and engaging title",
          "summary": {
            "overview": "A brief overview paragraph",
            "key_points": ["Point 1", "Point 2", "Point 3"]
          },
          "flashnotes": [
            {
              "topic": "Topic Heading",
              "content": "Detailed explanation of the topic. Use markdown for formatting if needed."
            }
          ],
          "flashcards": [
            {
              "front": "Concept or Question",
              "back": "Definition or Answer"
            }
          ],
          "classwork": [
            "Task or activity 1 assigned during class",
            "Task or activity 2 assigned during class"
          ],
          "homework": [
            "Assignment 1 to be completed at home",
            "Assignment 2 to be completed at home"
          ]
        }

        IMPORTANT INSTRUCTIONS FOR CLASSWORK AND HOMEWORK:
        - Carefully analyze the transcript to identify any tasks, activities, assignments, or actionables given to students.
        - "classwork" should contain any in-class activities, exercises, or tasks the teacher asked students to complete during the class session.
        - "homework" should contain any assignments, tasks, or activities the teacher explicitly asked students to complete after class or at home.
        - Each item should be a clear, concise description of the task or assignment.
        - If NO classwork was mentioned in the transcript, return: "classwork": ["No classwork given"]
        - If NO homework was mentioned in the transcript, return: "homework": ["No homework given"]
        - Be thorough and extract all actionables, even if mentioned briefly.

        Ensure the content is high quality, accurate, and suitable for students.
        Return ONLY the valid JSON object.

        Transcript:
        """
        + transcript;
  }

  private Mono<JsonNode> parseResponse(String responseBody) {
    try {
      JsonNode root = objectMapper.readTree(responseBody);
      JsonNode contentNode = root.path("choices").path(0).path("message").path("content");
      if (contentNode.isMissingNode()) {
        RuntimeException exception = new RuntimeException("Invalid response from LLM: No content found");
        SentryEvent event = new SentryEvent(exception);
        event.setLevel(SentryLevel.ERROR);
        Message message = new Message();
        message.setMessage("Invalid LLM response: No content found in response");
        event.setMessage(message);
        event.setTag("operation", "parseResponse");
        event.setTag("error.type", "MissingContentNode");
        Sentry.captureEvent(event);
        return Mono.error(exception);
      }
      String contentString = contentNode.asText();
      // Clean up if wrapped in markdown code blocks
      if (contentString.startsWith("```json")) {
        contentString = contentString.replace("```json", "").replace("```", "").trim();
      } else if (contentString.startsWith("```")) {
        contentString = contentString.replace("```", "").trim();
      }

      return Mono.just(objectMapper.readTree(contentString));
    } catch (Exception e) {
      log.error("Error parsing LLM response", e);
      SentryEvent event = new SentryEvent(e);
      event.setLevel(SentryLevel.ERROR);
      Message message = new Message();
      message.setMessage("Failed to parse LLM response: " + e.getMessage());
      event.setMessage(message);
      event.setTag("operation", "parseResponse");
      event.setTag("error.type", e.getClass().getSimpleName());
      Sentry.captureEvent(event);
      return Mono.error(e);
    }
  }
}
