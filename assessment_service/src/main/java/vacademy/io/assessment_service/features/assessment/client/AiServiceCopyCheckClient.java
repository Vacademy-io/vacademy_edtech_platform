package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * WebClient wrapper for ai_service /copy-check/* endpoints. All calls send the
 * shared internal-service token so ai_service's require_internal_service_token
 * dependency accepts them.
 */
@Component
@Slf4j
public class AiServiceCopyCheckClient {

    private final WebClient webClient;
    private final String internalToken;

    public AiServiceCopyCheckClient(
            @Value("${ai.service.base.url:http://ai-service:8077}") String aiServiceBaseUrl,
            // The cluster already has a shared service-to-service secret in
            // INTERNAL_SERVICE_TOKEN (set on both assessment-service and
            // ai-service). Reuse it instead of introducing a separate one.
            @Value("${internal.service.token:${ai.service.internal.token:}}") String internalToken
    ) {
        this.internalToken = internalToken;
        // ai_service runs uvicorn (HTTP/1.1-only). The JDK HttpClient that
        // Spring uses under the hood defaults to HTTP/2 with an h2c upgrade
        // probe, which uvicorn's h11 parser logs as "Unsupported upgrade
        // request" + "Invalid HTTP request received" and drops the body.
        // Forcing HTTP/1.1 makes the POST land on the FastAPI route.
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.webClient = WebClient.builder()
                .clientConnector(new JdkClientHttpConnector(jdkClient))
                .baseUrl(aiServiceBaseUrl.replaceAll("/$", "") + "/ai-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * ai_service answered 429: every grading slot on that pod is taken. Not a
     * failure of the copy - the dispatcher puts it back in the queue for the next
     * tick (AI_EVALUATION_PUBLIC_API.md 11.2) instead of failing the process.
     */
    public static class AiServiceBusyException extends RuntimeException {
        public AiServiceBusyException(String message) {
            super(message);
        }
    }

    /**
     * POST /copy-check/grade — returns the assigned job_id. Throws
     * {@link AiServiceBusyException} on a 429, which is never retried here: a
     * retry a second later would only hit the same full semaphore.
     */
    @SuppressWarnings("unchecked")
    public String submitGrade(CopyCheckGradeRequestDto body) {
        Map<String, Object> response = webClient.post()
                .uri("/copy-check/grade")
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .onStatus(status -> status.value() == 429,
                        r -> Mono.error(new AiServiceBusyException("ai_service is at capacity (429)")))
                .bodyToMono(Map.class)
                .timeout(Duration.ofSeconds(30))
                .retryWhen(Retry.backoff(2, Duration.ofSeconds(1))
                        .filter(e -> !(e instanceof AiServiceBusyException)))
                .onErrorMap(e -> isBusy(e), e -> new AiServiceBusyException("ai_service is at capacity (429)"))
                .block();
        if (response == null || response.get("job_id") == null) {
            throw new IllegalStateException("ai_service returned no job_id");
        }
        return String.valueOf(response.get("job_id"));
    }

    /**
     * POST /copy-check/identify — the handwritten name / roll / class at the top
     * of a copy. Synchronous; ~5s. Returns the raw reading (null fields when
     * nothing was written) or throws when the file itself cannot be read.
     */
    public Map<String, Object> identify(String pdfUrl, String instituteId, String preferredModel) {
        Map<String, Object> body = new HashMap<>();
        body.put("pdf_url", pdfUrl);
        body.put("institute_id", instituteId);
        body.put("preferred_model", preferredModel);
        Map<String, Object> response = webClient.post()
                .uri("/copy-check/identify")
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .timeout(Duration.ofSeconds(120))
                .block();
        if (response == null) {
            throw new IllegalStateException("ai_service returned nothing for identify");
        }
        return response;
    }

    /**
     * What ai_service read from a PDF without grading it (contract C4,
     * {@code POST /copy-check/inspect}): its page count (null when unknown), whether it
     * is encrypted, and why it could not be read ({@code unparseable},
     * {@code too_many_pages}, {@code fetch_failed}; null when it was read).
     */
    public record InspectResult(Integer pages, boolean encrypted, String error) {
    }

    /**
     * POST /copy-check/inspect — page count of an uploaded PDF (partner API uploads,
     * spec 7.5). ai_service caps the read at 200 pages / 10 s / 60 MB, so PDF parsing
     * never runs in this service. Throws on a transport error, timeout or non-2xx
     * answer: the caller treats that as "could not check yet", never as a verdict.
     */
    @SuppressWarnings("unchecked")
    public InspectResult inspect(String pdfUrl) {
        Map<String, Object> body = new HashMap<>();
        body.put("pdf_url", pdfUrl);
        Map<String, Object> response = webClient.post()
                .uri("/copy-check/inspect")
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(Map.class)
                .timeout(Duration.ofSeconds(30))
                .block();
        if (response == null) {
            throw new IllegalStateException("ai_service returned nothing for inspect");
        }
        return toInspectResult(response);
    }

    static InspectResult toInspectResult(Map<String, Object> response) {
        Object pages = response.get("pages");
        Integer count = pages instanceof Number n ? Integer.valueOf(n.intValue()) : null;
        Object error = response.get("error");
        return new InspectResult(count, Boolean.TRUE.equals(response.get("encrypted")),
                error == null ? null : String.valueOf(error));
    }

    /** POST /copy-check/{job_id}/cancel — fire-and-forget. */
    public void cancel(String jobId) {
        try {
            webClient.post()
                    .uri("/copy-check/" + jobId + "/cancel")
                    .header("X-Internal-Service-Token", internalToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();
        } catch (Exception e) {
            log.warn("Failed to forward cancel for job {} to ai_service: {}", jobId, e.getMessage());
        }
    }

    /**
     * Cancel by process_id. Closes the race where the user stops the
     * evaluation before ai_service has finished allocating its job_id and
     * echoed it back — the Python side indexes its in-memory cancellation
     * set by process_id as well as job_id, so this fires regardless of
     * timing.
     */
    public void cancelByProcessId(String processId) {
        try {
            webClient.post()
                    .uri("/copy-check/by-process/" + processId + "/cancel")
                    .header("X-Internal-Service-Token", internalToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();
        } catch (Exception e) {
            log.warn("Failed to forward cancel for process {} to ai_service: {}",
                    processId, e.getMessage());
        }
    }

    /**
     * GET /copy-check/rubric/{assessment_id}?institute_id= — returns null if 404.
     * ai_service answers 404 when the rubric row belongs to another institute.
     */
    public JsonNode getRubric(String assessmentId, String instituteId) {
        try {
            return webClient.get()
                    .uri(b -> b.path("/copy-check/rubric/{assessmentId}")
                            .queryParam("institute_id", instituteId)
                            .build(assessmentId))
                    .header("X-Internal-Service-Token", internalToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(15))
                    .block();
        } catch (Exception e) {
            log.debug("getRubric({}) failed: {}", assessmentId, e.getMessage());
            return null;
        }
    }

    /**
     * Outcome of {@link #patchRubric}: the new rubric version, a refusal ai_service will
     * repeat on every retry (4xx other than 404/405/408/429), or "not reachable now"
     * (transport error, timeout, 5xx, endpoint not deployed yet), which is worth retrying.
     */
    public record RubricPatchResult(Integer version, int status, String detail, boolean retryable) {
        public boolean ok() {
            return version != null;
        }
    }

    /**
     * PATCH /copy-check/rubric/{assessment_id} — per-question merge of rubrics and model
     * answers in one version bump (spec 7.4.1, contract C4). {@code questions} maps a
     * question id to {@code {"rubric": {...}|null, "model_answer": "..."|null}}; a missing
     * key leaves that part alone, null deletes it. Never throws.
     */
    public RubricPatchResult patchRubric(String assessmentId, String instituteId, JsonNode questions, Integer ifMatch) {
        Map<String, Object> body = new HashMap<>();
        body.put("institute_id", instituteId);
        body.put("questions", questions);
        body.put("if_match", ifMatch);
        try {
            JsonNode response = webClient.patch()
                    .uri(b -> b.path("/copy-check/rubric/{assessmentId}").build(assessmentId))
                    .header("X-Internal-Service-Token", internalToken)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(15))
                    .block();
            if (response == null || !response.hasNonNull("version")) {
                return new RubricPatchResult(null, 502, "ai_service returned no version", true);
            }
            return new RubricPatchResult(response.get("version").asInt(), 200, null, false);
        } catch (WebClientResponseException e) {
            int status = e.getStatusCode().value();
            boolean retryable = status >= 500 || status == 404 || status == 405 || status == 408 || status == 429;
            return new RubricPatchResult(null, status, detailOf(e), retryable);
        } catch (Exception e) {
            log.warn("PATCH rubric {} failed: {}", assessmentId, e.getMessage());
            return new RubricPatchResult(null, 0, e.getMessage(), true);
        }
    }

    /** Thrown by {@link #fetchRubric} when ai_service cannot answer (not for a missing rubric). */
    public static class RubricStoreUnavailableException extends RuntimeException {
        public RubricStoreUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * GET /copy-check/rubric/{assessment_id}?institute_id= that tells "no rubric yet"
     * (empty) apart from "ai_service is down" ({@link RubricStoreUnavailableException}),
     * unlike {@link #getRubric}.
     */
    public Optional<JsonNode> fetchRubric(String assessmentId, String instituteId) {
        try {
            return Optional.ofNullable(webClient.get()
                    .uri(b -> b.path("/copy-check/rubric/{assessmentId}")
                            .queryParam("institute_id", instituteId)
                            .build(assessmentId))
                    .header("X-Internal-Service-Token", internalToken)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(10))
                    .block());
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 404) {
                return Optional.empty();
            }
            throw new RubricStoreUnavailableException("ai_service rubric read failed: " + e.getStatusCode().value(), e);
        } catch (Exception e) {
            throw new RubricStoreUnavailableException("ai_service rubric read failed: " + e.getMessage(), e);
        }
    }

    private static String detailOf(WebClientResponseException e) {
        String body = e.getResponseBodyAsString();
        if (body == null || body.isBlank()) {
            return e.getStatusText();
        }
        return body.length() > 500 ? body.substring(0, 500) : body;
    }

    /** POST /copy-check/rubric — upsert. The body's institute_id is the tenant. */
    public JsonNode upsertRubric(JsonNode body) {
        return webClient.post()
                .uri("/copy-check/rubric")
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .block();
    }

    /** DELETE /copy-check/rubric/{assessment_id}?institute_id=. */
    public void deleteRubric(String assessmentId, String instituteId) {
        webClient.delete()
                .uri(b -> b.path("/copy-check/rubric/{assessmentId}")
                        .queryParam("institute_id", instituteId)
                        .build(assessmentId))
                .header("X-Internal-Service-Token", internalToken)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .block();
    }

    /** PUT /copy-check/rubric/{assessment_id}/question/{question_id}?institute_id=. */
    public JsonNode upsertQuestionAnswer(String assessmentId, String questionId, String instituteId, JsonNode body) {
        return webClient.put()
                .uri(b -> b.path("/copy-check/rubric/{assessmentId}/question/{questionId}")
                        .queryParam("institute_id", instituteId)
                        .build(assessmentId, questionId))
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .block();
    }

    /** DELETE /copy-check/rubric/{assessment_id}/question/{question_id}?institute_id=. */
    public void deleteQuestionAnswer(String assessmentId, String questionId, String instituteId) {
        webClient.delete()
                .uri(b -> b.path("/copy-check/rubric/{assessmentId}/question/{questionId}")
                        .queryParam("institute_id", instituteId)
                        .build(assessmentId, questionId))
                .header("X-Internal-Service-Token", internalToken)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .block();
    }

    private static boolean isBusy(Throwable e) {
        Throwable t = e;
        while (t != null) {
            if (t instanceof AiServiceBusyException) return true;
            t = t.getCause() == t ? null : t.getCause();
        }
        return false;
    }
}
