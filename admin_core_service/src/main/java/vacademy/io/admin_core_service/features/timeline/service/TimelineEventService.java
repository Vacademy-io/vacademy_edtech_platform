package vacademy.io.admin_core_service.features.timeline.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.timeline.dto.StudentLatestNoteDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventRequestDTO;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.admin_core_service.features.timeline.repository.TimelineEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure event-persistence service.
 * No cross-service dependencies — only TimelineEventRepository and ObjectMapper.
 * This eliminates all circular dependency chains involving this service.
 *
 * Profile recompute after activity events (notes/calls) is the responsibility
 * of the caller (controller or domain service), not this service.
 */
@Service
public class TimelineEventService {

        private static final Logger logger = LoggerFactory.getLogger(TimelineEventService.class);

        @Autowired
        private TimelineEventRepository timelineEventRepository;

        @Autowired
        private ObjectMapper objectMapper;

        /** Lazily resolved: the engagement engine's wake hook depends on services that log here. */
        @Autowired
        private ObjectProvider<TimelineEventHook> hooks;

        // ── Write: ACTIVITY events ────────────────────────────────────────────

        @Transactional
        public void logEvent(String type, String typeId, String actionType,
                        String actorType, String actorId, String actorName,
                        String title, String description, Object metadata) {
                logEvent(type, typeId, actionType, actorType, actorId, actorName,
                                title, description, metadata, null);
        }

        @Transactional
        public void logEvent(String type, String typeId, String actionType,
                        String actorType, String actorId, String actorName,
                        String title, String description, Object metadata,
                        String studentUserId) {
                saveEvent(type, typeId, actionType, actorType, actorId, actorName,
                                title, description, metadata, studentUserId, TimelineCategory.ACTIVITY);
        }

