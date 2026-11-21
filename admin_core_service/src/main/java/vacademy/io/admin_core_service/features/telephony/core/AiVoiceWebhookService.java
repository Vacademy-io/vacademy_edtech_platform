package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.spi.AiCallReportParser;
import vacademy.io.admin_core_service.features.telephony.spi.dto.AiCallReport;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Provider-neutral receiver for AI-voice end-of-call webhooks. Handles transport
 * (NaN-sanitising, single-object vs array), resolves the provider's
 * {@link AiCallReportParser} from the registry, and lands each parsed
 * {@link AiCallReport} into the {@code ai_call_result} table (idempotent on
 * {@code (provider, call_uuid)}). The lead-binding + assignment is done
 * afterwards by {@link AiCallOutcomeProcessor}.
 *
 * A new AI provider needs nothing here — only its parser + caller beans.
 */
@Service
@RequiredArgsConstructor
public class AiVoiceWebhookService {

    private static final Logger log = LoggerFactory.getLogger(AiVoiceWebhookService.class);

    /** The fault vocabulary is a closed set of 12; the cap only bounds a malformed payload. */
    private static final int MAX_FAULTS = 32;
    private static final int MAX_FAULT_LEN = 40;

    private final AiVoiceProviderRegistry registry;
    private final AiCallResultRepository repo;

    private final ObjectMapper mapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .configure(JsonParser.Feature.ALLOW_NON_NUMERIC_NUMBERS, true);

    public record IngestResult(int received, int updated, int failed, List<String> savedIds) {}

    private record UpsertOutcome(String id, boolean isUpdate) {}

    @Transactional
    public IngestResult ingest(String provider, String instituteId, String rawBody) {
        AiCallReportParser parser = registry.parser(provider); // throws on unknown provider
        int received = 0, updated = 0, failed = 0;
        List<String> savedIds = new ArrayList<>();

        List<JsonNode> calls = new ArrayList<>();
        try {
            JsonNode root = mapper.readTree(sanitize(rawBody));
            if (root.isArray()) root.forEach(calls::add); else calls.add(root);
        } catch (Exception e) {
            log.error("ai-voice webhook: unparseable body provider={} institute={}", provider, instituteId, e);
            captureUnparseable(provider, instituteId, rawBody);
            return new IngestResult(0, 0, 1, savedIds);
        }

        for (JsonNode node : calls) {
            try {
                AiCallReport report = parser.parse(node);
                UpsertOutcome o = upsert(provider, instituteId, report);
                savedIds.add(o.id());
                if (o.isUpdate()) updated++; else received++;
            } catch (Exception e) {
                failed++;
                log.error("ai-voice webhook: failed to map a call provider={} institute={}", provider, instituteId, e);
            }
        }
        return new IngestResult(received, updated, failed, savedIds);
    }

    private UpsertOutcome upsert(String provider, String instituteId, AiCallReport report) {
        String callUuid = report.getCallUuid();
        AiCallResult row = callUuid == null ? null
                : repo.findByProviderAndCallUuid(provider, callUuid).orElse(null);
        boolean isUpdate = row != null;
        if (row == null) row = AiCallResult.builder().provider(provider).build();

        row.setCallUuid(callUuid);
        if (row.getInstituteId() == null) row.setInstituteId(instituteId);
        row.setCorrelationId(report.getCorrelationId());
        row.setWorkflowExecutionId(metaString(report, "workflowExecutionId"));
        row.setDirection(report.getDirection());
        row.setCampaignType(report.getCampaignType());
        row.setCampaignId(report.getCampaignId());
        row.setPhoneNumber(report.getPhoneNumber());
        row.setDialCode(report.getDialCode());
        row.setCallRetry(report.getCallRetry());
        row.setCustomerName(report.getCustomerName());
        row.setCustomerEmail(report.getCustomerEmail());
        row.setStatus(report.getStatus());
        row.setDisposition(report.getDisposition());
        row.setLeadResponse(report.getLeadResponse());
        row.setLeadRating(report.getLeadRating());
        row.setCallRating(report.getCallRating());
        row.setInterestLevel(report.getInterestLevel());
        row.setAiSummary(report.getSummary());
        row.setExtractedQa(report.getExtractedQa());
        row.setMetadata(report.getMetadata());
        row.setCallback(report.getCallbackRequested());
        row.setCallbackAt(report.getCallbackAt());
        row.setCallbackTimeText(report.getCallbackTimeText());
        row.setTransferCall(report.getTransferAttempted());
        row.setNinePressed(report.getNinePressed());
        row.setTransferStatus(report.getTransferStatus());
        row.setTransferTriggered(report.getTransferTriggered());
        row.setHangupCause(report.getHangupCause());
        row.setHangupCode(report.getHangupCode());
        row.setHangupSource(report.getHangupSource());
        row.setRecordingUrl(report.getRecordingUrl());
        row.setDurationSeconds(report.getDurationSeconds());
        row.setCallStart(report.getCallStart());
        row.setTranscript(report.getTranscript());
        row.setRawPayload(report.getRawPayload());
        // Follow-up gist + measured engagement (V510). Nulls are meaningful here: a null
        // followUp is "not assessed" (never CALL) and a null callerWordCount is
        // "not measured" (never 0), so they are written through verbatim rather than
        // defaulted — a provider that sends none simply leaves them null.
        row.setFollowUp(report.getFollowUp());
        row.setFollowUpGist(report.getFollowUpGist());
        row.setCallerWordCount(report.getCallerWordCount());
        applyDiagnostics(row, report);

        repo.save(row);
        return new UpsertOutcome(row.getId(), isUpdate);
    }

