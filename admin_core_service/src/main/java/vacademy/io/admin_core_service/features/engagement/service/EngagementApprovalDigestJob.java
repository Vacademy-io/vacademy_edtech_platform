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
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Item;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Line;
import vacademy.io.admin_core_service.features.engagement.service.EngagementApprovalDigest.Need;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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

    private final EngagementApprovalDigestDao dao;
    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementCrmActionService crmActions;
    private final EngagementPointsOfContact pointsOfContact;
    private final InstituteTimezoneService timezoneService;
    private final ContactResolver contactResolver;
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
        String host = dao.adminPortalHost(instituteId);
        if (host == null || host.isBlank()) host = defaultHost;
        String inboxUrl = (host.startsWith("http") ? host : "https://" + host).replaceAll("/+$", "")
                + "/engagement-engines/inbox";

        // The people a person must act on, by name; they are taken out of the counts below.
        Set<String> contacts = new LinkedHashSet<>();
        List<Item> items = new ArrayList<>();
        Map<String, Integer> listed = new HashMap<>();
        List<EngagementApprovalDigestDao.Candidate> candidates = dao.candidates(instituteId, now);
        Map<String, String> names = names(candidates);
        for (EngagementApprovalDigestDao.Candidate c : candidates) {
            EngagementEngine engine = engines.get(c.engineId());
            if (engine == null) continue;
            Item item = EngagementApprovalDigest.classify(c, names.get(c.memberId()), engine.getName(),
                    EngagementApprovalDigest.taskLink(inboxUrl, c.id()));
            if (item == null) continue;
            items.add(item);
            contacts.addAll(notifyIds(engine));
            listed.merge(groupKey(c.engineId(), c.kind(), c.channel(), c.actionType(), c.blocked()), 1, Integer::sum);
        }

        List<Line> lines = new ArrayList<>();
        for (EngagementApprovalDigestDao.Waiting w : rows) {
            EngagementEngine engine = engines.get(w.engineId());
            if (engine == null) continue;
            int left = w.count() - listed.getOrDefault(
                    groupKey(w.engineId(), w.kind(), w.channel(), w.actionType(), w.blocked()), 0);
            if (left <= 0) continue;
            Line line = lineFor(engine, new EngagementApprovalDigestDao.Waiting(w.engineId(), w.kind(), w.channel(),
                    w.actionType(), w.blocked(), left, Math.min(left, w.lapsingSoon()), w.oldest()), inboxUrl);
            if (line == null) continue;
            lines.add(line);
            contacts.addAll(notifyIds(engine));
        }
        // The biggest piles first.
        lines.sort(Comparator.comparing(Line::count, Comparator.reverseOrder()));
        EngagementApprovalDigest.Notice notice = EngagementApprovalDigest.build(items, lines,
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
    Line lineFor(EngagementEngine engine, EngagementApprovalDigestDao.Waiting w, String inboxUrl) {
        boolean crm = EngagementActionTypes.isCrmAction(w.actionType());
        String key = crm ? w.actionType() : w.channel();
        if (key == null) return null;
        String what = EngagementApprovalDigest.whatOf(w.channel(), w.actionType());
        String link = "REPLY".equals(w.kind())
                ? EngagementApprovalDigest.engineLink(inboxUrl, engine.getId()) + (inboxUrl == null ? "" : "&kind=REPLY")
                : EngagementApprovalDigest.groupLink(inboxUrl, engine.getId(), w.channel(), w.actionType());
        if ("REPLY".equals(w.kind())) {
            return line(engine, what, Need.REPLY, w, 0, link);
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
            return line(engine, what, Need.MANUAL, w, 0, link);
        }
        if (threshold > 0 && approved < threshold) {
            return line(engine, what, Need.TRIAL, w, (int) (threshold - approved), link);
        }
        if (w.blocked()) {
            return line(engine, what, Need.BLOCKED, w, 0, link);
        }
        return null;
    }

    private static Line line(EngagementEngine engine, String what, Need need, EngagementApprovalDigestDao.Waiting w,
                             int remaining, String link) {
        return new Line(engine.getId(), engine.getName(), what, need, w.count(), w.lapsingSoon(), remaining,
                w.oldest(), link);
    }

    private static String groupKey(String engineId, String kind, String channel, String actionType, boolean blocked) {
        return engineId + "|" + kind + "|" + channel + "|" + actionType + "|" + blocked;
    }

    /** Lead names of the candidates' members, by member id; a failed lookup only loses the names. */
    private Map<String, String> names(List<EngagementApprovalDigestDao.Candidate> candidates) {
        Map<String, String> names = new HashMap<>();
        if (candidates.isEmpty()) return names;
        try {
            List<String> ids = candidates.stream().map(EngagementApprovalDigestDao.Candidate::memberId)
                    .filter(java.util.Objects::nonNull).distinct().toList();
            for (Subject s : contactResolver.resolve(memberRepository.findAllById(ids))) {
                if (s.getName() != null && !s.getName().isBlank()) names.put(s.getMemberId(), s.getName());
            }
        } catch (Exception e) {
            log.warn("Approvals notice: lead names unavailable: {}", e.getMessage());
        }
        return names;
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
