package vacademy.io.admin_core_service.features.telephony.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.telephony.enums.CallDirection;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Public "Try the AI call" demo, driven entirely by a lead list.
 *
 * The visitor fills the telleo.ai/try-ai-call form, which posts a normal lead (name, phone,
 * Organisation, Language) to a demo audience whose setting_json carries
 * {"tryAiCall": {"agentId": "..."}}. When that phone calls the institute's AI line, the
 * voice-bot call context {@link #bindInbound binds} the call to the lead: the audience's
 * agent answers in the lead's language, as the admission counsellor of the lead's
 * organisation, and the call is attributed to the lead. No institute setting, no new table.
 * Turning the audience off (status not ACTIVE) turns the demo off.
 */
@Service
public class AiDemoCallService {

    private static final Logger log = LoggerFactory.getLogger(AiDemoCallService.class);

    /** How long after filling the form a call is still treated as a demo call. */
    static final Duration WINDOW = Duration.ofHours(12);
    static final String MARKER = "tryAiCall";

    @Autowired private AudienceResponseRepository audienceResponseRepository;
    @Autowired private AudienceRepository audienceRepository;
    @Autowired private TelephonyCallLogRepository callLogRepo;
    // @Lazy: AudienceService is a large service; avoid an eager bean cycle (same as the
    // voice-bot controller). Only its read-only custom field lookup is used.
    @Autowired @Lazy private AudienceService audienceService;

    private final ObjectMapper mapper = new ObjectMapper();

    /** The lead an inbound call is for, and how the call should sound. */
    public record Binding(String leadId, String userId, String visitorName, String organisation,
                          AiDemoCallLanguages.Language language, String agentId) {

        /** Lead fields for the bot: these fill the institute_name placeholder in prompt and opening. */
        public Map<String, String> leadFields() {
            Map<String, String> m = new LinkedHashMap<>();
            if (organisation != null) {
                m.put("institute name", organisation);
                m.put("organisation", organisation);
            }
            m.put("preferred language", language.label());
            return m;
        }
    }

    /**
     * For an INBOUND call: the newest Try-the-AI-call lead from the caller's number in this
     * institute, submitted within {@link #WINDOW}. Attributes the call to that lead when it is
     * not attributed yet. Empty for every other call. Never throws: a demo problem must never
     * break a real inbound call.
     */
    public Optional<Binding> bindInbound(TelephonyCallLog row) {
        try {
            if (row == null || !CallDirection.INBOUND.name().equalsIgnoreCase(row.getDirection())) {
                return Optional.empty();
            }
            String last10 = lastTen(row.getFromNumber());
            if (last10 == null) return Optional.empty();
            AudienceResponse lead = audienceResponseRepository.findLatestTryAiCallLead(row.getInstituteId(),
                    last10, Timestamp.from(Instant.now().minus(WINDOW))).orElse(null);
            if (lead == null) return Optional.empty();
            String agentId = audienceRepository.findById(lead.getAudienceId())
                    .map(this::agentIdOf).orElse(null);

            Map<String, String> fields = audienceService.getLeadCustomFields(lead.getId());
            AiDemoCallLanguages.Language lang = AiDemoCallLanguages.find(field(fields, "language", "preferred language"))
                    .orElseGet(() -> AiDemoCallLanguages.find("hinglish").orElseThrow());
            String org = field(fields, "organisation", "organization", "institute name", "institute", "company");
            String name = firstNonBlank(field(fields, "full name", "name"), lead.getParentName());

            if (row.getResponseId() == null && lead.getUserId() != null) {
                callLogRepo.attachLeadIfUnattributed(row.getId(), lead.getId(), lead.getUserId());
            }
            log.info("ai-demo-call: call {} is lead {} ({})", row.getId(), lead.getId(), lang.code());
            return Optional.of(new Binding(lead.getId(), lead.getUserId(), name, org, lang, agentId));
        } catch (Exception e) {
            log.warn("ai-demo-call: bind skipped for call {}: {}", row == null ? null : row.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Status of a demo lead for the page: PENDING, CONNECTED, ENDED or EXPIRED. Empty when the
     * id is not a lead in a Try-the-AI-call list, so the endpoint reveals nothing else.
     */
    public Optional<String> status(String leadId) {
        AudienceResponse lead = leadId == null ? null : audienceResponseRepository.findById(leadId).orElse(null);
        if (lead == null) return Optional.empty();
        boolean demoList = audienceRepository.findById(lead.getAudienceId())
                .map(a -> a.getSettingJson() != null && a.getSettingJson().contains("\"" + MARKER + "\""))
                .orElse(false);
        if (!demoList) return Optional.empty();

        Instant since = lead.getSubmittedAt() == null ? Instant.EPOCH : lead.getSubmittedAt().toInstant();
        Optional<TelephonyCallLog> call = callLogRepo
                .findFirstByResponseIdAndDirectionOrderByCreatedAtDesc(leadId, CallDirection.INBOUND.name())
                .filter(c -> c.getCreatedAt() == null || !c.getCreatedAt().toInstant().isBefore(since));
        if (call.isPresent()) {
            return Optional.of(CallStatus.parseOrDefault(call.get().getStatus()).isTerminal() ? "ENDED" : "CONNECTED");
        }
        return Optional.of(since.plus(WINDOW).isBefore(Instant.now()) ? "EXPIRED" : "PENDING");
    }

    /** The audience's tryAiCall.agentId, or null (the IVR node's agent then answers). */
    String agentIdOf(Audience audience) {
        if (audience == null || audience.getSettingJson() == null) return null;
        try {
            JsonNode id = mapper.readTree(audience.getSettingJson()).path(MARKER).path("agentId");
            return id.isTextual() && !id.asText().isBlank() ? id.asText().trim() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** First non-blank value among the given field labels, matched case-insensitively. */
    static String field(Map<String, String> fields, String... labels) {
        if (fields == null || fields.isEmpty()) return null;
        Map<String, String> byLabel = new LinkedHashMap<>();
        fields.forEach((k, v) -> {
            if (k != null && v != null && !v.isBlank()) byLabel.put(k.trim().toLowerCase(Locale.ROOT), v.trim());
        });
        for (String l : labels) {
            String v = byLabel.get(l);
            if (v != null) return clean(v);
        }
        return null;
    }

    /** Last ten digits of a phone number (inbound caller ids arrive as 91..., +91... or 0...). */
    static String lastTen(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("[^0-9]", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    /** Braces removed (they would read as bot placeholders), whitespace collapsed, capped at 120. */
    static String clean(String s) {
        String t = s.replaceAll("[\\p{Cntrl}{}<>]", " ").replaceAll("\\s+", " ").trim();
        if (t.isEmpty()) return null;
        return t.length() > 120 ? t.substring(0, 120).trim() : t;
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : (b != null && !b.isBlank() ? b.trim() : null);
    }
}
