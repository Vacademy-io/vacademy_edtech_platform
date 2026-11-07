package vacademy.io.admin_core_service.features.timeline.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository.JourneyFollowupRow;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.*;

/**
 * Puts a lead's follow-ups into its Lead Journey when they have no timeline event.
 *
 * <p>The journey reads timeline_event only. Follow-ups made in the app log their own
 * FOLLOWUP_SCHEDULED / FOLLOWUP_CLOSED events, but leads migrated from another CRM carry
 * their whole history as lead_followup rows with no event, so their journey was empty. Each follow-up without an event is shown the way the app would have logged
 * it; one that has its events is left alone, so nothing shows twice.
 *
 * <p>Read-only, and best-effort: if the follow-up lookup fails the journey is returned
 * exactly as before. Lives outside {@link TimelineEventService}, which is kept free of
 * cross-feature dependencies.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadJourneyFollowupService {

    static final String SOURCE = "LEAD_FOLLOWUP";
    private static final List<String> NO_MATCH = List.of("__no_match__");
    private static final Comparator<TimelineEventDTO> NEWEST_FIRST = Comparator.comparing(
            TimelineEventDTO::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder()));

    private final TimelineEventService timelineEventService;
    private final LeadFollowupRepository leadFollowupRepository;
    private final AuthService authService;

    /**
     * The side panel's Lead Journey: timeline events plus follow-ups that have no event,
     * newest first, paged over both. When every follow-up already has its events (any lead
     * worked in the app) this is the plain timeline query, unchanged.
     */
    @Transactional(readOnly = true)
    public Page<TimelineEventDTO> allEventsForStudent(String studentUserId, List<String> typeIds,
            Pageable pageable) {
        List<TimelineEventDTO> followups = followupEvents(
                Collections.singletonList(studentUserId), typeIds, timelineEventService.requestInstituteId());
        if (followups.isEmpty()) {
            return timelineEventService.getAllEventsForStudent(studentUserId, typeIds, pageable);
        }

        // The newest offset+size events are all that can land on this page once the
        // follow-ups are merged in.
        long end = pageable.getOffset() + pageable.getPageSize();
        Page<TimelineEventDTO> events = timelineEventService.getAllEventsForStudent(studentUserId, typeIds,
                PageRequest.of(0, (int) Math.min(end, Integer.MAX_VALUE)));

        List<TimelineEventDTO> merged = new ArrayList<>(events.getContent());
        merged.addAll(followups);
        merged.sort(NEWEST_FIRST);
        int from = (int) Math.min(pageable.getOffset(), merged.size());
        int to = (int) Math.min(end, merged.size());
        return new PageImpl<>(new ArrayList<>(merged.subList(from, to)), pageable,
                events.getTotalElements() + followups.size());
    }

    /**
     * Follow-up rows (scheduled, and closed when it was closed) with no timeline event, for
     * the leads of {@code userIds} and the enquiries {@code responseIds}. Never throws.
     */
    public List<TimelineEventDTO> followupEvents(List<String> userIds, List<String> responseIds,
            String instituteId) {
        List<String> users = nonBlank(userIds);
        List<String> responses = nonBlank(responseIds);
        if (users.isEmpty() && responses.isEmpty()) return List.of();

        List<JourneyFollowupRow> rows;
        try {
            rows = leadFollowupRepository.findJourneyFollowups(
                    users.isEmpty() ? NO_MATCH : users,
                    responses.isEmpty() ? NO_MATCH : responses,
                    instituteId);
        } catch (Exception e) {
            log.warn("Lead journey: follow-up lookup failed for {} users: {}", users.size(), e.getMessage());
            return List.of();
        }

        List<JourneyFollowupRow> missing = rows.stream()
                .filter(r -> !Boolean.TRUE.equals(r.getHasScheduledEvent()) || needsClosedRow(r))
                .toList();
        if (missing.isEmpty()) return List.of();

        Map<String, String> names = resolveNames(missing);
        List<TimelineEventDTO> out = new ArrayList<>();
        for (JourneyFollowupRow r : missing) {
            if (!Boolean.TRUE.equals(r.getHasScheduledEvent())) out.add(scheduledRow(r, names));
            if (needsClosedRow(r)) out.add(closedRow(r, names));
        }
        return out;
    }

    private static boolean needsClosedRow(JourneyFollowupRow r) {
        return Boolean.TRUE.equals(r.getClosed()) && r.getClosedAt() != null
                && !Boolean.TRUE.equals(r.getHasClosedEvent());
    }

    /** Same shape LeadFollowupService.create logs. */
    private static TimelineEventDTO scheduledRow(JourneyFollowupRow r, Map<String, String> names) {
        Map<String, Object> meta = new HashMap<>();
        meta.put("followupId", r.getId());
        meta.put("scheduleTime", r.getScheduleTime() != null ? r.getScheduleTime().getTime() : null);
        meta.put("status", r.getStatus());
        meta.put("source", SOURCE);
        Timestamp when = r.getCreatedAt() != null ? r.getCreatedAt() : r.getScheduleTime();
        return row(r, "followup-" + r.getId(), "FOLLOWUP_SCHEDULED", "Follow-up scheduled",
                r.getContent(), meta, r.getCreatedBy(), names, when);
    }

    /** Same shape LeadFollowupService.close logs. */
    private static TimelineEventDTO closedRow(JourneyFollowupRow r, Map<String, String> names) {
        String status = r.getStatus() != null ? r.getStatus() : "CLOSED";
        Map<String, Object> meta = new HashMap<>();
        meta.put("followupId", r.getId());
        meta.put("status", status);
        meta.put("source", SOURCE);
        return row(r, "followup-closed-" + r.getId(), "FOLLOWUP_CLOSED",
                "Follow-up " + status.toLowerCase(Locale.ROOT), r.getCloserReason(), meta,
                r.getClosedBy(), names, r.getClosedAt());
    }

    private static TimelineEventDTO row(JourneyFollowupRow r, String id, String actionType, String title,
            String description, Map<String, Object> meta, String actorId, Map<String, String> names,
            Timestamp when) {
        return TimelineEventDTO.builder()
                .id(id)
                .type("LEAD")
                .typeId(r.getResponseId())
                .actionType(actionType)
                .actorType(actorId != null ? "ADMIN" : "SYSTEM")
                .actorId(actorId)
                .actorName(actorId != null ? names.get(actorId) : null)
                .title(title)
                .description(description)
                .metadata(meta)
                .isPinned(false)
                .studentUserId(r.getLeadUserId())
                .category(TimelineCategory.ACTIVITY)
                .createdAt(when)
                .build();
    }

    /** Best-effort: a row without a name still shows, just without the "by" line. */
    private Map<String, String> resolveNames(List<JourneyFollowupRow> rows) {
        Set<String> ids = new HashSet<>();
        for (JourneyFollowupRow r : rows) {
            if (r.getCreatedBy() != null) ids.add(r.getCreatedBy());
            if (r.getClosedBy() != null) ids.add(r.getClosedBy());
        }
        if (ids.isEmpty()) return Map.of();
        try {
            Map<String, String> out = new HashMap<>();
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
            return out;
        } catch (Exception e) {
            log.warn("Lead journey: follow-up author names failed: {}", e.getMessage());
            return Map.of();
        }
    }

    private static List<String> nonBlank(List<String> ids) {
        if (ids == null) return List.of();
        return ids.stream().filter(s -> s != null && !s.isBlank()).distinct().toList();
    }
}