        /**
         * Insert-or-update the single CALL_MADE (ACTIVITY) event for one telephony call.
         * The event is first written when the call ends — so every call counts as a lead
         * response at the time it happened, even one with no recording (no answer, busy,
         * failed upload) — and is updated in place when the recording lands later.
         * REQUIRES_NEW: the call-ended path invokes this from an afterCommit callback, where a
         * REQUIRED transaction would join the already-committed one and never commit.
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public void upsertCallEvent(String typeId, String callLogId,
                        String actorId, String actorName,
                        String title, String description, Object metadata,
                        String studentUserId) {
                TimelineEvent existing = timelineEventRepository.findCallEvent(typeId, callLogId).orElse(null);
                if (existing == null) {
                        saveEvent("LEAD", typeId, "CALL_MADE", "USER", actorId, actorName,
                                        title, description, metadata, studentUserId, TimelineCategory.ACTIVITY);
                        return;
                }
                if (metadata != null) {
                        try {
                                existing.setMetadataJson(objectMapper.writeValueAsString(metadata));
                        } catch (JsonProcessingException e) {
                                logger.error("Failed to serialize call event metadata", e);
                        }
                }
                existing.setTitle(title);
                existing.setDescription(description);
                if (existing.getActorId() == null) existing.setActorId(actorId);
                if (existing.getActorName() == null) existing.setActorName(actorName);
                if (existing.getStudentUserId() == null) existing.setStudentUserId(studentUserId);
                if (existing.getInstituteId() == null) existing.setInstituteId(resolveInstituteId("LEAD", typeId));
                timelineEventRepository.save(existing);
        }

        // ── Write: JOURNEY events ─────────────────────────────────────────────

        /**
         * Log an automated lifecycle milestone (JOURNEY category).
         * REQUIRES_NEW: always commits in its own transaction so the caller's
         * rollback-only state can never silently discard the event.
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public void logJourneyEvent(String type, String typeId, LeadJourneyActionType actionType,
                        String actorType, String actorId, String actorName,
                        String title, String description, Object metadata,
                        String studentUserId) {
                saveEvent(type, typeId, actionType.name(), actorType, actorId, actorName,
                                title, description, metadata, studentUserId, TimelineCategory.JOURNEY);

        }

        // ── Write: manual event from frontend ────────────────────────────────

        @Transactional
        public TimelineEventDTO createManualEvent(TimelineEventRequestDTO request, CustomUserDetails user) {

                String metadataJson = null;
                if (request.getMetadata() != null) {
                        try {
                                metadataJson = objectMapper.writeValueAsString(request.getMetadata());
                        } catch (JsonProcessingException e) {
                                throw new VacademyException("Invalid metadata format provided.");
                        }
                }

                TimelineCategory category = request.getCategory() != null
                                ? request.getCategory()
                                : TimelineCategory.ACTIVITY;

                TimelineEvent event = TimelineEvent.builder()
                                .type(request.getType())
                                .typeId(request.getTypeId())
                                .actionType(request.getActionType())
                                .actorType("ADMIN")
                                .actorId(user.getUserId())
                                .actorName(user.getUsername())
                                .title(request.getTitle())
                                .description(request.getDescription())
                                .metadataJson(metadataJson)
                                .isPinned(request.getIsPinned() != null ? request.getIsPinned() : false)
                                .studentUserId(request.getStudentUserId())
                                .category(category)
                                .instituteId(resolveInstituteId(request.getType(), request.getTypeId()))
                                .build();

                TimelineEvent savedEvent = timelineEventRepository.save(event);
                notifyHooks(savedEvent);
                return mapToDTO(savedEvent);
        }

        // ── Write: pin toggle ─────────────────────────────────────────────────

        @Transactional
        public TimelineEventDTO togglePin(String eventId) {
                TimelineEvent event = timelineEventRepository.findById(eventId)
                                .orElseThrow(() -> new VacademyException("Timeline event not found: " + eventId));
                event.setIsPinned(event.getIsPinned() != null ? !event.getIsPinned() : true);
                return mapToDTO(timelineEventRepository.save(event));
        }

        // ── Read ──────────────────────────────────────────────────────────────

        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getTimelineEvents(String type, String typeId, Pageable pageable) {
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findByTypeAndTypeIdOrderByCreatedAtDesc(type, typeId, pageable)
                                : timelineEventRepository.findForInstituteByTypeAndTypeId(type, typeId, instituteId, pageable))
                                .map(this::mapToDTO);
        }

        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getTimelineEventsWithPinnedFirst(String type, String typeId, Pageable pageable) {
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findByTypeAndTypeIdOrderByIsPinnedDescCreatedAtDesc(type, typeId, pageable)
                                : timelineEventRepository.findForInstituteByTypeAndTypeIdPinnedFirst(type, typeId, instituteId,
                                                pageable))
                                .map(this::mapToDTO);
        }

        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getCrossStageTimeline(String studentUserId, Pageable pageable) {
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findByStudentUserIdOrderByIsPinnedDescCreatedAtDesc(studentUserId, pageable)
                                : timelineEventRepository.findForInstituteByStudentUserIdPinnedFirst(studentUserId, instituteId,
                                                pageable))
                                .map(this::mapToDTO);
        }

        /**
         * All events (JOURNEY + ACTIVITY) for a lead, sorted by createdAt DESC.
         * Uses an OR query: matches either student_user_id OR type_id in the provided list.
         * This covers legacy journey events stored before studentUserId backfill
         * (e.g. LEAD_SUBMITTED events where student_user_id was null but type_id = responseId).
         */
        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getAllEventsForStudent(String studentUserId, List<String> typeIds, Pageable pageable) {
                List<String> effectiveTypeIds = (typeIds != null && !typeIds.isEmpty())
                                ? typeIds
                                : List.of("__no_match__");
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findAllEventsForLead(studentUserId, effectiveTypeIds, pageable)
                                : timelineEventRepository.findAllEventsForLeadForInstitute(studentUserId, effectiveTypeIds,
                                                instituteId, pageable))
                                .map(this::mapToDTO);
        }

        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getJourneyEvents(String type, String typeId, Pageable pageable) {
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findByTypeAndTypeIdAndCategoryOrderByCreatedAtDesc(type, typeId,
                                                TimelineCategory.JOURNEY, pageable)
                                : timelineEventRepository.findForInstituteByTypeAndTypeIdAndCategory(type, typeId,
                                                TimelineCategory.JOURNEY, instituteId, pageable))
                                .map(this::mapToDTO);
        }

        @Transactional(readOnly = true)
        public Page<TimelineEventDTO> getCrossStageJourney(String studentUserId, Pageable pageable) {
                String instituteId = requestInstituteId();
                return (instituteId == null
                                ? timelineEventRepository.findByStudentUserIdAndCategoryOrderByCreatedAtDesc(studentUserId,
                                                TimelineCategory.JOURNEY, pageable)
                                : timelineEventRepository.findForInstituteByStudentUserIdAndCategory(studentUserId,
                                                TimelineCategory.JOURNEY, instituteId, pageable))
                                .map(this::mapToDTO);
        }

        private static final int RECENT_NOTES_PER_STUDENT = 5;

        @Transactional(readOnly = true)
        public Map<String, StudentLatestNoteDTO> getLatestNotesForStudents(List<String> studentUserIds) {
                Map<String, StudentLatestNoteDTO> result = new HashMap<>();
                if (studentUserIds == null || studentUserIds.isEmpty()) return result;

                String instituteId = requestInstituteId();
                List<TimelineEvent> recentEvents = instituteId == null
                                ? timelineEventRepository.findRecentPerStudent(studentUserIds, RECENT_NOTES_PER_STUDENT)
                                : timelineEventRepository.findRecentPerStudentForInstitute(studentUserIds, instituteId,
                                                RECENT_NOTES_PER_STUDENT);
                Map<String, List<TimelineEventDTO>> recentByUser = new HashMap<>();
                for (TimelineEvent e : recentEvents) {
                        if (e.getStudentUserId() == null) continue;
                        recentByUser.computeIfAbsent(e.getStudentUserId(), k -> new ArrayList<>())
                                        .add(mapToDTO(e));
                }

                Map<String, Long> countByUser = new HashMap<>();
                List<Object[]> counts = instituteId == null
                                ? timelineEventRepository.countByStudentUserIds(studentUserIds)
                                : timelineEventRepository.countByStudentUserIdsForInstitute(studentUserIds, instituteId);
                for (Object[] row : counts) {
                        if (row[0] != null) {
                                countByUser.put((String) row[0], ((Number) row[1]).longValue());
                        }
                }

                for (String userId : studentUserIds) {
                        result.put(userId, StudentLatestNoteDTO.builder()
                                        .recent(recentByUser.getOrDefault(userId, List.of()))
                                        .count(countByUser.getOrDefault(userId, 0L))
                                        .build());
                }
                return result;
        }

        /** How many journey events per lead the export pulls (most-recent first, capped). */
        private static final int JOURNEY_EXPORT_CAP = 50;

        /**
         * Batch fetch the full lead journey (status/disposition changes + notes +
         * call events — every category) per student, oldest-first, for CSV export.
         * Reuses the same window query as latest-notes with a larger cap.
         * POST /admin-core-service/timeline/v1/student/journey-batch
         */
        @Transactional(readOnly = true)
        public Map<String, List<TimelineEventDTO>> getJourneyBatch(List<String> studentUserIds) {
                Map<String, List<TimelineEventDTO>> result = new HashMap<>();
                if (studentUserIds == null || studentUserIds.isEmpty()) return result;

                // Dual-linkage lookup — events stamped with student_user_id AND
                // events keyed only by their audience_response (status changes
                // etc., whose student_user_id is often null). The old
                // findRecentPerStudent-based version missed the latter, so the
                // export's journey column carried a single row per lead.
                String instituteId = requestInstituteId();
                List<TimelineEventRepository.JourneyEventRow> rows = instituteId == null
                                ? timelineEventRepository.findJourneyRowsForUsers(studentUserIds, JOURNEY_EXPORT_CAP)
                                : timelineEventRepository.findJourneyRowsForUsersForInstitute(studentUserIds, instituteId,
                                                JOURNEY_EXPORT_CAP);
                for (TimelineEventRepository.JourneyEventRow r : rows) {
                        if (r.getJourneyUserId() == null) continue;
                        TimelineCategory category = null;
                        if (r.getCategory() != null) {
                                try {
                                        category = TimelineCategory.valueOf(r.getCategory());
                                } catch (IllegalArgumentException ignored) {
                                        // Unknown/legacy category value — leave null, the export
                                        // formatter only uses it as a display hint.
                                }
                        }
                        result.computeIfAbsent(r.getJourneyUserId(), k -> new ArrayList<>())
                                        .add(TimelineEventDTO.builder()
                                                        .id(r.getId())
                                                        .actionType(r.getActionType())
                                                        .actorName(r.getActorName())
                                                        .title(r.getTitle())
                                                        .description(r.getDescription())
                                                        .category(category)
                                                        .createdAt(r.getCreatedAt())
                                                        .studentUserId(r.getJourneyUserId())
                                                        .build());
                }
                // The window query returns newest-first; a journey reads better oldest-first.
                for (List<TimelineEventDTO> list : result.values()) java.util.Collections.reverse(list);
                return result;
        }

        // ── Private helpers ───────────────────────────────────────────────────

        /**
         * The institute an event belongs to: the institute of the enquiry or lead profile it
         * is keyed by when there is one (exact, whoever writes it), else the institute the
         * request is made for (the dashboard's clientId header), e.g. a note on a person.
         * Null when neither is known (a background job writing a person-keyed event): that
         * event shows in every institute, as all events did before. Never fails the write.
         */
        private String resolveInstituteId(String type, String typeId) {
                if (typeId != null && !typeId.isBlank()) {
                        try {
                                java.util.Optional<String> owned = java.util.Optional.empty();
                                if ("LEAD".equals(type) || "AUDIENCE_RESPONSE".equals(type)) {
                                        owned = timelineEventRepository.findInstituteIdOfResponse(typeId);
                                } else if ("USER_LEAD_PROFILE".equals(type)) {
                                        owned = timelineEventRepository.findInstituteIdOfLeadProfile(typeId);
                                }
                                if (owned.isPresent() && !owned.get().isBlank()) return owned.get();
                        } catch (Exception e) {
                                logger.warn("Could not resolve the institute of {}[{}]: {}", type, typeId, e.getMessage());
                        }
                }
                return requestInstituteId();
        }

        /** The institute the current request is made for (clientId header); null outside a request. */
        private String requestInstituteId() {
                RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
                if (attributes instanceof ServletRequestAttributes servletAttributes) {
                        String clientId = servletAttributes.getRequest().getHeader("clientId");
                        return clientId == null || clientId.isBlank() ? null : clientId.trim();
                }
                return null;
        }

        // ── Write: engagement engine notes (B6) ─────────────────────────────

        /** Actor of every note the engagement engine writes; the hooks and readers key on it. */
        public static final String ENGINE_ACTOR_TYPE = "ENGAGEMENT_ENGINE";
        /** How the note's author reads in the timeline: a normal note, labelled AI. */
        public static final String ENGINE_NOTE_AUTHOR = "AI · Engagement Engine";

        /**
         * A normal NOTE on a lead, written by the engagement engine (labelled AI by its author name
         * and metadata.ai). Returns the event id, so the engine can undo it.
         */
        @Transactional
        public String logEngineNote(String leadRowId, String title, String description,
                        Map<String, Object> metadata, String studentUserId) {
                Map<String, Object> meta = new HashMap<>(metadata != null ? metadata : Map.of());
                meta.put("source", ENGINE_ACTOR_TYPE);
                meta.put("ai", true);
                return saveEvent("LEAD", leadRowId, "NOTE", ENGINE_ACTOR_TYPE, null, ENGINE_NOTE_AUTHOR,
                                title, description, meta, studentUserId, TimelineCategory.ACTIVITY).getId();
        }

        /** Undo of {@link #logEngineNote}: removes only a note the engine wrote. */
        @Transactional
        public boolean deleteEngineNote(String eventId) {
                if (eventId == null) return false;
                return timelineEventRepository.findById(eventId)
                                .filter(e -> ENGINE_ACTOR_TYPE.equals(e.getActorType()))
                                .map(e -> {
                                        timelineEventRepository.delete(e);
                                        return true;
                                })
                                .orElse(false);
        }

        private TimelineEvent saveEvent(String type, String typeId, String actionType,
                        String actorType, String actorId, String actorName,
                        String title, String description, Object metadata,
                        String studentUserId, TimelineCategory category) {

                String metadataJson = null;
                if (metadata != null) {
                        try {
                                metadataJson = objectMapper.writeValueAsString(metadata);
                        } catch (JsonProcessingException e) {
                                logger.error("Failed to serialize timeline event metadata", e);
                        }
                }

                TimelineEvent event = TimelineEvent.builder()
                                .type(type)
                                .typeId(typeId)
                                .actionType(actionType)
                                .actorType(actorType)
                                .actorId(actorId)
                                .actorName(actorName)
                                .title(title)
                                .description(description)
                                .metadataJson(metadataJson)
                                .studentUserId(studentUserId)
                                .category(category)
                                .instituteId(resolveInstituteId(type, typeId))
                                .build();

                TimelineEvent saved = timelineEventRepository.save(event);
                notifyHooks(saved);
                logger.debug("Logged {} event: {} on {}[{}]", category, actionType, type, typeId);
                return saved;
        }

        private void notifyHooks(TimelineEvent event) {
                if (hooks == null) return;
                hooks.orderedStream().forEach(hook -> {
                        try {
                                hook.onEventSaved(event);
                        } catch (Exception e) {
                                logger.warn("Timeline hook {} failed on {}[{}]: {}", hook.getClass().getSimpleName(),
                                                event.getType(), event.getTypeId(), e.getMessage());
                        }
                });
        }

        private TimelineEventDTO mapToDTO(TimelineEvent event) {
                Object metadata = null;
                if (event.getMetadataJson() != null) {
                        try {
                                metadata = objectMapper.readValue(event.getMetadataJson(), Object.class);
                        } catch (JsonProcessingException e) {
                                logger.error("Failed to deserialize timeline event metadata", e);
                        }
                }
                return TimelineEventDTO.builder()
                                .id(event.getId())
                                .type(event.getType())
                                .typeId(event.getTypeId())
                                .actionType(event.getActionType())
                                .actorType(event.getActorType())
                                .actorId(event.getActorId())
                                .actorName(event.getActorName())
                                .title(event.getTitle())
                                .description(event.getDescription())
                                .metadata(metadata)
                                .isPinned(event.getIsPinned() != null ? event.getIsPinned() : false)
                                .studentUserId(event.getStudentUserId())
                                .category(event.getCategory())
                                // Pass the Timestamp through so Jackson emits an ISO with the
                                // `+HH:MM` offset (matches AudienceService's submitted_at_local
                                // / first_response_at format). Previously this was hand-formatted
                                // as a String via toLocalDateTime(), which dropped the offset and
                                // forced the frontend to assume UTC — that double-converted IST
                                // values and shifted the Activity-cell time by the local offset.
                                .createdAt(event.getCreatedAt())
                                .build();
        }
}
