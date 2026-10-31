package vacademy.io.admin_core_service.features.timeline.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Timestamp;
import java.util.*;

/**
 * Composes the per-lead journey the CSV export renders: timeline events
 * (status changes, notes, follow-ups, calls, reassignments) PLUS the call
 * dispositions counsellors set after calls — those live only on
 * {@code telephony_call_log} ({@code CallDispositionService} writes no
 * timeline event), so without this merge the export's journey column had no
 * disposition data at all.
 *
 * <p>Lives outside {@link TimelineEventService} on purpose: that service is
 * kept dependency-free (it sits in every feature's dependency chain and has
 * a history of Spring cycles); this composer may depend on telephony and
 * auth_service freely because only the timeline controller uses it.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadJourneyBatchService {

    private final TimelineEventService timelineEventService;
    private final LeadJourneyFollowupService leadJourneyFollowupService;
    private final TelephonyCallLogRepository callLogRepository;
    private final AuthService authService;

    @Transactional(readOnly = true)
    public Map<String, List<TimelineEventDTO>> journeyBatch(List<String> userIds) {
        Map<String, List<TimelineEventDTO>> byUser = timelineEventService.getJourneyBatch(userIds);
        if (userIds == null || userIds.isEmpty()) return byUser;

        List<TelephonyCallLog> dispositioned;
        try {
            dispositioned = callLogRepository.findByUserIdInAndDispositionKeyIsNotNull(userIds);
        } catch (Exception e) {
            // The journey (timeline part) must still export if the call-log
            // lookup hiccups.
            log.warn("journeyBatch: disposition lookup failed for {} users: {}",
                    userIds.size(), e.getMessage());
            addFollowups(byUser, userIds);
            sortOldestFirst(byUser);
            return byUser;
        }

        if (!dispositioned.isEmpty()) {
            Map<String, String> actorNameById = resolveActorNames(dispositioned);
            for (TelephonyCallLog call : dispositioned) {
                if (call.getUserId() == null) continue;
                String actorId = call.getDispositionedBy() != null
                        ? call.getDispositionedBy()
                        : call.getCounsellorUserId();
                Timestamp when = call.getDispositionedAt() != null
                        ? call.getDispositionedAt()
                        : call.getCreatedAt();
                String direction = call.getDirection() != null
                        ? call.getDirection().toLowerCase(Locale.ROOT)
                        : "call";
                byUser.computeIfAbsent(call.getUserId(), k -> new ArrayList<>())
                        .add(TimelineEventDTO.builder()
                                .id("call-disposition-" + call.getId())
                                .actionType("CALL_DISPOSITION")
                                .category(TimelineCategory.ACTIVITY)
                                .title("Call disposition: " + call.getDispositionKey()
                                        + " (" + direction + " call)")
                                .description(call.getDispositionNotes())
                                .actorId(actorId)
                                .actorName(actorId != null ? actorNameById.get(actorId) : null)
                                .createdAt(when)
                                .studentUserId(call.getUserId())
                                .build());
            }
        }

        addFollowups(byUser, userIds);
        sortOldestFirst(byUser);
        return byUser;
    }

    /** Follow-ups with no timeline event (migrated leads) — see LeadJourneyFollowupService. */
    private void addFollowups(Map<String, List<TimelineEventDTO>> byUser, List<String> userIds) {
        for (TimelineEventDTO row : leadJourneyFollowupService.followupEvents(
                userIds, List.of(), timelineEventService.requestInstituteId())) {
            if (row.getStudentUserId() == null) continue;
            byUser.computeIfAbsent(row.getStudentUserId(), k -> new ArrayList<>()).add(row);
        }
    }

    // Timeline lists arrive oldest-first; merged disposition and follow-up rows
    // need a re-sort so the flow reads chronologically.
    private static void sortOldestFirst(Map<String, List<TimelineEventDTO>> byUser) {
        Comparator<TimelineEventDTO> byCreatedAt = Comparator.comparing(
                TimelineEventDTO::getCreatedAt, Comparator.nullsFirst(Comparator.naturalOrder()));
        for (List<TimelineEventDTO> list : byUser.values()) list.sort(byCreatedAt);
    }

    /** Best-effort batch name resolution for disposition actors — the export
     *  renders the raw id-less line when auth_service is unavailable. */
    private Map<String, String> resolveActorNames(List<TelephonyCallLog> calls) {
        Set<String> ids = new HashSet<>();
        for (TelephonyCallLog c : calls) {
            if (c.getDispositionedBy() != null) ids.add(c.getDispositionedBy());
            else if (c.getCounsellorUserId() != null) ids.add(c.getCounsellorUserId());
        }
        if (ids.isEmpty()) return Collections.emptyMap();
        try {
            Map<String, String> out = new HashMap<>();
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
            return out;
        } catch (Exception e) {
            log.warn("journeyBatch: actor-name resolution failed: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }
}
