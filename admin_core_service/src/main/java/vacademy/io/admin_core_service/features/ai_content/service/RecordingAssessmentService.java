package vacademy.io.admin_core_service.features.ai_content.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.ai_content.dto.AssessmentArtifactDto;
import vacademy.io.admin_core_service.features.ai_content.dto.CreateAssessmentFromRecordingDto;
import vacademy.io.admin_core_service.features.ai_content.entity.AiContentExtraction;
import vacademy.io.admin_core_service.features.ai_content.entity.AiContentSource;
import vacademy.io.admin_core_service.features.ai_content.entity.AiGeneratedArtifact;
import vacademy.io.admin_core_service.features.ai_content.repository.AiContentExtractionRepository;
import vacademy.io.admin_core_service.features.ai_content.repository.AiContentSourceRepository;
import vacademy.io.admin_core_service.features.ai_content.repository.AiGeneratedArtifactRepository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionParticipants;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Orchestrates "Create Assessment from Recording".
 *
 * Flow (v1):
 *   1. Look up the recording's ai_content_source row (must already exist
 *      from Layer 1's Process Recording step).
 *   2. Look up the corresponding ai_content_extraction (must be COMPLETED,
 *      with a non-null english_text_url and detected_language).
 *   3. Resolve the live_session → institute_id and the batch list (via
 *      LiveSessionParticipants source_type='BATCH').
 *   4. INSERT ai_generated_artifact row (status=IN_PROGRESS).
 *   5. Download the English transcript from S3.
 *   6. POST to ai-service /assessment/generate-from-transcript with
 *      target_language = detected_language. ai-service uses Gemini 2.5 Flash
 *      via the existing `agent` use case in ai_model_defaults.
 *   7. On success: UPDATE artifact with generated_content_json, status=COMPLETED.
 *      Return preview DTO containing title + questions to the UI.
 *
 * Follow-up scope (NOT in v1, marked as TODO below):
 *   - Push the generated assessment to assessment_service. This requires the
 *     evaluation-tool inline-question creation flow (assessment_service has no
 *     public Question-create endpoint, only the internal free-tool path). Once
 *     that integration lands, we'll populate artifactId + register batches via
 *     AssessmentRegistrationsDto.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class RecordingAssessmentService {

    static final String SOURCE_TYPE_BBB_RECORDING = "BBB_RECORDING";
    static final String EXTRACTION_WHISPER_TRANSCRIBE_TRANSLATE = "WHISPER_TRANSCRIBE_TRANSLATE";
    static final String ARTIFACT_TYPE_ASSESSMENT = "ASSESSMENT";
    /** HMAC-only (InternalAuthFilter). The old public path let anyone publish into any institute. */
    static final String AI_PUBLISH_ROUTE = "/assessment-service/internal/evaluation-tool/assessment/ai-publish";
    static final String LEGACY_AI_PUBLISH_ROUTE = "/assessment-service/evaluation-tool/assessment/ai-publish";

    private final AiContentSourceRepository sourceRepo;
    private final AiContentExtractionRepository extractionRepo;
    private final AiGeneratedArtifactRepository artifactRepo;
    private final LiveSessionRepository liveSessionRepo;
    private final LiveSessionParticipantRepository liveSessionParticipantRepo;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final InternalClientUtils internalClientUtils;

    @Value("${spring.application.name:admin_core_service}")
    private String clientName;

    @Value("${ai.service.url:http://localhost:8077}")
    private String aiServiceUrl;

    @Value("${ai.service.internal-token:}")
    private String internalServiceToken;

    @Value("${assessment.server.baseurl:http://localhost:8074}")
    private String assessmentServiceUrl;

    // -----------------------------------------------------------------------
    // Public entry
    // -----------------------------------------------------------------------

    public AssessmentArtifactDto createFromRecording(
            String recordingId,
            CreateAssessmentFromRecordingDto body,
            CustomUserDetails user) {

        // 1. Locate the source row written during Layer 1's transcription submit.
        AiContentSource source = sourceRepo
                .findBySourceTypeAndSourceId(SOURCE_TYPE_BBB_RECORDING, recordingId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No transcription source for recording " + recordingId +
                                " — process the recording first."));

        // 2. Locate the completed Whisper extraction.
        AiContentExtraction extraction = extractionRepo
                .findBySourceIdAndExtractionType(source.getId(), EXTRACTION_WHISPER_TRANSCRIBE_TRANSLATE)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT,
                        "No Whisper extraction for this recording — process the recording first."));

        if (!"COMPLETED".equals(extraction.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Transcript is not ready yet (status=" + extraction.getStatus() + ").");
        }
        if (extraction.getEnglishTextUrl() == null || extraction.getEnglishTextUrl().isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Transcript completed but english_text_url is missing — cannot generate assessment.");
        }

        String instituteId = source.getInstituteId();
        String detectedLanguage = extraction.getDetectedLanguage() != null
                ? extraction.getDetectedLanguage()
                : "en";

        // 3. Resolve batch list. Source metadata carries session_id (set during
        //    Layer 1 submit) — use that to look up LiveSessionParticipants.
        String sessionId = extractSessionIdFromMetadata(source);
        List<String> batchIds = resolveBatchIds(sessionId, body.getPackageSessionIdsOverride());

        // 4. Create the artifact row in IN_PROGRESS state immediately, so a
        //    page reload during generation shows "in progress" rather than
        //    appearing absent.
        AiGeneratedArtifact artifact = AiGeneratedArtifact.builder()
                .sourceId(source.getId())
                .extractionId(extraction.getId())
                .artifactType(ARTIFACT_TYPE_ASSESSMENT)
                .status("IN_PROGRESS")
                .generationParamsJson(serialiseParams(body))
                .createdBy(user != null ? user.getId() : null)
                .build();
        artifact = artifactRepo.save(artifact);

        // 5. Resolve the English transcript text. Prefer the cached body
        //    populated by the Whisper callback; only hit S3 for rows
        //    transcribed before that cache existed.
        String transcriptText;
        if (extraction.getEnglishTextContent() != null
                && !extraction.getEnglishTextContent().isBlank()) {
            transcriptText = extraction.getEnglishTextContent();
        } else {
            try {
                transcriptText = fetchTextFromS3(extraction.getEnglishTextUrl());
            } catch (RuntimeException e) {
                return failArtifact(artifact, recordingId, "Failed to download transcript: " + e.getMessage());
            }
            // Backfill the cache so future generations skip the S3 round-trip.
            if (transcriptText != null && !transcriptText.isBlank()) {
                extraction.setEnglishTextContent(transcriptText);
                extractionRepo.save(extraction);
            }
        }
        if (transcriptText == null || transcriptText.isBlank()) {
            return failArtifact(artifact, recordingId, "Transcript text is empty.");
        }

        // 6. Call ai-service to generate title + questions.
        int numQuestions = body.getNumQuestions() != null ? body.getNumQuestions() : 20;
        boolean includeImages = Boolean.TRUE.equals(body.getIncludeImages());
        Map<String, Object> aiResp;
        try {
            aiResp = callAiServiceGenerate(
                    instituteId, transcriptText, detectedLanguage, numQuestions, includeImages,
                    user != null ? user.getId() : null,
                    "assessment:" + artifact.getId());
        } catch (ResponseStatusException e) {
            return failArtifact(artifact, recordingId,
                    "ai-service: " + e.getStatusCode().value() + " " +
                            (e.getReason() == null ? "" : e.getReason()));
        } catch (RuntimeException e) {
            return failArtifact(artifact, recordingId, "Could not reach ai-service: " + e.getMessage());
        }

        String title = body.getOverrideTitle() != null && !body.getOverrideTitle().isBlank()
                ? body.getOverrideTitle()
                : String.valueOf(aiResp.getOrDefault("title", "Untitled Assessment"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rawQuestions =
                (List<Map<String, Object>>) aiResp.getOrDefault("questions", Collections.emptyList());
        String modelUsed = String.valueOf(aiResp.getOrDefault("model_used", "unknown"));

        // 7. Persist generated content + mark COMPLETED.
        artifact.setStatus("COMPLETED");
        artifact.setModelUsed(modelUsed);
        artifact.setGeneratedContentJson(serialiseGeneratedContent(title, rawQuestions));
        artifact = artifactRepo.save(artifact);

        // TODO (Layer 3 follow-up): push to assessment_service
        //   - POST /assessment-service/assessment/basic/create/v1/submit
        //   - POST /assessment-service/assessment/add-questions/create/v1/submit
        //   - POST /assessment-service/assessment/add-participants/create/v1/submit (with batchIds)
        //   - On success: artifact.setArtifactId(assessmentId); artifact.setArtifactUrl(...); save.
        // Blocker: assessment_service has no public question-create endpoint;
        // requires using the evaluation-tool inline flow which needs schema
        // mapping from our AssessmentArtifactDto.GeneratedQuestionDto.

        log.info("[create-assessment] artifact={} recording={} title='{}' questions={} batches={}",
                artifact.getId(), recordingId, title, rawQuestions.size(), batchIds.size());

        return toDto(recordingId, artifact, title, rawQuestions, detectedLanguage, batchIds);
    }

    // -----------------------------------------------------------------------
    // Read endpoint — list previously-generated artifacts for a recording
    // -----------------------------------------------------------------------

    public List<AssessmentArtifactDto> listForRecording(String recordingId) {
        Optional<AiContentSource> source = sourceRepo
                .findBySourceTypeAndSourceId(SOURCE_TYPE_BBB_RECORDING, recordingId);
        if (source.isEmpty()) {
            return Collections.emptyList();
        }
        List<AiGeneratedArtifact> rows = artifactRepo
                .findBySourceIdOrderByCreatedAtDesc(source.get().getId());
        return rows.stream()
                .filter(a -> ARTIFACT_TYPE_ASSESSMENT.equals(a.getArtifactType()))
                .map(a -> toDtoFromStored(recordingId, a))
                .collect(Collectors.toList());
    }

    // -----------------------------------------------------------------------
    // Publish — push the stored artifact to assessment_service so it becomes
    // a real assessment learners can take. Idempotent on the artifact: if
    // the artifact already has artifact_id set (already published), returns
    // it without re-creating. Triggered explicitly by a "Publish" click
    // in the UI — never auto-fires.
    // -----------------------------------------------------------------------

    public AssessmentArtifactDto publishArtifact(
            String recordingId,
            String artifactId,
            vacademy.io.admin_core_service.features.ai_content.dto.PublishAssessmentOverridesDto overrides,
            CustomUserDetails user) {
        String overrideTitle = overrides == null ? null : overrides.getTitle();

        AiGeneratedArtifact artifact = artifactRepo.findById(artifactId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Artifact not found: " + artifactId));

        if (!"COMPLETED".equals(artifact.getStatus()) && !"PUBLISHED".equals(artifact.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Artifact is in status=" + artifact.getStatus() + "; only COMPLETED artifacts can be published");
        }
        // Already published → return existing
        if ("PUBLISHED".equals(artifact.getStatus()) && artifact.getArtifactId() != null) {
            return toDtoFromStored(recordingId, artifact);
        }

        // 1. Parse stored content + params.
        if (artifact.getGeneratedContentJson() == null || artifact.getGeneratedContentJson().isBlank()) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Artifact has no generated content");
        }
        String title;
        List<Map<String, Object>> rawQuestions;
        try {
            JsonNode root = objectMapper.readTree(artifact.getGeneratedContentJson());
            title = overrideTitle != null && !overrideTitle.isBlank()
                    ? overrideTitle.trim()
                    : root.path("title").asText("Untitled Assessment");
            rawQuestions = objectMapper.convertValue(
                    root.path("questions"),
                    new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Could not parse stored artifact JSON: " + e.getMessage());
        }
        if (rawQuestions == null || rawQuestions.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Artifact has no questions to publish");
        }

        // 2. Pull the per-assessment params (start/end/marks/duration) the
        // teacher chose at generate time. Falls through to sane defaults
        // when fields are missing (older artifacts).
        Map<String, Object> params = parseParamsJson(artifact.getGenerationParamsJson());
        String startDateTime  = asString(params.get("startDateTime"));
        String endDateTime    = asString(params.get("endDateTime"));
        Integer marks         = asInt(params.get("marksPerQuestion"), 4);
        Integer negMark       = asInt(params.get("negativeMarkPerQuestion"), 0);
        Integer durationMin   = asInt(params.get("durationMinutes"), 60);
        String visibility     = asString(params.get("assessmentVisibility"));
        boolean negEnabled    = Boolean.TRUE.equals(params.get("negativeMarkingEnabled"));
        // Null-tolerant: keep as Integer so we can decide to omit from
        // the publish payload when the teacher hasn't supplied a value.
        Integer reattemptCount = params.get("reattemptCount") instanceof Number
                ? ((Number) params.get("reattemptCount")).intValue() : null;
        Integer previewTime    = params.get("previewTime") instanceof Number
                ? ((Number) params.get("previewTime")).intValue() : null;

        // Any field supplied on the publish request takes precedence over
        // the value stored at generation time. Teachers fill these in the
        // post-generation "Configure" step, so the overrides are usually
        // present on the v2 flow and absent on the legacy title-only call.
        if (overrides != null) {
            if (overrides.getStartDateTime() != null && !overrides.getStartDateTime().isBlank())
                startDateTime = overrides.getStartDateTime();
            if (overrides.getEndDateTime() != null && !overrides.getEndDateTime().isBlank())
                endDateTime = overrides.getEndDateTime();
            if (overrides.getMarksPerQuestion() != null) marks = overrides.getMarksPerQuestion();
            if (overrides.getDurationMinutes() != null) durationMin = overrides.getDurationMinutes();
            if (overrides.getAssessmentVisibility() != null && !overrides.getAssessmentVisibility().isBlank())
                visibility = overrides.getAssessmentVisibility();
            if (overrides.getNegativeMarkingEnabled() != null) negEnabled = overrides.getNegativeMarkingEnabled();
            if (overrides.getNegativeMarkPerQuestion() != null) negMark = overrides.getNegativeMarkPerQuestion();
            if (overrides.getReattemptCount() != null) reattemptCount = overrides.getReattemptCount();
            if (overrides.getPreviewTime() != null) previewTime = overrides.getPreviewTime();
        }
        int effectiveNegMark  = negEnabled ? negMark : 0;

        // 3. Resolve attached batches via the source row.
        AiContentSource source = sourceRepo.findById(artifact.getSourceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "Source row missing for artifact " + artifactId));
        String sessionId = extractSessionIdFromMetadata(source);
        // Resolve which batches the assessment is registered to:
        //   - the live class's own batches, UNLESS skipBatchRegistration is set
        //     (the "Assessment only" batch picker drives the batches explicitly);
        //   - PLUS any explicit packageSessionIds (destination course batches for
        //     an Assessment slide, or the picker's selection).
        // So: skip + picked ⇒ exactly the picked batches; skip + none ⇒ unassigned;
        //     !skip + dest ⇒ live class + destination; !skip + none ⇒ live class.
        java.util.LinkedHashSet<String> batchSet = new java.util.LinkedHashSet<>();
        boolean skipBatches = overrides != null
                && Boolean.TRUE.equals(overrides.getSkipBatchRegistration());
        if (!skipBatches) {
            batchSet.addAll(resolveBatchIds(sessionId, null));
        }
        if (overrides != null && overrides.getPackageSessionIds() != null) {
            overrides.getPackageSessionIds().stream()
                    .filter(s -> s != null && !s.isBlank())
                    .forEach(batchSet::add);
        }
        List<String> batchIds = new java.util.ArrayList<>(batchSet);
        String instituteId = source.getInstituteId();

        // 4. Build the assessment-service publish payload.
        ObjectNode body = objectMapper.createObjectNode();
        body.put("name", title);
        body.put("instituteId", instituteId);
        if (startDateTime != null) body.put("startDateTime", startDateTime);
        if (endDateTime   != null) body.put("endDateTime", endDateTime);
        body.put("assessmentVisibility", visibility != null ? visibility : "PRIVATE");
        body.put("durationMinutes", durationMin);
        body.put("marksPerQuestion", marks);
        body.put("negativeMarkPerQuestion", effectiveNegMark);
        if (reattemptCount != null) body.put("reattemptCount", reattemptCount);
        if (previewTime != null) body.put("previewTime", previewTime);
        body.set("batchIds", objectMapper.valueToTree(batchIds));
        body.set("questions", objectMapper.valueToTree(rawQuestions.stream().map(this::toPublishQuestion).collect(Collectors.toList())));

        // 5. POST.
        String assessmentId;
        try {
            ResponseEntity<String> resp = postAiPublish(body);
            JsonNode respJson = resp.getBody() == null ? null : objectMapper.readTree(resp.getBody());
            if (respJson == null || !respJson.hasNonNull("assessmentId")) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "assessment-service did not return assessmentId");
            }
            assessmentId = respJson.get("assessmentId").asText();
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "assessment-service returned an unreadable response");
        } catch (HttpStatusCodeException e) {
            log.error("[publish] assessment-service {} {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "assessment-service error " + e.getStatusCode().value()
                            + ": " + e.getResponseBodyAsString());
        }

        // 6. Mark artifact published.
        artifact.setArtifactId(assessmentId);
        artifact.setStatus("PUBLISHED");
        if (overrideTitle != null && !overrideTitle.isBlank()) {
            try {
                JsonNode root = objectMapper.readTree(artifact.getGeneratedContentJson());
                ((ObjectNode) root).put("title", overrideTitle.trim());
                artifact.setGeneratedContentJson(objectMapper.writeValueAsString(root));
            } catch (Exception ignore) {}
        }
        artifactRepo.save(artifact);

        log.info("[publish] artifact={} assessment={} batches={} title='{}'",
                artifact.getId(), assessmentId, batchIds.size(), title);

        return toDtoFromStored(recordingId, artifact);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Publishes through assessment_service's HMAC-authenticated internal route.
     * Falls back to the legacy public route only while assessment_service is still
     * on a build without the internal one (deploy-order window: the old build
     * answers 401/403/404/405 there). Remove the fallback once both are deployed.
     */
    private ResponseEntity<String> postAiPublish(ObjectNode body) {
        try {
            return internalClientUtils.makeHmacRequest(clientName, "POST", assessmentServiceUrl,
                    AI_PUBLISH_ROUTE, body);
        } catch (HttpClientErrorException e) {
            int status = e.getStatusCode().value();
            if (status != 401 && status != 403 && status != 404 && status != 405) {
                throw e;
            }
            log.warn("[publish] internal ai-publish answered {}; retrying legacy route", status);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            return restTemplate.exchange(assessmentServiceUrl + LEGACY_AI_PUBLISH_ROUTE,
                    HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
        }
    }

    private Map<String, Object> parseParamsJson(String json) {
        if (json == null || json.isBlank()) return Collections.emptyMap();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private String asString(Object o) {
        return (o instanceof String) ? (String) o : null;
    }

    private Integer asInt(Object o, int fallback) {
        if (o instanceof Number) return ((Number) o).intValue();
        if (o instanceof String) {
            try { return Integer.parseInt((String) o); } catch (Exception ignore) {}
        }
        return fallback;
    }

    /**
     * Map our generated-content question shape → assessment-service AiQuestion shape.
     * The Python ai-service emits snake_case (correct_answer_index), so we
     * accept both and prefer snake_case (which is what gets persisted).
     */
    private Map<String, Object> toPublishQuestion(Map<String, Object> q) {
        Map<String, Object> out = new java.util.HashMap<>();
        out.put("question", q.get("question"));
        out.put("options", q.get("options"));
        Object idx = q.get("correct_answer_index");
        if (idx == null) idx = q.get("correctAnswerIndex");
        out.put("correctAnswerIndex", idx);
        out.put("explanation", q.get("explanation"));
        return out;
    }


    private String extractSessionIdFromMetadata(AiContentSource source) {
        if (source.getMetadataJson() == null || source.getMetadataJson().isBlank()) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Source row " + source.getId() + " missing metadata_json — cannot resolve session.");
        }
        try {
            JsonNode node = objectMapper.readTree(source.getMetadataJson());
            JsonNode sid = node.get("session_id");
            if (sid == null || sid.isNull() || sid.asText().isBlank()) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "Source metadata_json has no session_id.");
            }
            return sid.asText();
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Could not parse source metadata_json: " + e.getMessage());
        }
    }

    private List<String> resolveBatchIds(String sessionId, List<String> overrideBatchIds) {
        if (overrideBatchIds != null && !overrideBatchIds.isEmpty()) {
            return overrideBatchIds;
        }
        // Auto-resolve from LiveSessionParticipants. Filter to source_type='BATCH'
        // (also rows with source_type='USER' exist for individual-user attachments).
        return liveSessionParticipantRepo.findBySessionId(sessionId).stream()
                .filter(p -> "BATCH".equals(p.getSourceType()))
                .map(LiveSessionParticipants::getSourceId)
                .filter(s -> s != null && !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * Download plain-text transcript from S3. The URL is a presigned URL
     * the render worker uploaded to during Layer 1; it's public-readable for
     * the duration of the presigned expiry but we still pull it server-side
     * so the LLM call originates from admin-core (avoids CORS + leaks).
     */
    private String fetchTextFromS3(String url) {
        try {
            ResponseEntity<String> resp = restTemplate.getForEntity(url, String.class);
            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                throw new RuntimeException("S3 returned " + resp.getStatusCode());
            }
            return resp.getBody();
        } catch (Exception e) {
            log.warn("[create-assessment] Failed to fetch transcript from S3: {}", e.getMessage());
            throw new RuntimeException("S3 fetch failed: " + e.getMessage(), e);
        }
    }

    /**
     * POST to ai-service. Returns the parsed body (title + questions + model_used).
     */
    private Map<String, Object> callAiServiceGenerate(
            String instituteId,
            String transcriptText,
            String targetLanguage,
            int numQuestions,
            boolean includeImages,
            String userId,
            String idempotencyKey) {

        String url = aiServiceUrl + "/ai-service/assessment/generate-from-transcript";

        // HashMap (not Map.of) so a null userId doesn't NPE — the ai-service
        // attributes the credit charge to this user when present (Phase 3).
        Map<String, Object> reqBody = new HashMap<>();
        reqBody.put("transcript_text", transcriptText);
        reqBody.put("target_language", targetLanguage);
        reqBody.put("num_questions", numQuestions);
        reqBody.put("institute_id", instituteId);
        reqBody.put("include_images", includeImages);
        if (userId != null && !userId.isBlank()) {
            reqBody.put("user_id", userId);
        }
        // Dedup the credit charge so a RestTemplate timeout-after-success or a
        // double-submit can't double-charge the institute.
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            reqBody.put("idempotency_key", idempotencyKey);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (internalServiceToken != null && !internalServiceToken.isBlank()) {
            headers.set("X-Internal-Service-Token", internalServiceToken);
        }

        try {
            @SuppressWarnings({"rawtypes", "unchecked"})
            ResponseEntity<Map> resp = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(reqBody, headers), Map.class);
            if (resp.getBody() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "ai-service returned empty body");
            }
            return resp.getBody();
        } catch (HttpStatusCodeException e) {
            int code = e.getStatusCode().value();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "ai-service error " + code + ": " + e.getResponseBodyAsString());
        }
    }

    private AssessmentArtifactDto failArtifact(AiGeneratedArtifact artifact, String recordingId, String message) {
        artifact.setStatus("FAILED");
        artifact.setErrorMessage(message);
        artifactRepo.save(artifact);
        log.warn("[create-assessment] artifact={} FAILED: {}", artifact.getId(), message);
        return AssessmentArtifactDto.builder()
                .artifactId(artifact.getId())
                .recordingId(recordingId)
                .status("FAILED")
                .errorMessage(message)
                .createdAt(artifact.getCreatedAt())
                .updatedAt(artifact.getUpdatedAt())
                .build();
    }

    private String serialiseParams(CreateAssessmentFromRecordingDto body) {
        try {
            return objectMapper.writeValueAsString(body);
        } catch (Exception e) {
            return null;
        }
    }

    private String serialiseGeneratedContent(String title, List<Map<String, Object>> questions) {
        try {
            ObjectNode n = objectMapper.createObjectNode();
            n.put("title", title);
            n.set("questions", objectMapper.valueToTree(questions));
            return objectMapper.writeValueAsString(n);
        } catch (Exception e) {
            return null;
        }
    }

    private AssessmentArtifactDto toDto(
            String recordingId,
            AiGeneratedArtifact artifact,
            String title,
            List<Map<String, Object>> rawQuestions,
            String detectedLanguage,
            List<String> batchIds) {

        List<AssessmentArtifactDto.GeneratedQuestionDto> qs = rawQuestions.stream()
                .map(this::toQuestionDto)
                .collect(Collectors.toList());

        return AssessmentArtifactDto.builder()
                .artifactId(artifact.getId())
                .recordingId(recordingId)
                .status(artifact.getStatus())
                .title(title)
                .questions(qs)
                .targetLanguage(detectedLanguage)
                .modelUsed(artifact.getModelUsed())
                .numQuestions(qs.size())
                .assessmentId(artifact.getArtifactId())
                .assessmentViewUrl(artifact.getArtifactUrl())
                .registeredBatchIds(batchIds)
                .createdAt(artifact.getCreatedAt())
                .updatedAt(artifact.getUpdatedAt())
                .build();
    }

    /** Rebuild DTO from a stored row (no in-memory rawQuestions handy). */
    private AssessmentArtifactDto toDtoFromStored(String recordingId, AiGeneratedArtifact artifact) {
        String title = null;
        List<AssessmentArtifactDto.GeneratedQuestionDto> questions = new ArrayList<>();
        if (artifact.getGeneratedContentJson() != null) {
            try {
                JsonNode root = objectMapper.readTree(artifact.getGeneratedContentJson());
                title = root.path("title").asText(null);
                JsonNode qs = root.path("questions");
                if (qs.isArray()) {
                    for (JsonNode q : qs) {
                        Map<String, Object> m = objectMapper.convertValue(q, new TypeReference<Map<String, Object>>() {});
                        questions.add(toQuestionDto(m));
                    }
                }
            } catch (Exception e) {
                log.warn("[create-assessment] Could not parse generated_content_json for artifact={}: {}",
                        artifact.getId(), e.getMessage());
            }
        }
        return AssessmentArtifactDto.builder()
                .artifactId(artifact.getId())
                .recordingId(recordingId)
                .status(artifact.getStatus())
                .errorMessage(artifact.getErrorMessage())
                .title(title)
                .questions(questions)
                .modelUsed(artifact.getModelUsed())
                .numQuestions(questions.size())
                .assessmentId(artifact.getArtifactId())
                .assessmentViewUrl(artifact.getArtifactUrl())
                .createdAt(artifact.getCreatedAt())
                .updatedAt(artifact.getUpdatedAt())
                .build();
    }

    @SuppressWarnings("unchecked")
    private AssessmentArtifactDto.GeneratedQuestionDto toQuestionDto(Map<String, Object> q) {
        Object options = q.get("options");
        List<String> optionStrings = new ArrayList<>();
        if (options instanceof List<?>) {
            for (Object o : (List<?>) options) {
                optionStrings.add(String.valueOf(o));
            }
        }
        Object correctIdx = q.get("correct_answer_index");
        Integer correct = correctIdx instanceof Number ? ((Number) correctIdx).intValue() : null;
        return AssessmentArtifactDto.GeneratedQuestionDto.builder()
                .id(String.valueOf(q.getOrDefault("id", "")))
                .question(String.valueOf(q.getOrDefault("question", "")))
                .options(optionStrings)
                .correctAnswerIndex(correct)
                .explanation(String.valueOf(q.getOrDefault("explanation", "")))
                .build();
    }
}
