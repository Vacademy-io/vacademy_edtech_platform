package vacademy.io.admin_core_service.features.telephony.providers.vacademy_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.spi.AiCallReportParser;
import vacademy.io.admin_core_service.features.telephony.spi.dto.AiCallReport;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Parses our own voice-bot's end-of-call report. We author both sides of this
 * contract (the bot emits camelCase keys mirroring {@link AiCallReport}), so this
 * is a lenient pass-through: missing optional fields never throw.
 */
@Component
public class VacademyAiReportParser implements AiCallReportParser {

    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public String providerType() {
        return ProviderType.VACADEMY_AI;
    }

    @Override
    public AiCallReport parse(JsonNode n) {
        Map<String, Object> metadata = readMap(n.get("metadata"));
        return AiCallReport.builder()
                .provider(ProviderType.VACADEMY_AI)
                .callUuid(text(n, "call_uuid", "callUuid"))
                .correlationId(firstNonBlank(text(n, "correlationId"),
                        metadata == null ? null : asString(metadata.get("correlationId"))))
                .direction(text(n, "direction"))
                .campaignType(text(n, "campaignType"))
                .campaignId(text(n, "campaignId", "agentId"))
                .status(text(n, "status"))
                .durationSeconds(intOrNull(n, "durationSeconds"))
                .callStart(instantOrNull(n, "callStart"))
                .disposition(text(n, "disposition"))
                .leadResponse(text(n, "leadResponse"))
                .leadRating(intOrNull(n, "leadRating"))
                .callRating(intOrNull(n, "callRating"))
                .interestLevel(text(n, "interestLevel"))
                .summary(text(n, "summary"))
                .extractedQa(readMap(n.get("extractedQa")))
                .metadata(metadata)
                .diagnostics(readMap(n.get("diagnostics")))
                .followUp(text(n, "followUp"))
                .followUpGist(text(n, "followUpGist"))
                .callerWordCount(intOrNull(n, "callerWordCount"))
                .recordingUrl(text(n, "recordingUrl"))
                .transcript(text(n, "transcript"))
                .callbackRequested(boolOrNull(n, "callbackRequested"))
                .callbackAt(instantOrNull(n, "callbackAt"))
                .callbackTimeText(text(n, "callbackTimeText"))
                .transferAttempted(boolOrNull(n, "transferAttempted"))
                .ninePressed(boolOrNull(n, "ninePressed"))
                .transferStatus(text(n, "transferStatus"))
                .transferTriggered(text(n, "transferTriggered"))
                .hangupCause(text(n, "hangupCause"))
                .hangupCode(intOrNull(n, "hangupCode"))
                .hangupSource(text(n, "hangupSource"))
                .phoneNumber(text(n, "phoneNumber"))
                .dialCode(text(n, "dialCode"))
                .callRetry(intOrNull(n, "callRetry"))
                .customerName(text(n, "customerName"))
                .customerEmail(text(n, "customerEmail"))
                .rawPayload(n.toString())
                .build();
    }

    private static String text(JsonNode n, String... keys) {
        for (String k : keys) {
            JsonNode v = n.get(k);
            if (v != null && !v.isNull()) {
                String s = v.asText(null);
                if (s != null && !s.isBlank()) return s;
            }
        }
        return null;
    }

    private static Integer intOrNull(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null || v.isNull()) return null;
        if (v.isNumber()) return v.intValue();
        try { return (int) Double.parseDouble(v.asText()); } catch (Exception e) { return null; }
    }

    private static Boolean boolOrNull(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null || v.isNull()) return null;
        if (v.isBoolean()) return v.booleanValue();
        return Boolean.parseBoolean(v.asText());
    }

    private static Instant instantOrNull(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null || v.isNull()) return null;
        try { return Instant.parse(v.asText()); } catch (Exception e) { return null; }
    }

    private Map<String, Object> readMap(JsonNode v) {
        if (v == null || v.isNull() || !v.isObject()) return null;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = mapper.convertValue(v, LinkedHashMap.class);
            return m;
        } catch (Exception e) {
            return null;
        }
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return null;
    }
}
