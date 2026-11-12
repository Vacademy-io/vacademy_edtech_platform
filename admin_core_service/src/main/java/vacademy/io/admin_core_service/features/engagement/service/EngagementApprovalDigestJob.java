package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Line;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Need;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Once a day, in the institute's own morning, tells its admins and the engines' chosen contacts what
 * is waiting in the engagement inbox. Drafts wait 72 hours and then lapse; without this, an engine
 * that needs five approvals before it sends by itself can write hundreds of drafts nobody sees.
 *
 * <p>Runs hourly and sends to the institutes whose local hour matches, so each gets one notice a day
 * with no state to keep. Nothing waiting means no notice.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementApprovalDigestJob {

    private static final Map<String, String> NAMES = Map.of(
            "EMAIL", "Emails", "WHATSAPP", "WhatsApp messages", "IN_APP", "In-app messages",
            EngagementActionTypes.SCHEDULE_AI_CALL, "AI calls", EngagementActionTypes.ADD_NOTE, "Notes",
            EngagementActionTypes.CREATE_FOLLOWUP, "Follow-ups", EngagementActionTypes.ESCALATE, "Hand-overs",
            EngagementActionTypes.UPDATE_STATUS, "Status changes");

    private final EngagementApprovalDigestDao dao;
    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementCrmActionService crmActions;
    private final EngagementPointsOfContact pointsOfContact;
    private final InstituteTimezoneService timezoneService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${engagement.approval-digest.enabled:true}")
    private boolean enabled;

    /** Local hour (0-23) at which an institute gets its notice. */
    @Value("${engagement.approval-digest.hour:9}")
    private int hour;

    @Value("${engagement.autonomy.first-n:5}")
    private int defaultFirstN;

    @Value("${engagement.approval-digest.default-host:dash.vacademy.io}")
    private String defaultHost;

    @Scheduled(cron = "${engagement.approval-digest.cron:0 5 * * * *}")
    @SchedulerLock(name = "EngagementApprovalDigest", lockAtMostFor = "PT30M", lockAtLeastFor = "PT20M")
    public void run() {
        if (!enabled) return;
        Instant now = Instant.now();
        int sent = 0;
        for (String instituteId : memberRepository.institutesWithLiveEngines()) {
            try {
                if (now.atZone(timezoneService.getZone(instituteId)).getHour() != hour) continue;
                if (sendFor(instituteId, now)) sent++;
            } catch (Exception e) {
                log.warn("Approvals notice failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
        if (sent > 0) log.info("Approvals notice: sent to {} institute(s)", sent);
    }

    /** @return whether a notice went out (false when nothing is waiting) */
    boolean sendFor(String instituteId, Instant now) {
        List<EngagementApprovalDigestDao.Waiting> rows = dao.waiting(instituteId, now, now.plus(Duration.ofHours(24)));
        if (rows.isEmpty()) return false;
        Map<String, EngagementEngine> engines = new LinkedHashMap<>();
        for (EngagementEngine e : engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId)) {
            engines.put(e.getId(), e);
        }
        List<Line> lines = new ArrayList<>();
        Set<String> contacts = new LinkedHashSet<>();
        for (EngagementApprovalDigestDao.Waiting w : rows) {
            EngagementEngine engine = engines.get(w.engineId());
            if (engine == null) continue;
            Line line = lineFor(engine, w);
            if (line == null) continue;
            lines.add(line);
            contacts.addAll(notifyIds(engine));
        }
        // Replies first, then the biggest piles.
        lines.sort(Comparator.comparing((Line l) -> l.need() == Need.REPLY ? 0 : 1)
                .thenComparing(Line::count, Comparator.reverseOrder()));
        String host = dao.adminPortalHost(instituteId);
        if (host == null || host.isBlank()) host = defaultHost;
        String inboxUrl = (host.startsWith("http") ? host : "https://" + host).replaceAll("/+$", "")
                + "/engagement-engines/inbox";
        EngagementApprovalDigest.Notice notice = EngagementApprovalDigest.build(lines,
                dao.lapsed(instituteId, now.minus(Duration.ofHours(24)), now), inboxUrl, now);
        if (notice == null) return false;
        pointsOfContact.alertTeam(instituteId, contacts, notice.title(), notice.html(), "ENGAGEMENT_APPROVALS",
                instituteId + ":" + now.atZone(timezoneService.getZone(instituteId)).toLocalDate());
        return true;
    }

    /**
     * What this group needs from a person, or null when it needs nothing: rows the engine will run
     * by itself (set to run on its own, approvals earned, nothing blocking) are only waiting for
     * their time.
     */
    Line lineFor(EngagementEngine engine, EngagementApprovalDigestDao.Waiting w) {
        boolean crm = EngagementActionTypes.isCrmAction(w.actionType());
        String key = crm ? w.actionType() : w.channel();
        if (key == null) return null;
        String what = NAMES.getOrDefault(key, key);
        if ("REPLY".equals(w.kind())) {
            return new Line(engine.getName(), what, Need.REPLY, w.count(), w.lapsingSoon(), 0, w.oldest());
        }
        int threshold = engine.getFirstN() != null ? engine.getFirstN() : defaultFirstN;
        boolean auto;
        long approved;
        if (crm) {
            auto = crmActions.autoActions(engine).contains(key);
            approved = threshold <= 0 ? 0 : actionRepository.countApprovedCrmActions(engine.getId(), key);
        } else {
            auto = channelAuto(engine, key);
            approved = threshold <= 0 ? 0 : actionRepository.countApprovedSendsForChannel(engine.getId(), key);
        }
        if (!auto || Boolean.TRUE.equals(engine.getAutoSendKilled())) {
            return new Line(engine.getName(), what, Need.MANUAL, w.count(), w.lapsingSoon(), 0, w.oldest());
        }
        if (threshold > 0 && approved < threshold) {
            return new Line(engine.getName(), what, Need.TRIAL, w.count(), w.lapsingSoon(),
                    (int) (threshold - approved), w.oldest());
        }
        if (w.blocked()) {
            return new Line(engine.getName(), what, Need.BLOCKED, w.count(), w.lapsingSoon(), 0, w.oldest());
        }
        return null;
    }

    private boolean channelAuto(EngagementEngine engine, String channel) {
        try {
            JsonNode cfg = objectMapper.readTree(engine.getChannels()).path(channel);
            return cfg.path("enabled").asBoolean(false) && cfg.path("auto").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    private List<String> notifyIds(EngagementEngine engine) {
        try {
            return objectMapper.readValue(engine.getNotifyUserIds() == null ? "[]" : engine.getNotifyUserIds(),
                    new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }
}
