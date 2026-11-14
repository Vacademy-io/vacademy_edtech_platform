package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.ExtractedAnswerDto;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.question_core.enums.QuestionTypes;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Service for extracting student answers from PDF/HTML content using AI
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiAnswerExtractionService {

        private final ObjectMapper objectMapper;
        private final AiClientService aiClientService;
        private final AiPromptBuilderService aiPromptBuilderService;

        /**
         * Extract answer for a single question from HTML content
         */
        public ExtractedAnswerDto extractAnswerFromHtml(String questionText, String questionId,
                        String htmlContent, String preferredModel, WebClient webClient) {
                String prompt = aiPromptBuilderService.createAnswerExtractionPrompt(questionText, questionId,
                                htmlContent);
                log.info("Created answer extraction prompt for question: {}, prompt length: {}", questionId,
                                prompt.length());
                log.info("Full extraction prompt: {}", prompt);

                log.info("HTML content being processed for extraction (first 1000 chars): {}",
                                htmlContent != null && htmlContent.length() > 1000 ? htmlContent.substring(0, 1000)
                                                : htmlContent);

                try {
                        String response = aiClientService.callAiForExtraction(prompt, preferredModel, webClient)
                                        .block();

                        if (response != null) {
                                log.info("Received extraction response, length: {}", response.length());

                                String contentString = aiClientService.extractContentFromResponse(response);
                                log.info("Raw extraction response content: {}", contentString);

                                ExtractedAnswerDto result = objectMapper.readValue(contentString,
                                                ExtractedAnswerDto.class);
                                log.info("Successfully extracted answer for question: {}, status: {}", questionId,
                                                result.getStatus());
                                return result;
                        }
                } catch (Exception e) {
                        log.error("Failed to extract answer for question {}: {}", questionId, e.getMessage(), e);
                }

                return null;
        }

        /**
         * Batch extract all answers from the answer sheet in ONE API call.
         * Huge optimization: instead of N extraction calls, make just 1.
         */
        public Map<String, ExtractedAnswerDto> batchExtractAllAnswers(
                        List<QuestionWiseMarks> marksList,
                        String studentPdfContent,
                        String preferredModel,
                        WebClient webClient) {

                Map<String, ExtractedAnswerDto> results = new HashMap<>();

                // CODING and CBE (spreadsheet / document) answers come from the live browser
                // editor, not from PDF/HTML answer sheets.
                List<QuestionWiseMarks> filtered = marksList.stream()
                        .filter(m -> m.getQuestion() == null
                                || (!QuestionTypes.CODING.name().equals(m.getQuestion().getQuestionType())
                                        && !QuestionTypes.CBE_RESPONSE.name().equals(m.getQuestion().getQuestionType())))
                        .collect(Collectors.toList());

                if (studentPdfContent == null || studentPdfContent.isEmpty() || filtered.isEmpty()) {
                        log.warn("Cannot batch extract: empty content or no questions");
                        return results;
                }
                marksList = filtered;

                try {
                        // Create batch extraction prompt
                        String prompt = aiPromptBuilderService.createBatchExtractionPrompt(marksList,
                                        studentPdfContent);

                        log.info("Created batch extraction prompt for {} questions, prompt length: {}",
                                        marksList.size(), prompt.length());

                        // Call AI
                        String response = aiClientService.callAiForBatchExtraction(prompt, preferredModel, webClient)
                                        .block();

                        if (response != null) {
                                String contentString = aiClientService.extractContentFromResponse(response);

                                // Parse batch response
                                JsonNode batchResult = objectMapper.readTree(contentString);
                                JsonNode answersArray = batchResult.path("answers");

                                if (answersArray.isArray()) {
                                        int extractedCount = 0;
                                        for (JsonNode answerNode : answersArray) {
                                                ExtractedAnswerDto extracted = objectMapper.treeToValue(answerNode,
                                                                ExtractedAnswerDto.class);
                                                results.put(extracted.getQuestionId(), extracted);
                                                extractedCount++;
                                        }
                                        log.info("✅ BATCH EXTRACTION SUCCESS: Extracted {} answers in ONE call. Token savings: ~{}%",
                                                        extractedCount,
                                                        (int) ((1.0 - 1.0 / marksList.size()) * 100));
                                } else {
                                        log.warn("Batch extraction response missing 'answers' array");
                                }
                        }

                } catch (Exception e) {
                        log.error("Batch extraction failed: {}. Will fallback to individual extraction.",
                                        e.getMessage(), e);
                }

                return results;
        }
}
