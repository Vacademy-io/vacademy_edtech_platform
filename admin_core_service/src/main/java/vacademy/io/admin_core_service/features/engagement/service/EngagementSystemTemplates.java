package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallEngagementProvisioner;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The few WhatsApp messages the engine sends outside a conversation the lead started: a thank-you after
 * "not interested", and the confirmation of a booked meeting. Each is ONE dynamic template per institute
 * ({{1}} name, the meeting time and link as variables), shared by every lead: looked up first (any engine's
 * approved copy of it is used), created and sent to Meta only when the institute has none, and never a
 * second one while the first is still in review. Nothing here is written per lead.
 */
@Service
@Slf4j
public class EngagementSystemTemplates {

    public enum Kind {
        /** Thanks after "not interested": the lead's name, the institute. */
        NOT_INTERESTED_THANKS("SYS:NOT_INTERESTED_THANKS", "thank_you_not_interested",
                "Hi {{1}}, thank you for speaking with us and for your time. We have noted that this is not the right time, "
                        + "and we will not call you again. If you change your mind, you can reach {{2}} on this number any time.",
                List.of("name", "institute"), List.of("Asha", "{institute}")),
        /** A booked meeting: the lead's name, the institute, when and where. */
        MEETING_CONFIRMATION("SYS:MEETING_CONFIRMATION", "meeting_confirmation",
                "Hi {{1}}, your meeting with {{2}} is confirmed for {{3}}. Join here: {{4}}. "
                        + "If you need another time, just reply to this message.",
                List.of("name", "institute", "meeting_time", "meeting_link"),
                List.of("Asha", "{institute}", "Fri 30 Oct, 10:00 AM IST", "https://meet.google.com/abc-defg-hij"));

        public final String purpose, baseName, body;
        public final List<String> variables, samples;

        Kind(String purpose, String baseName, String body, List<String> variables, List<String> samples) {
            this.purpose = purpose;
            this.baseName = baseName;
            this.body = body;
            this.variables = variables;
            this.samples = samples;
        }
    }

    /** What the institute has for one kind: usable now, on its way, or not available. */
    public record State(Status status, String name, String language, List<String> variables, String templateId) {
        public boolean usable() { return status == Status.APPROVED; }
    }

    public enum Status { APPROVED, PENDING, UNAVAILABLE }

    private static final String LANGUAGE = "en";

    @Autowired @Lazy private EngagementTemplateProposalRepository proposals;
    @Autowired @Lazy private EngagementTemplateProposalService proposalService;
    @Autowired @Lazy private AiCallEngagementProvisioner provisioner;
    @Autowired @Lazy private EngagementChannelReadiness readiness;
    @Autowired @Lazy private InstituteRepository instituteRepository;
    @Autowired @Lazy private EngagementEngineRepository engineRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * The institute's template for this kind. An approved one (from any engine) is used as it is. With
     * none, and WhatsApp set up for the institute, one is created and submitted to Meta: it is
     * PENDING until Meta approves, and the caller sends by email in the meantime. One at a time.
     */
    public State ensure(String instituteId, Kind kind) {
        try {
            State found = lookup(instituteId, kind);
            if (found != null) return found;
            var wa = readiness.check(instituteId).get("WHATSAPP");
            if (wa == null || !wa.ready() || !usesEngineOnWhatsapp(instituteId)) {
                return new State(Status.UNAVAILABLE, null, LANGUAGE, kind.variables, null);
            }
            synchronized (lockFor(instituteId, kind)) {
                found = lookup(instituteId, kind); // another thread may have created it meanwhile
                if (found != null) return found;
                create(instituteId, kind);
            }
            State created = lookup(instituteId, kind);
            return created != null ? created : new State(Status.PENDING, null, LANGUAGE, kind.variables, null);
        } catch (Exception e) {
            log.warn("System template {} for institute {}: {}", kind, instituteId, e.getMessage());
            return new State(Status.UNAVAILABLE, null, LANGUAGE, kind.variables, null);
        }
    }

    /**
     * Creating a template at Meta is a visible step in the institute's WhatsApp account, so it only happens
     * for an institute that runs an engagement engine on WhatsApp (a live engine, not the system one).
     * An institute that merely has WhatsApp configured never gets a template made behind its back.
     */
    boolean usesEngineOnWhatsapp(String instituteId) {
        for (EngagementEngine e : engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId)) {
            if (e.isSystemManaged()) continue;
            if (!"ACTIVE".equals(e.getStatus()) && !"DRY_RUN".equals(e.getStatus())) continue;
            if (e.getChannels() != null && e.getChannels().replace(" ", "").contains("\"WHATSAPP\":{\"enabled\":true")) return true;
        }
        return false;
    }

    private static String lockFor(String instituteId, Kind kind) {
        return (instituteId + "|" + kind.name()).intern();
    }

    private State lookup(String instituteId, Kind kind) {
        List<EngagementTemplateProposal> rows = proposals.findSystemTemplates(instituteId, kind.purpose, LANGUAGE);
        if (rows.isEmpty()) return null;
        EngagementTemplateProposal best = rows.get(0);
        boolean ok = "META_APPROVED".equals(best.getStatus()) || "META_RECATEGORISED".equals(best.getStatus());
        return new State(ok ? Status.APPROVED : Status.PENDING, best.getName(), best.getLanguage() == null ? LANGUAGE : best.getLanguage(),
                names(best.getVariableNames(), kind), best.getNotificationTemplateId());
    }

    private List<String> names(String json, Kind kind) {
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            return kind.variables;
        }
    }

    private void create(String instituteId, Kind kind) throws JsonProcessingException {
        String institute = instituteRepository.findById(instituteId).map(Institute::getInstituteName)
                .filter(n -> n != null && !n.isBlank()).orElse("our team");
        String engineId = provisioner.engineIdFor(instituteId);
        EngagementTemplateProposal row = new EngagementTemplateProposal();
        row.setEngineId(engineId);
        row.setInstituteId(instituteId);
        row.setName(kind.baseName + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 6));
        row.setLanguage(LANGUAGE);
        row.setPurpose(kind.purpose);
        row.setProposedBody(kind.body);
        row.setProposedCategory("UTILITY");
        row.setStatus("AI_PROPOSED");
        row.setRound(1);
        row.setVariableNames(objectMapper.writeValueAsString(kind.variables));
        row.setSampleValues(objectMapper.writeValueAsString(kind.samples.stream()
                .map(s -> s.replace("{institute}", institute)).toList()));
        // Sources describe where a value comes from at send time: the lead's name, a fixed institute name.
        // The meeting's time and link are given by the sender; they are not read from the lead.
        Map<String, String> sources = new java.util.LinkedHashMap<>();
        sources.put("name", "profile.firstName");
        sources.put("institute", "static:" + institute);
        row.setVariableSources(objectMapper.writeValueAsString(sources));
        row.setRationale("Made once for the whole institute: every lead gets this same template with their own values.");
        row.setCreatedBy("system");
        EngagementTemplateProposal saved = proposals.save(row);
        proposalService.approve(saved.getId(), instituteId);
        proposalService.submit(saved.getId(), instituteId, "system");
        log.info("System template {} created and submitted to Meta for institute {}", kind, instituteId);
    }
}
