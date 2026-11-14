package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiGradingResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionEvaluationDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CreateCriteriaTemplateRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.GenerateCriteriaRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.ExtractedAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CriteriaRubricDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.DocConverterService;
import vacademy.io.assessment_service.features.assessment.service.FileConversionStatusService;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Orchestration service for AI-powered assessment evaluation
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiEvaluationAsyncService {

        private final AiEvaluationProcessRepository aiEvaluationProcessRepository;
        private final QuestionWiseMarksRepository questionWiseMarksRepository;
        private final StudentAttemptRepository studentAttemptRepository;
        private final ObjectMapper objectMapper;
        private final DocConverterService docConverterService;
        private final FileConversionStatusService fileConversionStatusService;
        private final AiCriteriaGenerationService aiCriteriaGenerationService;
        private final QuestionRepository questionRepository;
        private final AiQuestionEvaluationService aiQuestionEvaluationService;

        // New delegated services
        private final EvaluationUtilityService evaluationUtilityService;
        private final AiClientService aiClientService;
        private final AiPromptBuilderService aiPromptBuilderService;
        private final AiAnswerExtractionService aiAnswerExtractionService;

        // Cancellation service
        private final AiEvaluationCancellationService cancellationService;

        // New ai_service-backed path (Phase 1 of the copy-check migration)
        private final CopyCheckOrchestratorService copyCheckOrchestratorService;

        @Value("${media.service.baseurl}")
        private String mediaServiceUrl;

        @Value("${assessment.ai-evaluation.use-ai-service:true}")
        private boolean useAiServicePipeline;

        /**
         * Main async evaluation method - orchestrates the entire evaluation process.
         *
         * Runs on its own dispatch executor, not the shared default pool (11.2).
         *
         * @param claimToken the claimed_by value the row was claimed with (the poller's
         *                   instance id, or the direct path's per-run token). Dispatch
         *                   only proceeds while the row is DISPATCHED under this claim,
         *                   so the same row can never be dispatched twice.
         */
        @Async(AiEvaluationDispatchExecutorConfig.EXECUTOR)
        public void evaluateAttemptAsync(String processId, String attemptId, String preferredModel,
                        String claimToken) {
                log.info("Starting async evaluation for process: {}, attempt: {}, preferredModel: {}", processId,
                                attemptId, preferredModel);

                // CHECKPOINT 0: Check cancellation before starting
                if (cancellationService.isCancelled(processId)) {
                        log.info("🛑 Process {} was cancelled before starting evaluation", processId);
                        return;
                }

                // Feature flag: delegate the whole AI pipeline to ai_service (Python).
                // The remainder of this method (Mathpix + OpenRouter batch extract +
                // per-question grading) stays as the fallback until cutover.
                if (useAiServicePipeline) {
                        log.info("[copy-check] feature flag ON — delegating process {} to ai_service", processId);
                        try {
                                copyCheckOrchestratorService.dispatch(processId, attemptId, preferredModel, claimToken);
                        } catch (Exception e) {
                                // Nothing else catches this — we are the top of an @Async thread, and
                                // dispatch's own transaction (including any FAILED marker it tried to
                                // write) has already rolled back. Record the failure separately so the
                                // process does not sit at PENDING forever.
                                log.error("[copy-check] dispatch failed for process {}, attempt {}", processId,
                                                attemptId, e);
                                copyCheckOrchestratorService.markDispatchFailed(processId,
                                                "dispatch failed: " + e.getMessage());
                        }
                        return;
                }

                // Legacy in-JVM pipeline: same guard as the ai_service path - only the
                // holder of the claim may start the run, and only once.
                if (aiEvaluationProcessRepository.beginDispatch(processId, claimToken, new java.util.Date()) == 0) {
                        log.info("Process {} is no longer DISPATCHED under claim {}; not starting it", processId,
                                        claimToken);
                        return;
                }

                AiEvaluationProcess process = aiEvaluationProcessRepository.findById(processId).orElse(null);
                if (process == null) {
                        log.error("Process not found for processId: {}", processId);
                        return;
                }

                log.info("Found process: {}, status: {}, attempt: {}", processId, process.getStatus(), attemptId);

                // Update to STARTED status
                updateProcessStatus(processId, AiEvaluationStatusEnum.STARTED.name(), null);

                try {
                        // Update to PROCESSING status before PDF processing
                        updateProcessStatus(processId, AiEvaluationStatusEnum.PROCESSING.name(), "PROCESSING");

                        // Check for PDF in attempt data
                        String studentPdfContent = null;
                        try {
                                log.info("Attempting to process PDF for attempt: {}", attemptId);
                                String attemptData = fetchAttemptDataWithTransaction(processId);
                                studentPdfContent = processPdfAttempt(attemptId, attemptData);
                                if (studentPdfContent != null) {
                                        log.info("Successfully processed PDF content for attempt: {}, content length: {}",
                                                        attemptId, studentPdfContent.length());
                                } else {
                                        log.info("No PDF content found for attempt: {}", attemptId);
                                }
                        } catch (Exception e) {
                                log.warn("Failed to process PDF for attempt {}: {}", attemptId, e.getMessage());
                                // Continue, maybe it's not a PDF attempt or we can evaluate what we have
                        }

                        log.info("Fetching question-wise marks for attempt: {}", attemptId);
                        List<QuestionWiseMarks> marksList = questionWiseMarksRepository
                                        .findByStudentAttemptIdWithQuestionDetails(attemptId);
                        int totalQuestions = marksList.size();
                        log.info("Found {} questions to evaluate for attempt: {}", totalQuestions, attemptId);

                        process.setQuestionsTotal(totalQuestions);
                        process.setCurrentQuestionIndex(0);
                        aiEvaluationProcessRepository.save(process);
                        log.info("Updated process with total questions: {} for processId: {}", totalQuestions,
                                        processId);

                        int processedCount = 0;

                        log.info("Initializing AI WebClient");
                        WebClient aiWebClient = aiClientService.createWebClient();

                        log.info("Starting evaluation of {} questions for attempt: {}", marksList.size(), attemptId);

                        // CHECKPOINT 1: Check cancellation before batch extraction
                        if (cancellationService.isCancelled(processId)) {
                                log.info("🛑 Process {} cancelled before batch extraction. Stopping at question 0/{}",
                                                processId, marksList.size());
                                return;
                        }

                        // OPTIMIZATION: Batch extract ALL answers in ONE API call
                        // This reduces token usage by ~90% and API calls from N to 1
                        updateProcessStatus(processId, AiEvaluationStatusEnum.EXTRACTING.name(), "EXTRACTION");
                        log.info("🚀 Starting BATCH extraction for all {} questions...", marksList.size());
                        Map<String, ExtractedAnswerDto> batchExtractedAnswers = aiAnswerExtractionService
                                        .batchExtractAllAnswers(marksList, studentPdfContent, preferredModel,
                                                        aiWebClient);

                        if (!batchExtractedAnswers.isEmpty()) {
                                log.info("✅ Batch extraction successful! Got {} answers. Using cached results.",
                                                batchExtractedAnswers.size());
                        } else {
                                log.warn("⚠️  Batch extraction returned no results. Will use individual extraction fallback.");
                        }

                        // Collect evaluation results
                        List<QuestionEvaluationDto> evaluationResults = new ArrayList<>();

                        // Update to EVALUATING status
                        updateProcessStatus(processId, AiEvaluationStatusEnum.EVALUATING.name(), "GRADING");
                        updateProcessProgress(processId, 0, marksList.size());

                        // Create question evaluation tracking records for all questions
                        Map<String, AiQuestionEvaluation> questionEvals = new HashMap<>();
                        int questionNum = 1;
                        for (QuestionWiseMarks marks : marksList) {
                                AiQuestionEvaluation questionEval = aiQuestionEvaluationService
                                                .createQuestionEvaluation(
                                                                process, marks.getQuestion(), questionNum++);
                                questionEvals.put(marks.getQuestion().getId(), questionEval);
                        }

                        processedCount = 0;
                        for (QuestionWiseMarks marks : marksList) {
                                // CHECKPOINT 2: Check cancellation before processing each question
                                if (cancellationService.isCancelled(processId)) {
                                        log.info("🛑 Process {} cancelled. Stopping evaluation at question {}/{}",
                                                        processId, processedCount + 1, marksList.size());
                                        return; // Exit immediately
                                }

                                try {
                                        // Update question status to EVALUATING
                                        AiQuestionEvaluation questionEval = questionEvals
                                                        .get(marks.getQuestion().getId());
                                        if (questionEval != null) {
                                                aiQuestionEvaluationService.updateQuestionStatus(
                                                                questionEval.getId(), "EVALUATING");
                                        }

                                        log.info("Evaluating question {}/{} (ID: {}) for attempt: {}",
                                                        processedCount + 1, marksList.size(),
                                                        marks.getQuestion().getId(), attemptId);
                                        QuestionEvaluationDto result = evaluateSingleQuestion(
                                                        marks, preferredModel, aiWebClient, studentPdfContent,
                                                        batchExtractedAnswers);
                                        if (result != null) {
                                                evaluationResults.add(result);

                                                // Save question result immediately
                                                if (questionEval != null) {
                                                        aiQuestionEvaluationService.saveQuestionResult(
                                                                        questionEval.getId(), result,
                                                                        result.getExtractedAnswer());
                                                }

                                                // Update progress
                                                processedCount++;
                                                updateProcessProgress(processId, processedCount, marksList.size());
                                                log.info("Successfully evaluated question {} for attempt: {}",
                                                                marks.getQuestion().getId(), attemptId);
                                        }
                                } catch (Exception e) {
                                        // Mark question as failed
                                        AiQuestionEvaluation questionEval = questionEvals
                                                        .get(marks.getQuestion().getId());
                                        if (questionEval != null) {
                                                aiQuestionEvaluationService.markQuestionFailed(
                                                                questionEval.getId(), e.getMessage());
                                        }
                                        log.error("Failed to evaluate question {} for attempt {}",
                                                        marks.getQuestion().getId(), attemptId, e);
                                }
                        }

                        log.info("Completed evaluation of all questions for attempt: {}, processId: {}", attemptId,
                                        processId);

                        // Calculate total marks
                        double totalMarksAwarded = evaluationResults.stream()
                                        .mapToDouble(QuestionEvaluationDto::getMarksAwarded)
                                        .sum();
                        double totalMaxMarks = evaluationResults.stream()
                                        .mapToDouble(result -> {
                                                // Find the corresponding QuestionWiseMarks for this question
                                                QuestionWiseMarks marks = marksList.stream()
                                                                .filter(m -> m.getQuestion().getId()
                                                                                .equals(result.getQuestionId()))
                                                                .findFirst()
                                                                .orElse(null);
                                                if (marks != null) {
                                                        return evaluationUtilityService
                                                                        .extractMaxMarksFromSectionMapping(
                                                                                        marks,
                                                                                        marks.getQuestion());
                                                }
                                                return 10.0; // Default fallback
                                        })
                                        .sum();

                        log.info("Total marks awarded: {} out of {}", totalMarksAwarded, totalMaxMarks);

                        // Store evaluation JSON in process
                        try {
                                Map<String, Object> evaluationSummary = Map.of(
                                                "totalMarksAwarded", totalMarksAwarded,
                                                "totalMaxMarks", totalMaxMarks,
                                                "questionsEvaluated", evaluationResults.size());
                                String completeEvaluationJson = objectMapper.writeValueAsString(evaluationSummary);
                                process.setEvaluationJson(completeEvaluationJson);
                                log.info("Stored complete evaluation JSON for process: {}, size: {}", processId,
                                                completeEvaluationJson.length());
                        } catch (JsonProcessingException e) {
                                log.error("Failed to serialize complete evaluation for process: {}", processId, e);
                        }

                        // Update StudentAttempt with final results (same as auto-evaluation flow)
                        // Fetch directly to avoid lazy loading issue in async context
                        studentAttemptRepository.findById(attemptId).ifPresent(studentAttempt -> {
                                studentAttempt.setTotalMarks(totalMarksAwarded);
                                studentAttempt.setResultMarks(totalMarksAwarded);
                                studentAttempt.setResultStatus("COMPLETED");
                                // Optionally set report as released so students can see results
                                // studentAttempt.setReportReleaseStatus("RELEASED");
                                studentAttemptRepository.save(studentAttempt);
                                log.info("Updated StudentAttempt {} with totalMarks: {}, resultStatus: COMPLETED",
                                                studentAttempt.getId(), totalMarksAwarded);
                        });

                        process.setStatus(AiEvaluationStatusEnum.COMPLETED.name());
                        process.setCompletedAt(new Date());
                        aiEvaluationProcessRepository.save(process);
                        log.info("Marked process as COMPLETED for processId: {}", processId);

                } catch (Exception e) {
                        log.error("Error during async evaluation for process {}: {}", processId, e.getMessage(), e);
                        process.setStatus(AiEvaluationStatusEnum.FAILED.name());
                        process.setErrorMessage(e.getMessage());
                        aiEvaluationProcessRepository.save(process);
                        log.info("Marked process as FAILED for processId: {} with error: {}", processId,
                                        e.getMessage());
                } finally {
                        // Always clear the cancellation flag when process ends
                        // (completed/failed/cancelled)
                        cancellationService.clearFlag(processId);
                        log.debug("Cleared cancellation flag for process: {}", processId);
                }
        }

        /**
         * Process PDF attempt to extract content
         */
        private String processPdfAttempt(String attemptId, String attemptData) {
                log.info("Parsing attempt_data for attemptId: {}", attemptId);
                // Extract assessmentId and sectionId from attempt_data
                String assessmentId = null;
                String sectionId = null;
                try {
                        JsonNode attemptDataNode = objectMapper.readTree(attemptData);
                        assessmentId = attemptDataNode.path("assessment").path("assessmentId").asText(null);

                        // Get sectionId for first question being evaluated
                        JsonNode sectionsNode = attemptDataNode.path("sections");
                        if (sectionsNode.isArray() && sectionsNode.size() > 0) {
                                sectionId = sectionsNode.get(0).path("sectionId").asText(null);
                        }

                        log.info("Extracted from attempt_data - AssessmentID: {}, SectionID: {}", assessmentId,
                                        sectionId);
                } catch (Exception e) {
                        log.error("Error during AI evaluation for attempt: {}", attemptId, e);
                        throw new RuntimeException("AI evaluation failed during PDF attempt data parsing", e);
                }

                // FileConversionStatus check
                String fileId = evaluationUtilityService.extractFileId(attemptData);

                log.info("Processing PDF attempt for attemptId: {}, attemptData length: {}",
                                attemptId, attemptData != null ? attemptData.length() : 0);

                if (attemptData == null || attemptData.isEmpty()) {
                        log.info("No attempt data found for attempt: {}", attemptId);
                        return null;
                }

                // Check if this file has already been processed successfully
                var existingConversions = fileConversionStatusService.findAllByFileId(fileId);
                var latestSuccessfulConversion = existingConversions.stream()
                                .filter(conv -> "SUCCESS".equals(conv.getStatus()))
                                .filter(conv -> conv.getHtmlText() != null && !conv.getHtmlText().isEmpty())
                                .max((a, b) -> a.getCreatedOn().compareTo(b.getCreatedOn()));

                if (latestSuccessfulConversion.isPresent()) {
                        String existingContent = latestSuccessfulConversion.get().getHtmlText();
                        log.info("Found existing successful conversion for fileId: {}, returning cached content (length: {})",
                                        fileId, existingContent.length());
                        return existingContent;
                }

                log.info("Found PDF fileId {} for attempt {}, starting local processing...", fileId, attemptId);

                // Get file URL from media service
                String fileUrl = getFileUrl(fileId);
                if (fileUrl == null) {
                        log.error("Failed to get file URL for fileId: {}", fileId);
                        return null;
                }

                // Start processing with local DocConverterService
                String pdfId = docConverterService.startProcessing(fileUrl);
                if (pdfId == null) {
                        log.error("Failed to start PDF processing for fileId: {}", fileId);
                        return null;
                }

                // Save to local file conversion status
                fileConversionStatusService.startProcessing(pdfId, "mathpix", fileId);
                log.info("PDF processing started locally, pdfId: {} for fileId: {}", pdfId, fileId);

                // Poll for result
                int maxRetries = 10;
                int delayMs = 3000;
                log.info("Starting to poll for PDF processing result, pdfId: {}, maxRetries: {}", pdfId, maxRetries);

                for (int i = 0; i < maxRetries; i++) {
                        try {
                                log.debug("Polling attempt {}/{} for pdfId: {}", i + 1, maxRetries, pdfId);
                                Thread.sleep(delayMs);

                                String markdown = docConverterService.getConvertedMarkdown(pdfId);
                                if (markdown != null) {
                                        // Process Markdown content with LaTeX
                                        String processedContent = evaluationUtilityService
                                                        .processMarkdownContent(markdown);
                                        log.info("PDF processing completed for pdfId: {}, Markdown content length: {}, processed content length: {}",
                                                        pdfId, markdown.length(), processedContent.length());
                                        // Update local status with vendor file ID (pdfId)
                                        fileConversionStatusService.updateHtmlTextByVendorFileId(pdfId,
                                                        processedContent);
                                        return processedContent;
                                } else {
                                        // Fallback to HTML if MD fails
                                        String html = docConverterService.getConvertedHtml(pdfId);
                                        if (html != null) {
                                                String bodyContent = evaluationUtilityService.extractBody(html);
                                                log.info("PDF processing fallback to HTML for pdfId: {}, HTML content length: {}, body content length: {}",
                                                                pdfId, html.length(), bodyContent.length());
                                                // Update local status with vendor file ID (pdfId)
                                                fileConversionStatusService.updateHtmlTextByVendorFileId(pdfId, html);
                                                return bodyContent;
                                        }
                                }
                        } catch (Exception e) {
                                log.debug("Polling PDF status failed, retrying... ({}/{})", i + 1, maxRetries);
                        }
                }

                log.error("PDF processing timed out for pdfId: {} after {} retries", pdfId, maxRetries);
                return null;
        }

        /**
         * Get file URL from media service
         */
        private String getFileUrl(String fileId) {
                log.info("Getting file URL for fileId: {}", fileId);
                WebClient mediaClient = WebClient.builder()
                                .baseUrl(mediaServiceUrl)
                                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                .build();

                try {
                        String url = mediaClient
                                        .get()
                                        .uri(uriBuilder -> uriBuilder
                                                        .path("/media-service/public/get-public-url")
                                                        .queryParam("fileId", fileId)
                                                        .build())
                                        .retrieve()
                                        .bodyToMono(String.class)
                                        .block();

                        if (url != null && !url.isEmpty()) {
                                log.info("Got file URL for fileId: {}", fileId);
                                return url;
                        }
                } catch (Exception e) {
                        log.error("Failed to get file URL for fileId: {}", fileId, e);
                }

                return null;
        }

        /**
         * Evaluate a single question
         */
        private QuestionEvaluationDto evaluateSingleQuestion(QuestionWiseMarks marks,
                        String preferredModel, WebClient webClient,
                        String studentPdfContent, Map<String, ExtractedAnswerDto> batchExtractedAnswers) {
                Question question = marks.getQuestion();
                log.info("Evaluating question ID: {}, type: {}", question.getId(), question.getQuestionType());

                String criteriaJson = question.getEvaluationCriteriaJson();

                log.debug("Question evaluation data - criteria present: {}",
                                criteriaJson != null && !criteriaJson.isEmpty());

                // Step 1: Try to get answer from BATCH extraction cache first
                ExtractedAnswerDto extractedAnswer = batchExtractedAnswers.get(question.getId());

                // QUALITY FIX: If batch marked as NOT_ATTEMPTED, retry with individual
                // extraction
                if (extractedAnswer != null && "NOT_ATTEMPTED".equals(extractedAnswer.getStatus())
                                && studentPdfContent != null && !studentPdfContent.isEmpty()) {
                        log.warn("⚠️  Batch marked Q{} as NOT_ATTEMPTED. Retrying with individual extraction...",
                                        question.getId());
                        String questionText = evaluationUtilityService.cleanHtml(
                                        evaluationUtilityService.extractQuestionText(question));
                        ExtractedAnswerDto retryAnswer = aiAnswerExtractionService.extractAnswerFromHtml(questionText,
                                        question.getId(),
                                        studentPdfContent, preferredModel, webClient);

                        if (retryAnswer != null && !"NOT_ATTEMPTED".equals(retryAnswer.getStatus())) {
                                log.info("✅ Individual extraction recovered answer that batch missed for Q{}",
                                                question.getId());
                                extractedAnswer = retryAnswer;
                        } else {
                                log.info("Individual extraction also confirmed NOT_ATTEMPTED for Q{}",
                                                question.getId());
                        }
                }

                if (extractedAnswer != null) {
                        log.info("✅ Using extracted answer for question: {} (status: {})",
                                        question.getId(), extractedAnswer.getStatus());
                } else if (studentPdfContent != null && !studentPdfContent.isEmpty()) {
                        // Fallback: Individual extraction if not in batch cache
                        log.warn("⚠️  Question {} not in batch cache, falling back to individual extraction (CACHE MISS)",
                                        question.getId());
                        String questionText = evaluationUtilityService.cleanHtml(
                                        evaluationUtilityService.extractQuestionText(question));
                        extractedAnswer = aiAnswerExtractionService.extractAnswerFromHtml(questionText,
                                        question.getId(),
                                        studentPdfContent,
                                        preferredModel, webClient);

                        if (extractedAnswer == null) {
                                log.warn("Failed to extract answer for question {}", question.getId());
                                return null;
                        }
                } else {
                        log.warn("No PDF content available for question {}", question.getId());
                        return null;
                }

                log.info("Extracted answer status: {}, answer length: {}",
                                extractedAnswer.getStatus(),
                                extractedAnswer.getAnswerHtml() != null
                                                ? extractedAnswer.getAnswerHtml().length()
                                                : 0);
                log.info("Extracted answer HTML (first 500 chars): {}",
                                extractedAnswer.getAnswerHtml() != null
                                                && extractedAnswer.getAnswerHtml().length() > 500
                                                                ? extractedAnswer.getAnswerHtml().substring(0, 500)
                                                                : extractedAnswer.getAnswerHtml());

                // If not attempted, return early
                if ("NOT_ATTEMPTED".equals(extractedAnswer.getStatus())) {
                        log.info("Question {} was not attempted by student", question.getId());
                        return QuestionEvaluationDto.builder()
                                        .questionId(question.getId())
                                        .marksAwarded(0.0)
                                        .extractedAnswer("NOT_ATTEMPTED")
                                        .feedback("Question not attempted")
                                        .build();
                }

                // Clean question text for evaluation
                String questionText = evaluationUtilityService.cleanHtml(
                                evaluationUtilityService.extractQuestionText(question));
                log.info("Question text: {}", questionText);
                log.info("Extracted answer preview: {}",
                                extractedAnswer.getAnswerHtml() != null
                                                && extractedAnswer.getAnswerHtml().length() > 500
                                                                ? extractedAnswer.getAnswerHtml().substring(0, 500)
                                                                : extractedAnswer.getAnswerHtml());

                // Generate criteria if not present
                if (criteriaJson == null || criteriaJson.isEmpty()) {
                        log.info("No criteria found for question {}, generating criteria dynamically",
                                        question.getId());
                        try {
                                double actualMaxMarks = 10.0; // Default fallback
                                try {
                                        // Extract max marks FAST from section mapping
                                        actualMaxMarks = evaluationUtilityService.extractMaxMarksFromSectionMapping(
                                                        marks,
                                                        question);
                                        log.info("✅ [FAST] Q: {}, Extracted Marks: {}", question.getId(),
                                                        actualMaxMarks);
                                } catch (Exception e) {
                                        log.warn("Failed to extract max marks from section mapping for question {}. Using default 10.0. Error: {}",
                                                        question.getId(), e.getMessage());
                                }

                                GenerateCriteriaRequest generateRequest = GenerateCriteriaRequest.builder()
                                                .questionId(question.getId())
                                                .questionText(questionText)
                                                .questionType(question.getQuestionType())
                                                .subject(question.getQuestionType())
                                                .maxMarks(actualMaxMarks)
                                                .build();
                                CreateCriteriaTemplateRequest generatedCriteria = aiCriteriaGenerationService
                                                .generateCriteria(generateRequest, false, "system");
                                criteriaJson = objectMapper.writeValueAsString(generatedCriteria.getCriteriaJson());
                                log.info("Generated criteria for question {}: {}", question.getId(), criteriaJson);

                                // Update the question with the generated criteria
                                question.setEvaluationCriteriaJson(criteriaJson);
                                questionRepository.save(question);
                                log.info("Updated question {} with generated criteria", question.getId());
                        } catch (Exception e) {
                                log.error("Failed to generate criteria for question {}, skipping evaluation",
                                                question.getId(), e);
                                return null;
                        }
                }

                // Step 2: Evaluate the extracted answer
                log.info("Step 2: Evaluating extracted answer for question: {}", question.getId());

                // Build comprehensive question context
                String questionContext = aiPromptBuilderService.buildQuestionContext(question);
                log.info("Question context for evaluation:\n{}", questionContext);

                String prompt = aiPromptBuilderService.createEvaluationPrompt(questionText,
                                extractedAnswer.getAnswerHtml(),
                                criteriaJson,
                                questionContext);
                log.info("Created evaluation prompt for question: {}, prompt length: {}", question.getId(),
                                prompt.length());
                log.debug("Full evaluation prompt: {}", prompt);

                // Call AI
                log.info("Calling AI for grading question: {} with model: {}", question.getId(), preferredModel);
                AiGradingResponseDto gradingResult = aiClientService.callAiForGrading(prompt, preferredModel, webClient)
                                .block();

                if (gradingResult != null) {
                        // Validate marks don't exceed question max marks
                        try {
                                CriteriaRubricDto rubric = objectMapper.readValue(criteriaJson,
                                                CriteriaRubricDto.class);
                                if (rubric.getMaxMarks() != null
                                                && gradingResult.getMarksAwarded() > rubric.getMaxMarks()) {
                                        log.warn("AI awarded marks ({}) exceed question max marks ({}), normalizing",
                                                        gradingResult.getMarksAwarded(), rubric.getMaxMarks());

                                        // Calculate scale factor to normalize marks
                                        double scaleFactor = rubric.getMaxMarks() / gradingResult.getMarksAwarded();

                                        // Normalize the criteria breakdown as well
                                        if (gradingResult.getCriteriaBreakdown() != null
                                                        && !gradingResult.getCriteriaBreakdown().isEmpty()) {
                                                List<AiGradingResponseDto.CriteriaFeedbackDto> normalizedBreakdown = gradingResult
                                                                .getCriteriaBreakdown().stream()
                                                                .map(criteria -> {
                                                                        AiGradingResponseDto.CriteriaFeedbackDto normalized = new AiGradingResponseDto.CriteriaFeedbackDto();
                                                                        normalized.setCriteriaName(
                                                                                        criteria.getCriteriaName());
                                                                        normalized.setMarks(
                                                                                        Math.round(criteria.getMarks()
                                                                                                        * scaleFactor
                                                                                                        * 10.0) / 10.0);
                                                                        normalized.setReason(criteria.getReason());
                                                                        return normalized;
                                                                })
                                                                .toList();
                                                gradingResult.setCriteriaBreakdown(normalizedBreakdown);
                                                log.info("Normalized criteria breakdown for question: {}",
                                                                question.getId());
                                        }

                                        // Cap the total marks awarded
                                        gradingResult.setMarksAwarded(rubric.getMaxMarks());
                                        log.info("Final marks after normalization: {}",
                                                        gradingResult.getMarksAwarded());
                                }
                        } catch (Exception e) {
                                log.warn("Could not validate marks against max marks: {}", e.getMessage());
                        }

                        log.info("Received AI grading result for question: {}, marks awarded: {}",
                                        question.getId(), gradingResult.getMarksAwarded());
                        marks.setAiEvaluatedAt(new Date());
                        // Note: evaluatorFeedback is admin-only field, not set by AI
                        // AI feedback is stored in ai_evaluation_details_json
                        try {
                                String detailsJson = objectMapper.writeValueAsString(gradingResult);
                                marks.setAiEvaluationDetailsJson(detailsJson);
                                log.info("Saved AI evaluation details for question: {}, evaluation JSON: {}",
                                                question.getId(), detailsJson);
                        } catch (JsonProcessingException e) {
                                log.error("Failed to serialize grading result for question: {}", question.getId(), e);
                        }

                        questionWiseMarksRepository.save(marks);
                        log.info("Successfully saved AI evaluation for question: {} with marks: {}", question.getId(),
                                        marks.getMarks());

                        // Return evaluation result
                        return QuestionEvaluationDto.builder()
                                        .questionId(question.getId())
                                        .marksAwarded(gradingResult.getMarksAwarded())
                                        .extractedAnswer(extractedAnswer.getAnswerHtml())
                                        .feedback(gradingResult.getFeedback())
                                        .evaluationDetailsJson(marks.getAiEvaluationDetailsJson())
                                        .build();
                } else {
                        log.warn("No grading result received from AI for question: {}", question.getId());
                        return null;
                }
        }

        /**
         * Update overall evaluation process status
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        private void updateProcessStatus(String processId, String status, String currentStep) {
                aiEvaluationProcessRepository.findById(processId).ifPresent(process -> {
                        process.setStatus(status);
                        if (currentStep != null) {
                                process.setCurrentStep(currentStep);
                        }
                        aiEvaluationProcessRepository.save(process);
                        log.info("🔄 Process status: {} - {}", status, currentStep != null ? currentStep : "");
                });
        }

        /**
         * Update progress counters (completed/total)
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        private void updateProcessProgress(String processId, int completed, int total) {
                aiEvaluationProcessRepository.findById(processId).ifPresent(process -> {
                        process.setQuestionsCompleted(completed);
                        process.setQuestionsTotal(total);
                        aiEvaluationProcessRepository.save(process);
                        double percentage = (double) completed / total * 100;
                        log.info("📊 Progress: {}/{} questions ({}%)", completed, total,
                                        String.format("%.1f", percentage));
                });
        }

        /**
         * Fetch StudentAttempt data within a transactional context to avoid lazy
         * initialization errors
         */
        @Transactional(readOnly = true)
        private String fetchAttemptDataWithTransaction(String processId) {
                return aiEvaluationProcessRepository.findByIdWithStudentAttempt(processId)
                                .map(proc -> proc.getStudentAttempt().getAttemptData())
                                .orElse(null);
        }

}
