package vacademy.io.admin_core_service.features.telephony.demo;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.telephony.enums.CallDirection;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.institute.entity.Institute;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Public "Try the AI call" demo. The page saves who is calling (name, organisation,
 * language) against their mobile number; when that number calls the demo line, the
 * voice-bot call-context {@link #bindInbound binds} the request and answers as the
 * visitor's own admission counsellor in the language they picked.
 */
@Service
@RequiredArgsConstructor
public class AiDemoCallService {

    private static final Logger log = LoggerFactory.getLogger(AiDemoCallService.class);

    static final int MAX_NAME = 80;
    static final int MAX_ORG = 120;

    private final AiDemoCallRequestRepository repo;
    private final InstituteRepository instituteRepository;
    private final InstituteSettingService instituteSettingService;
    private final TelephonyCallLogRepository callLogRepo;

    private final ObjectMapper mapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /** A bound request plus the language entry the call should speak. */
    public record Binding(AiDemoCallRequest request, AiDemoCallSettings.Language language, String agentId) {

        /** Lead fields for the bot: these fill the institute_name placeholder in prompt and opening. */
        public Map<String, String> leadFields() {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("institute name", request.getOrganisation());
            m.put("organisation", request.getOrganisation());
            m.put("preferred language", language.getLabel());
            return m;
        }
    }

    /** Thrown for input the visitor can fix; the message is shown on the page. */
    public static class DemoCallException extends RuntimeException {
        private final int status;
        public DemoCallException(int status, String message) { super(message); this.status = status; }
        public int getStatus() { return status; }
    }

    // ── settings ────────────────────────────────────────────────────────────

    /** The institute setting, or empty when absent or unreadable. Never throws. */
    public Optional<AiDemoCallSettings> settings(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Optional.empty();
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) return Optional.empty();
            Object data = instituteSettingService.getSettingData(institute,
                    SettingKeyEnums.AI_DEMO_CALL_SETTING.name());
            if (data == null) return Optional.empty();
            return Optional.ofNullable(mapper.convertValue(data, AiDemoCallSettings.class));
        } catch (Exception e) {
            log.warn("ai-demo-call: could not read AI_DEMO_CALL_SETTING for {}: {}", instituteId, e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<AiDemoCallSettings> enabledSettings(String instituteId) {
        return settings(instituteId).filter(AiDemoCallSettings::isEnabled);
    }

    // ── public page ─────────────────────────────────────────────────────────

    @Transactional
    public AiDemoCallRequest createRequest(String instituteId, String name, String organisation,
                                           String phone, String language, String source, String clientIp) {
        AiDemoCallSettings s = enabledSettings(instituteId)
                .orElseThrow(() -> new DemoCallException(409, "The live demo is paused right now."));
        String cleanName = clean(name, MAX_NAME);
        String cleanOrg = clean(organisation, MAX_ORG);
        if (cleanName == null || cleanName.length() < 2) {
            throw new DemoCallException(400, "Please enter your name.");
        }
        if (cleanOrg == null || cleanOrg.length() < 2) {
            throw new DemoCallException(400, "Please enter your organisation name.");
        }
        String last10 = indianMobile(phone);
        if (last10 == null) {
            throw new DemoCallException(400, "Please enter a valid 10-digit Indian mobile number.");
        }
        AiDemoCallSettings.Language lang = s.language(language)
                .orElseThrow(() -> new DemoCallException(400, "Please choose a language."));

        repo.supersedePending(instituteId, last10);
        Instant now = Instant.now();
        AiDemoCallRequest r = AiDemoCallRequest.builder()
                .id(UUID.randomUUID().toString())
                .instituteId(instituteId)
                .phone(last10)
                .phoneRaw(phone == null ? null : phone.trim().substring(0, Math.min(32, phone.trim().length())))
                .visitorName(cleanName)
                .organisation(cleanOrg)
                .language(lang.getCode())
                .status(AiDemoCallRequest.PENDING)
                .source(clean(source, 160))
                .clientIp(clientIp == null ? null : clientIp.substring(0, Math.min(64, clientIp.length())))
                .createdAt(Timestamp.from(now))
                .expiresAt(Timestamp.from(now.plus(Duration.ofMinutes(s.ttlMinutesOrDefault()))))
                .build();
        return repo.save(r);
    }

    /** PENDING, EXPIRED, CONNECTED, ENDED or SUPERSEDED. Empty when the id is unknown. */
    public Optional<String> status(String instituteId, String requestId) {
        return repo.findByIdAndInstituteId(requestId, instituteId).map(r -> {
            if (AiDemoCallRequest.PENDING.equals(r.getStatus())) {
                return r.getExpiresAt() != null && r.getExpiresAt().toInstant().isBefore(Instant.now())
                        ? "EXPIRED" : "PENDING";
            }
            if (AiDemoCallRequest.CONNECTED.equals(r.getStatus()) && r.getCallLogId() != null) {
                boolean ended = callLogRepo.findById(r.getCallLogId())
                        .map(c -> CallStatus.parseOrDefault(c.getStatus()).isTerminal())
                        .orElse(false);
                return ended ? "ENDED" : "CONNECTED";
            }
            return r.getStatus();
        });
    }

    // ── voice-bot call-context ──────────────────────────────────────────────

    /**
     * For an INBOUND call on an institute with the demo enabled: the request this call
     * is for (already bound to it, or the newest waiting one from the caller's number,
     * which is then claimed). Empty for every other call. Never throws: a demo problem
     * must never break a real inbound call.
     */
    @Transactional
    public Optional<Binding> bindInbound(TelephonyCallLog row) {
        try {
            if (row == null || !CallDirection.INBOUND.name().equalsIgnoreCase(row.getDirection())) {
                return Optional.empty();
            }
            AiDemoCallSettings s = enabledSettings(row.getInstituteId()).orElse(null);
            if (s == null) return Optional.empty();

            AiDemoCallRequest r = repo.findFirstByCallLogId(row.getId()).orElse(null);
            if (r == null) {
                String last10 = lastTen(row.getFromNumber());
                if (last10 == null) return Optional.empty();
                Timestamp now = Timestamp.from(Instant.now());
                r = repo.findFirstByInstituteIdAndPhoneAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                        row.getInstituteId(), last10, AiDemoCallRequest.PENDING, now).orElse(null);
                if (r == null) return Optional.empty();
                if (repo.bind(r.getId(), row.getId(), now) == 0) return Optional.empty();
                log.info("ai-demo-call: bound request {} to call {} ({})", r.getId(), row.getId(), r.getLanguage());
            }
            AiDemoCallSettings.Language lang = s.language(r.getLanguage()).orElse(null);
            if (lang == null) return Optional.empty();
            String agentId = s.getAgentId() == null || s.getAgentId().isBlank() ? null : s.getAgentId().trim();
            return Optional.of(new Binding(r, lang, agentId));
        } catch (Exception e) {
            log.warn("ai-demo-call: bind skipped for call {}: {}", row == null ? null : row.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** The ten-digit Indian mobile number in any common spelling, or null. */
    static String indianMobile(String raw) {
        String t = lastTen(raw);
        if (t == null) return null;
        String digits = raw.replaceAll("[^0-9]", "");
        boolean shapeOk = digits.length() == 10
                || (digits.length() == 11 && digits.startsWith("0"))
                || (digits.length() == 12 && digits.startsWith("91"));
        return shapeOk && t.charAt(0) >= '6' ? t : null;
    }

    /** Last ten digits of a phone number (inbound caller ids arrive as 91..., +91... or 0...). */
    static String lastTen(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("[^0-9]", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    /** Trimmed, control characters and braces removed (braces would read as bot placeholders), capped. */
    static String clean(String s, int max) {
        if (s == null) return null;
        String t = s.replaceAll("[\\p{Cntrl}{}<>]", " ").replaceAll("\\s+", " ").trim();
        if (t.isEmpty()) return null;
        return t.length() > max ? t.substring(0, max).trim() : t;
    }
}
