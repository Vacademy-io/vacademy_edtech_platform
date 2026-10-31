package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallDetailDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads a single call's deep detail for the dashboard's "more details" view.
 *
 * <p>The paginated search projection deliberately stays lean; this service reads
 * the full row and, crucially, mines the stored raw provider webhook body
 * ({@code raw_payload_json}) for the fields that explain a failed/busy/no-answer
 * outcome — hangup cause, SIP/cause code, provider error string — which never
 * make it into the 48-char {@code termination_reason}. Everything provider-shaped
 * is best-effort: unparseable bodies just yield an empty {@code providerDetails}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CallDetailService {

    private final TelephonyCallLogRepository callLogRepository;
    private final AiCallResultRepository aiCallResultRepository;
    private final ObjectMapper objectMapper;

    /**
     * Curated top-level webhook keys worth surfacing, mapped to a human label.
     * Matched case-insensitively against the parsed body; only present, non-blank
     * scalar values are included, in this order. Kept intentionally narrow — these
     * are diagnostic fields (never phone numbers), safe for any dashboard viewer.
     */
    private static final Map<String, String> INTERESTING_KEYS = buildInterestingKeys();

    private static Map<String, String> buildInterestingKeys() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("hangupcausename", "Hangup cause");
        m.put("hangupcause", "Hangup cause code");
        m.put("cause", "Cause");
        m.put("causecode", "Cause code");
        m.put("sipresponsecode", "SIP response");
        m.put("dialblegstatus", "Dial leg status");
        m.put("callstatus", "Provider status");
        m.put("endreason", "End reason");
        m.put("errormessage", "Error");
        m.put("error", "Error");
        m.put("reason", "Reason");
        m.put("disposition", "Provider disposition");
        m.put("billduration", "Billed duration");
        m.put("billsec", "Billed seconds");
        m.put("currency", "Currency");
        return m;
    }

    /**
     * @param unmask when true (the caller's role may see full numbers — see
     *               {@link CallNumberVisibilityService}) the verbatim webhook body is
     *               included; otherwise only the curated diagnostic fields.
     */
    public CallDetailDTO detail(String callLogId, String instituteId, boolean unmask,
                                boolean canSeeDiagnostics) {
        TelephonyCallLog row = callLogRepository.findById(callLogId)
                .orElseThrow(() -> new VacademyException("Call not found"));

        // Cross-tenant guard: the id is a UUID, but never let one institute read another's call.
        if (row.getInstituteId() == null || !row.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Call not found");
        }

        CallDetailDTO.CallDetailDTOBuilder out = CallDetailDTO.builder()
                .id(row.getId())
                .providerType(row.getProviderType())
                .direction(row.getDirection())
                .status(row.getStatus())
                .terminationReason(row.getTerminationReason())
                .providerCallId(row.getProviderCallId())
                .startTime(row.getStartTime())
                .answerTime(row.getAnswerTime())
                .endTime(row.getEndTime())
                .durationSeconds(row.getDurationSeconds())
                .price(row.getPrice())
                .providerDetails(parseProviderDetails(row.getRawPayloadJson()))
                .rawProviderResponse(unmask ? row.getRawPayloadJson() : null);

        applyAiDiagnostics(out, callLogId, instituteId, canSeeDiagnostics);
        return out.build();
    }

    /**
     * Overlay the AI voice agent's per-call technical diagnostics (V416), when this
     * call was one. This is the whole point of the panel: the 2026-07 forensics that
     * found a wedged TTS socket and 179 deleted caller answers took a sweep of ~140k
     * log lines — the same verdict now rides on the detail call the UI already makes.
     *
     * <p>Best-effort like every other provider-shaped read here: a missing or broken
     * result must degrade to "no diagnostics", never fail the detail request.
     *
     * <p>Health/faults/headline are non-sensitive derived codes and go to any viewer.
     * The full blob is gated on the institute ADMIN role (NOT the phone-number
     * webhook body, because {@code turnTaking.answersDeletedSamples} contains
     * verbatim caller utterances and {@code infra.crash} contains raw error text.
     */
    private void applyAiDiagnostics(CallDetailDTO.CallDetailDTOBuilder out,
                                    String callLogId, String instituteId,
                                    boolean canSeeDiagnostics) {
        try {
            // Newest result wins — webhook retries/dupes can leave several rows per
            // call, same tie-break the Call History overlay uses.
            AiCallResult ai = aiCallResultRepository.findByCallLogIdIn(List.of(callLogId)).stream()
                    // Belt-and-braces tenant check; older rows may carry no institute.
                    .filter(r -> r.getInstituteId() == null || r.getInstituteId().equals(instituteId))
                    .max(Comparator.comparing(AiCallResult::getReceivedAt,
                            Comparator.nullsFirst(Comparator.naturalOrder())))
                    .orElse(null);
            if (ai == null) return;

            out.diagHealth(ai.getDiagHealth())
               .diagFaults(splitFaults(ai.getDiagFaults()))
               .followUp(ai.getFollowUp())
               .followUpGist(ai.getFollowUpGist())
               .callerWordCount(ai.getCallerWordCount());

            Map<String, Object> blob = ai.getDiagnostics();
            if (blob == null || blob.isEmpty()) return;

            out.diagHeadline(str(blob.get("headline")))
               .diagHeadlineText(str(blob.get("headlineText")))
               .diagRulesVersion(blob.get("rulesVersion") instanceof Number v ? v.intValue() : null)
               .ttsCacheActive(ttsCacheActive(blob))
               .diagnostics(canSeeDiagnostics ? blob : null);
        } catch (Exception e) {
            log.warn("call detail: could not load AI diagnostics for callLogId={}", callLogId, e);
        }
    }

    /**
     * Was the speech cache running on this call? Null-safe and total.
     *
     * <p>{@code cacheHits} is null exactly when the bot did not measure — the
     * cache was off for this agent, or the row predates the feature. It is 0 when
     * the cache ran and served nothing, which is a real reading and SHOULD show
     * the panel. That distinction is the whole reason the bot writes null rather
     * than zero, and it would be lost if the UI just tested for truthiness.
     */
    @SuppressWarnings("unchecked")
    private static Boolean ttsCacheActive(Map<String, Object> blob) {
        try {
            Object tts = blob.get("tts");
            if (!(tts instanceof Map)) return null;
            return ((Map<String, Object>) tts).get("cacheHits") != null ? Boolean.TRUE : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Split the denormalised comma-joined fault codes back into a list for the UI. */
    private static List<String> splitFaults(String joined) {
        if (joined == null || joined.isBlank()) return null;
        List<String> codes = new ArrayList<>();
        for (String part : joined.split(",")) {
            String code = part.trim();
            if (!code.isEmpty()) codes.add(code);
        }
        return codes.isEmpty() ? null : codes;
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : s;
    }

    /** Best-effort mine of the raw webhook body for the curated diagnostic keys. */
    private List<CallDetailDTO.KeyVal> parseProviderDetails(String rawPayloadJson) {
        List<CallDetailDTO.KeyVal> out = new ArrayList<>();
        if (rawPayloadJson == null || rawPayloadJson.isBlank()) return out;

        JsonNode root;
        try {
            root = objectMapper.readTree(rawPayloadJson);
        } catch (Exception e) {
            // Not JSON (e.g. form-encoded string) — nothing to structure; the raw
            // body (when unmasked) still carries the info.
            return out;
        }
        if (root == null || !root.isObject()) return out;

        // Index the body's keys lower-cased so we can match regardless of provider casing.
        Map<String, JsonNode> lowered = new LinkedHashMap<>();
        for (Iterator<String> it = root.fieldNames(); it.hasNext(); ) {
            String name = it.next();
            lowered.putIfAbsent(name.toLowerCase(), root.get(name));
        }
        for (Map.Entry<String, String> entry : INTERESTING_KEYS.entrySet()) {
            JsonNode node = lowered.get(entry.getKey());
            if (node == null || node.isNull() || node.isContainerNode()) continue;
            String value = node.asText("").trim();
            if (value.isEmpty()) continue;
            out.add(new CallDetailDTO.KeyVal(entry.getValue(), value));
        }
        return out;
    }
}