    /**
     * Promote the report's {@code diagnostics} blob to queryable columns (V416).
     *
     * <p>TOTAL BY CONSTRUCTION. Report ingest is how a call binds to its lead and
     * how a paused workflow resumes; a malformed diagnostics blob stranding that is
     * a far worse outcome than losing the diagnostics. Any failure here is logged
     * and swallowed, leaving the row (and its raw_payload, which still holds the
     * blob verbatim) fully intact.
     *
     * <p>An absent blob leaves the existing columns UNTOUCHED rather than nulling
     * them: diagnostics are additive telemetry, so a re-POST from an older bot build
     * must not erase a verdict we already recorded for that call.
     */
    private void applyDiagnostics(AiCallResult row, AiCallReport report) {
        try {
            Map<String, Object> diag = report.getDiagnostics();
            if (diag == null || diag.isEmpty()) return;
            row.setDiagnostics(diag);
            // Derived from the blob itself — never from sibling top-level fields, so
            // the columns can never disagree with the payload they claim to summarise.
            row.setDiagHealth(healthOf(diag));
            row.setDiagFaults(faultsOf(diag));
        } catch (Exception e) {
            log.error("ai-voice webhook: diagnostics promotion failed callUuid={} — report kept",
                    report.getCallUuid(), e);
        }
    }

    /**
     * {@code health} is only accepted as one of the three known verdicts. The bot's
     * own failure path emits {@code health: null} alongside an {@code error} key, and
     * that must stay NULL here — "not measured" is never "GREEN". Also keeps the
     * value inside the varchar(8) column no matter what arrives.
     */
    private static String healthOf(Map<String, Object> diag) {
        Object raw = diag.get("health");
        if (raw == null) return null;
        String v = String.valueOf(raw).trim().toUpperCase();
        return ("GREEN".equals(v) || "AMBER".equals(v) || "RED".equals(v)) ? v : null;
    }

    /**
     * Flatten {@code faults} to a comma-joined string for cheap LIKE-based triage.
     * Bounded on every axis (element count, element length, total length) so a
     * runaway payload can never blow up the row.
     */
    private static String faultsOf(Map<String, Object> diag) {
        Object raw = diag.get("faults");
        if (!(raw instanceof Iterable<?> items)) return null;
        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (Object item : items) {
            if (item == null || count >= MAX_FAULTS) continue;
            String code = String.valueOf(item).trim().toUpperCase();
            if (code.isEmpty() || code.length() > MAX_FAULT_LEN) continue;
            if (sb.length() > 0) sb.append(',');
            sb.append(code);
            count++;
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private String metaString(AiCallReport report, String key) {
        if (report.getMetadata() != null && report.getMetadata().get(key) != null) {
            return String.valueOf(report.getMetadata().get(key));
        }
        return null;
    }

    private void captureUnparseable(String provider, String instituteId, String rawBody) {
        try {
            repo.save(AiCallResult.builder()
                    .provider(provider)
                    .instituteId(instituteId)
                    .rawPayload(rawBody == null ? "" : rawBody)
                    .processingStatus("PARSE_FAILED")
                    .build());
        } catch (Exception e) {
            log.error("ai-voice webhook: failed to capture unparseable body", e);
        }
    }

    /** Pandas/JS exports sometimes emit bare NaN tokens which are invalid JSON. */
    private String sanitize(String body) {
        if (body == null) return "{}";
        return body.replaceAll("(?<=[:\\[,]\\s{0,8})NaN", "null");
    }
}
