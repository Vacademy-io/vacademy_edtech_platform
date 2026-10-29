package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.service.AudienceOptOutService;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries.LiveMember;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * What happens when a lead reaches an outcome that ends the engine's work (design: exit handlers).
 * Each exit takes the member out of its engines, cancels what is still pending for it, and mirrors
 * the outcome into the CRM so the lead row, its status and its timeline say what happened:
 * <ul>
 *   <li>Opted out: the lead goes to the institute's opt-out list (an account holder, the same path
 *       a WhatsApp STOP keyword takes) and its lead rows are marked OPTED_OUT.</li>
 *   <li>Not interested: the lead's status moves to the institute's "Not interested" status, else
 *       the system "Lost" status.</li>
 *   <li>Converted (marked in the CRM): the member leaves within one exit sweep.</li>
 * </ul>
 * Every CRM write is best effort: a CRM failure never undoes the engine's own stop.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementLeadOutcomeService {

    static final String STATUS_SOURCE = "ENGAGEMENT_ENGINE";
    private static final String ACTOR_NAME = "Engagement Engine";
    private static final int MAX_TEXT = 4000;

    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementCrmMirrorDao crmDao;
    private final PolicyGate policyGate;

    /** Lazy and optional: the audience feature reaches the workflow engine, which must not be built first. */
    @Autowired(required = false)
    @Lazy
    private AudienceOptOutService audienceOptOutService;

    @Autowired(required = false)
    @Lazy
    private LeadStatusService leadStatusService;

    @Autowired(required = false)
    private TimelineEventService timelineEventService;

    // ==================== Opted out ====================

    /**
     * Mirror an opt-out the engine already applied to its own members. An account holder moves to
     * the opt-out list (which also fires the institute's opt-out workflow, as for a STOP keyword);
     * every lead row these members stand for is marked OPTED_OUT; the lead timeline gets the reason.
     */
    public void mirrorOptOut(String instituteId, List<? extends LiveMember> members, String channel, String replyText) {
        if (members == null || members.isEmpty()) return;
        Set<String> userIds = new LinkedHashSet<>();
        Set<String> leadRows = new LinkedHashSet<>();
        Map<String, String> userOfLead = new LinkedHashMap<>();
        for (LiveMember m : members) {
            if (m.getUserId() != null) userIds.add(m.getUserId());
            if (m.getAudienceResponseId() != null) {
                leadRows.add(m.getAudienceResponseId());
                userOfLead.putIfAbsent(m.getAudienceResponseId(), m.getUserId());
            }
        }
        // The opt-out list first: it moves the person's most recent ACTIVE lead row, which marking the
        // rows below would hide from it.
        if (audienceOptOutService != null) {
            for (String userId : userIds) {
                try {
                    audienceOptOutService.moveUserToOptOutAudience(userId, instituteId, channel);
                } catch (Exception e) {
                    log.warn("Opt-out list move failed for user {} (engine opt-out stands): {}", userId, e.getMessage());
                }
            }
        }
        try {
            crmDao.markLeadsOptedOut(instituteId, leadRows);
        } catch (Exception e) {
            log.warn("Marking {} lead row(s) opted out failed (engine opt-out stands): {}", leadRows.size(), e.getMessage());
        }
        for (String row : leadRows) {
            timeline(row, userOfLead.get(row), LeadJourneyActionType.STATUS_CHANGED,
                    "Opted out (replied on " + channelLabel(channel) + ")",
                    "They asked to stop messages, so every engagement engine stopped contacting them. Their message: "
                            + replyText, channel);
        }
    }

    // ==================== Not interested ====================

    /**
     * A clear "not interested": every member the outcome ends (see {@link PolicyGate#stopsAsLead})
     * leaves as EXITED, its pending rows are cancelled, and its lead rows move to the institute's
     * Not interested (else Lost) status. A learner engine keeps its learners: for them nothing
     * changes and the caller raises a human item instead.
     *
     * @return the members that left; empty when the outcome ends none of them
     */
    public List<LiveMember> exitNotInterested(String instituteId, List<? extends LiveMember> members,
                                              String channel, String replyText, Instant now) {
        List<LiveMember> leaving = membersEndedByLeadOutcome(members);
        if (leaving.isEmpty()) return List.of();
        List<String> ids = leaving.stream().map(LiveMember::getMemberId).toList();
        memberRepository.exitMembers(ids, now);
        actionRepository.cancelOpenForMembers(ids, "Cancelled: they said they are not interested.", now, false);

        Map<String, String> userOfLead = new LinkedHashMap<>();
        for (LiveMember m : leaving) {
            if (m.getAudienceResponseId() != null) userOfLead.putIfAbsent(m.getAudienceResponseId(), m.getUserId());
        }
        String statusLabel = moveLeadStatus(instituteId, userOfLead.keySet());
        for (Map.Entry<String, String> row : userOfLead.entrySet()) {
            timeline(row.getKey(), row.getValue(), LeadJourneyActionType.STATUS_CHANGED,
                    "Said not interested (replied on " + channelLabel(channel) + ")",
                    "The engagement engine stopped contacting them. Their message: " + replyText, channel);
        }

        LiveMember first = leaving.get(0);
        EngagementAction note = new EngagementAction();
        note.setEngineId(first.getEngineId());
        note.setMemberId(first.getMemberId());
        note.setInstituteId(instituteId);
        note.setKind("REPLY");
        note.setActionType("SEND_MESSAGE");
        note.setChannel(channel);
        note.setStatus("DONE");
        note.setCompletedAt(now);
        note.setPriority(BigDecimal.valueOf(60));
        note.setScheduledFor(now);
        note.setRationale(cap("Said they are not interested: left " + leaving.size() + " engine membership(s)"
                + (statusLabel != null ? ", and the lead status is now " + statusLabel : "")
                + ". Nothing more is sent. Their message: " + replyText));
        actionRepository.save(note);
        log.info("Not-interested exit for member {}: {} membership(s) left", first.getMemberId(), leaving.size());
        return leaving;
    }

    // ==================== Converted ====================

    /**
     * Take members whose lead was just marked Converted out of their engines, within one exit
     * sweep instead of at their next decision. The lead row is re-read first (the status may have
     * moved again), the learner-engine rule of {@link PolicyGate#effectiveLeadBlock} applies, and
     * AI-call promises still go out.
     *
     * @return how many members left
     */
    public int exitConverted(List<String> memberIds, Instant now) {
        if (memberIds == null || memberIds.isEmpty()) return 0;
        List<EngagementMember> members = memberRepository.findAllById(memberIds);
        Map<String, EngagementEngine> engines = enginesOf(members.stream().map(EngagementMember::getEngineId).toList());
        Map<String, List<EngagementMember>> byInstitute = members.stream()
                .filter(m -> m.getAudienceResponseId() != null)
                .collect(Collectors.groupingBy(EngagementMember::getInstituteId));
        List<String> leaving = new ArrayList<>();
        for (Map.Entry<String, List<EngagementMember>> inst : byInstitute.entrySet()) {
            Map<String, PolicyGate.LeadBlock> blocked = policyGate.blockedLeads(inst.getKey(),
                    inst.getValue().stream().map(EngagementMember::getAudienceResponseId).collect(Collectors.toSet()));
            for (EngagementMember m : inst.getValue()) {
                if (!"ACTIVE".equals(m.getStatus()) && !"PAUSED".equals(m.getStatus())) continue;
                PolicyGate.LeadBlock block = blocked.get(m.getAudienceResponseId());
                if (block != PolicyGate.LeadBlock.CONVERTED) continue;
                if (PolicyGate.effectiveLeadBlock(block, engines.get(m.getEngineId()), m) != null) {
                    leaving.add(m.getId());
                }
            }
        }
        if (leaving.isEmpty()) return 0;
        int left = memberRepository.exitMembers(leaving, now);
        actionRepository.cancelOpenForMembers(leaving,
                "Cancelled: this lead was marked Converted in the CRM.", now, true);
        return left;
    }

    // ==================== Meeting booked ====================

    /**
     * Take members out of engines whose goal was a meeting (channels.exitOnMeetingBooked) once the
     * meeting is booked: the engine's work is done. What is still pending for them is cancelled,
     * except what an AI call promised (the person asked for it on the call).
     *
     * @return how many members left
     */
    public int exitMeetingBooked(List<String> memberIds, Instant now) {
        if (memberIds == null || memberIds.isEmpty()) return 0;
        List<String> ids = new ArrayList<>(new LinkedHashSet<>(memberIds));
        int left = memberRepository.exitMembers(ids, now);
        actionRepository.cancelOpenForMembers(ids,
                "Cancelled: a meeting was booked with this lead, so the engine's goal is met.", now, true);
        return left;
    }

    // ==================== helpers ====================

    /** Members a lead outcome ends: no account, or an engine that reaches people only as leads. */
    List<LiveMember> membersEndedByLeadOutcome(List<? extends LiveMember> members) {
        if (members == null || members.isEmpty()) return List.of();
        Map<String, EngagementEngine> engines = enginesOf(members.stream().map(LiveMember::getEngineId).toList());
        List<LiveMember> out = new ArrayList<>();
        for (LiveMember m : members) {
            if (PolicyGate.stopsAsLead(engines.get(m.getEngineId()), m.getUserId())) out.add(m);
        }
        return out;
    }

    private Map<String, EngagementEngine> enginesOf(List<String> engineIds) {
        return engineRepository.findAllById(new LinkedHashSet<>(engineIds)).stream()
                .collect(Collectors.toMap(EngagementEngine::getId, Function.identity(), (a, b) -> a));
    }

    /**
     * Move these lead rows to the institute's Not interested status (else the system Lost status).
     * A row already Converted is left alone: a "not interested" reply never undoes a sale.
     *
     * @return the label of the status used, or null when no row moved
     */
    private String moveLeadStatus(String instituteId, Set<String> leadRows) {
        if (leadRows.isEmpty() || leadStatusService == null) return null;
        try {
            List<LeadStatus> statuses = leadStatusService.listForInstitute(instituteId);
            LeadStatus target = statuses.stream().filter(s -> "NOT_INTERESTED".equals(s.getStatusKey())).findFirst()
                    .orElseGet(() -> statuses.stream().filter(s -> "LOST".equals(s.getStatusKey())).findFirst().orElse(null));
            if (target == null) return null;
            Map<String, String> current = crmDao.leadStatusKeys(instituteId, leadRows);
            String moved = null;
            for (String row : leadRows) {
                String key = current.get(row);
                if ("CONVERTED".equals(key) || target.getStatusKey().equals(key)) continue;
                try {
                    leadStatusService.changeLeadStatus(row, target.getId(), null, STATUS_SOURCE);
                    moved = target.getLabel();
                } catch (Exception e) {
                    log.warn("Lead status move failed for lead {}: {}", row, e.getMessage());
                }
            }
            return moved;
        } catch (Exception e) {
            log.warn("Lead status lookup failed for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private void timeline(String leadRow, String userId, LeadJourneyActionType type, String title,
                          String description, String channel) {
        if (timelineEventService == null) return;
        try {
            timelineEventService.logJourneyEvent("AUDIENCE_RESPONSE", leadRow, type,
                    STATUS_SOURCE, null, ACTOR_NAME, title, cap(description),
                    Map.of("source", STATUS_SOURCE, "channel", channel != null ? channel : ""), userId);
        } catch (Exception e) {
            log.warn("Timeline write failed for lead {}: {}", leadRow, e.getMessage());
        }
    }

    private static String channelLabel(String channel) {
        return "EMAIL".equals(channel) ? "email" : "WhatsApp";
    }

    private static String cap(String s) {
        if (s == null) return null;
        return s.length() <= MAX_TEXT ? s : s.substring(0, MAX_TEXT);
    }
}
