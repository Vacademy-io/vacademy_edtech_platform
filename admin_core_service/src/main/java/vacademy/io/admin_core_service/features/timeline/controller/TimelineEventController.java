package vacademy.io.admin_core_service.features.timeline.controller;

import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.timeline.dto.StudentLatestNoteDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventRequestDTO;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/timeline/v1")
public class TimelineEventController {

        private static final org.slf4j.Logger log =
                        org.slf4j.LoggerFactory.getLogger(TimelineEventController.class);

        @Autowired
        private TimelineEventService timelineEventService;

        @Autowired
        private vacademy.io.admin_core_service.features.timeline.service.LeadJourneyBatchService leadJourneyBatchService;

        @Autowired
        private vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository userLeadProfileRepository;

        @Autowired
        private vacademy.io.admin_core_service.features.notification_service.service.NotificationService notificationService;

        @GetMapping("/events")
        public ResponseEntity<Page<TimelineEventDTO>> getTimelineEvents(
                        @RequestParam String type,
                        @RequestParam String typeId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "20") int size) {

                Pageable pageable = PageRequest.of(page, size);
                Page<TimelineEventDTO> response = timelineEventService.getTimelineEvents(type, typeId, pageable);
                return ResponseEntity.ok(response);
        }

        @PostMapping("/event")
        public ResponseEntity<TimelineEventDTO> createManualEvent(
                        @Valid @RequestBody TimelineEventRequestDTO request,
                        @RequestAttribute("user") CustomUserDetails user) {

                TimelineEventDTO response = timelineEventService.createManualEvent(request, user);
                clearLeadAssignmentAlert(request.getStudentUserId());
                return ResponseEntity.ok(response);
        }

        /**
         * A lead-assignment alert sits on the counsellor's bell and cannot be dismissed
         * by hand. This is what takes it down: the first note, call log or status change
         * the counsellor records against that lead.
         *
         * Lives here rather than in TimelineEventService on purpose — that service is
         * deliberately kept free of cross-service dependencies to stay out of bean
         * cycles, and says so at the top. The caller owns what happens after an event,
         * the same way it already owns the profile recompute.
         *
         * Only this endpoint is hooked: it is the one a human posts to. System-written
         * journey rows (the assignment itself writes one) must not cancel the alert in
         * the same breath that raised it.
         *
         * Best-effort — a notification-service blip must never fail the note that was
         * just written.
         */
        private void clearLeadAssignmentAlert(String studentUserId) {
                if (studentUserId == null || studentUserId.isBlank()) return;
                try {
                        // The request carries no institute and the alert query is scoped by
                        // one, so take it from the lead's own profile.
                        userLeadProfileRepository.findByUserId(studentUserId)
                                        .map(UserLeadProfile::getInstituteId)
                                        .filter(id -> id != null && !id.isBlank())
                                        .ifPresent(instituteId -> notificationService
                                                        .deactivateSystemAlertsForEntity(instituteId,
                                                                        LeadAssignmentNotifier.LEAD_ENTITY,
                                                                        studentUserId));
                } catch (Exception e) {
                        log.warn("Could not clear the lead-assignment alert for lead {}: {}",
                                        studentUserId, e.getMessage());
                }
        }

        /**
         * Toggle pin status on a timeline event (note).
         * PUT /admin-core-service/timeline/v1/event/{eventId}/pin
         */
        @PutMapping("/event/{eventId}/pin")
        public ResponseEntity<TimelineEventDTO> togglePin(@PathVariable String eventId) {
                TimelineEventDTO response = timelineEventService.togglePin(eventId);
                return ResponseEntity.ok(response);
        }

        /**
         * Get ALL timeline events for a student across all stages (enquiry → application → enrollment).
         * Pinned notes appear first.
         * GET /admin-core-service/timeline/v1/student/{studentUserId}
         */
        @GetMapping("/student/{studentUserId}")
        public ResponseEntity<Page<TimelineEventDTO>> getCrossStageTimeline(
                        @PathVariable String studentUserId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "20") int size) {

                Pageable pageable = PageRequest.of(page, size);
                Page<TimelineEventDTO> response = timelineEventService.getCrossStageTimeline(studentUserId, pageable);
                return ResponseEntity.ok(response);
        }

        /**
         * Batch fetch the latest cross-stage note + count per student.
         * POST /admin-core-service/timeline/v1/student/latest-notes-batch
         * Body: ["userId1", "userId2", ...]
         * Returns: { "userId1": { latest: {...}, count: 3 }, ... }
         */
        @PostMapping("/student/latest-notes-batch")
        public ResponseEntity<Map<String, StudentLatestNoteDTO>> getLatestNotesBatch(
                        @RequestBody List<String> studentUserIds) {
                return ResponseEntity.ok(timelineEventService.getLatestNotesForStudents(studentUserIds));
        }

        /**
         * Batch fetch the full lead journey (status/disposition changes + notes +
         * calls) per student, oldest-first — powers the "Lead journey" export column.
         * POST /admin-core-service/timeline/v1/student/journey-batch
         * Body: ["userId1", "userId2", ...]
         * Returns: { "userId1": [ {timeline event}, ... ], ... }
         */
        @PostMapping("/student/journey-batch")
        public ResponseEntity<Map<String, List<TimelineEventDTO>>> getJourneyBatch(
                        @RequestBody List<String> studentUserIds) {
                // Timeline events + call dispositions merged — see LeadJourneyBatchService.
                return ResponseEntity.ok(leadJourneyBatchService.journeyBatch(studentUserIds));
        }

        /**
         * Get timeline events with pinned notes first.
         * GET /admin-core-service/timeline/v1/events/pinned
         */
        @GetMapping("/events/pinned")
        public ResponseEntity<Page<TimelineEventDTO>> getTimelineEventsWithPinnedFirst(
                        @RequestParam String type,
                        @RequestParam String typeId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "20") int size) {

                Pageable pageable = PageRequest.of(page, size);
                Page<TimelineEventDTO> response = timelineEventService.getTimelineEventsWithPinnedFirst(type, typeId, pageable);
                return ResponseEntity.ok(response);
        }

        /**
         * Get JOURNEY events for a lead — lifecycle milestones only (status changes, submission, score updates).
         * GET /admin-core-service/timeline/v1/journey?type=AUDIENCE_RESPONSE&typeId=X
         */
        @GetMapping("/journey")
        public ResponseEntity<Page<TimelineEventDTO>> getJourneyEvents(
                        @RequestParam String type,
                        @RequestParam String typeId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "50") int size) {

                Pageable pageable = PageRequest.of(page, size);
                return ResponseEntity.ok(timelineEventService.getJourneyEvents(type, typeId, pageable));
        }

        /**
         * Get JOURNEY events for a student across all stages — the full lead lifecycle view.
         * GET /admin-core-service/timeline/v1/student/{studentUserId}/journey
         */
        @GetMapping("/student/{studentUserId}/journey")
        public ResponseEntity<Page<TimelineEventDTO>> getCrossStageJourney(
                        @PathVariable String studentUserId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "50") int size) {

                Pageable pageable = PageRequest.of(page, size);
                return ResponseEntity.ok(timelineEventService.getCrossStageJourney(studentUserId, pageable));
        }

        /**
         * Unified timeline: ALL events (JOURNEY + ACTIVITY) for a student, sorted by timestamp DESC.
         * Also accepts optional typeIds (e.g. audienceResponseId) to catch legacy events stored
         * before studentUserId backfill. Uses OR: student_user_id = userId OR type_id IN typeIds.
         * GET /admin-core-service/timeline/v1/student/{studentUserId}/all?typeIds=id1,id2
         */
        @GetMapping("/student/{studentUserId}/all")
        public ResponseEntity<Page<TimelineEventDTO>> getAllEventsForStudent(
                        @PathVariable String studentUserId,
                        @RequestParam(required = false) List<String> typeIds,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "50") int size) {

                Pageable pageable = PageRequest.of(page, size);
                return ResponseEntity.ok(timelineEventService.getAllEventsForStudent(studentUserId, typeIds, pageable));
        }
}
