package vacademy.io.admin_core_service.features.live_session.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep1RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.enums.LinkType;
import vacademy.io.admin_core_service.features.live_session.enums.LiveSessionStatus;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.repository.ScheduleNotificationRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Date;
import java.sql.Time;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class Step1Service {

    /** Frontend StreamingPlatform.ZOOM — must stay lowercase, see getLinkTypeFromUrl. */
    static final String ZOOM_LINK_TYPE = "zoom";
    /** Frontend StreamingPlatform.MEET — must stay exactly this, see getLinkTypeFromUrl. */
    static final String GMEET_LINK_TYPE = "google meet";


    @Autowired
    private LiveSessionRepository sessionRepository;

    @Autowired
    private SessionScheduleRepository scheduleRepository;

    @Autowired
    private ScheduleNotificationRepository scheduleNotificationRepository;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Autowired
    private LiveSessionInstructorService instructorService;

    public LiveSession step1AddService(LiveSessionStep1RequestDTO request, CustomUserDetails user) {
        return step1AddService(request, user, true);
    }

    /**
     * Overload that lets callers (e.g. {@code BulkLiveSessionService}) skip the
     * synchronous {@code LIVE_SESSION_CREATE} workflow trigger so they can fire
     * it asynchronously after the request returns. Single-class flow continues
     * to use the default ({@code fireWorkflow = true}) and behaves exactly as
     * before.
     */
    public LiveSession step1AddService(LiveSessionStep1RequestDTO request,
                                       CustomUserDetails user,
                                       boolean fireWorkflow) {
        boolean isCreate = !StringUtils.hasText(request.getSessionId());
        LiveSession session = getOrCreateSession(request, user);
        updateSessionFields(session, request, user);
        LiveSession savedSession = sessionRepository.save(session);

        if (isCreate) {
            // The person scheduling the class is its instructor until somebody
            // says otherwise in step 2. Seeding here rather than relying on the
            // creator fallback means the admin sees a pre-filled, editable list
            // instead of an empty one.
            try {
                instructorService.seedCreatorAsInstructor(savedSession.getId(), user.getUserId());
            } catch (Exception e) {
                // The creator fallback covers this, so a failed seed must not
                // fail the scheduling request.
                log.warn("Failed to seed creator as live-session instructor sessionId={}: {}",
                        savedSession.getId(), e.getMessage());
            }
        }

        // Handle all schedule operations intelligently
        if (request.getSessionId() != null && !request.getSessionId().isEmpty()) {
            // Update mode: handle complex scenarios
            handleScheduleUpdatesForExistingSession(request, savedSession);
        } else {
            // Create mode: use original logic
            handleDeletedSchedules(request);
            handleAddedSchedules(request, savedSession);
            handleUpdatedSchedules(request);
        }

        if (fireWorkflow) {
            // Trigger LIVE_SESSION_CREATE workflow synchronously (single-class flow)
            try {
                Map<String, Object> contextData = new HashMap<>();
                contextData.put("liveSession", savedSession);
                contextData.put("createdBy", user.getUserId());
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.LIVE_SESSION_CREATE.name(),
                        savedSession.getId(),
                        request.getInstituteId(),
                        contextData);
            } catch (Exception e) {
                log.warn("Failed to trigger LIVE_SESSION_CREATE workflow", e);
            }
        }

        return savedSession;
    }

    /**
     * Comprehensive schedule update handler for existing sessions
     * Handles: end date changes, start date changes, day pattern changes, and
     * individual schedule updates
     */
    private void handleScheduleUpdatesForExistingSession(LiveSessionStep1RequestDTO request, LiveSession session) {
        // Step 1: Handle explicit deletions first
        handleDeletedSchedules(request);

        // Step 2: Get all existing schedules (excluding already deleted ones)
        List<SessionSchedule> existingSchedules = scheduleRepository.findBySessionId(session.getId()).stream()
                .filter(s -> !LiveSessionStatus.DELETED.name().equalsIgnoreCase(s.getStatus()))
                .toList();
        LocalDate today = LocalDate.now();

        // Separate past and future schedules
        List<SessionSchedule> futureSchedules = existingSchedules.stream()
                .filter(s -> toLocalDate(s.getMeetingDate()).isAfter(today))
                .toList();

        // Step 3: Handle recurrence type changes (if needed in future)
        // TODO: Handle WEEKLY <-> NONE conversion - clear all schedules and recreate
        if (shouldRecreateAllSchedules(request, session)) {
            // For now, just log - implement full recreation logic later
            System.out.println("Recurrence type change detected - full recreation needed (TODO)");
        }

        // Step 4: Process date range and day pattern changes
        if (request.getAddedSchedules() != null && !request.getAddedSchedules().isEmpty()) {
            LocalDate newStartDate = request.getStartTime()
                    .toInstant()
                    .atZone(ZoneOffset.UTC)
                    .toLocalDate();
            LocalDate newEndDate = LocalDate.parse(request.getSessionEndDate(), DateTimeFormatter.ISO_DATE);

            // Get requested days from the DTOs
            java.util.Set<String> requestedDays = request.getAddedSchedules().stream()
                    .map(dto -> dto.getDay().toUpperCase())
                    .collect(java.util.stream.Collectors.toSet());

            // Step 4a: Handle DAY PATTERN CHANGES - Delete future schedules for days no
            // longer in the request
            List<String> schedulesToDeleteForRemovedDays = futureSchedules.stream()
                    .filter(s -> s.getRecurrenceKey() != null
                            && !requestedDays.contains(s.getRecurrenceKey().toUpperCase()))
                    .map(SessionSchedule::getId)
                    .toList();

            if (!schedulesToDeleteForRemovedDays.isEmpty()) {
                System.out.println(
                        "Deleting " + schedulesToDeleteForRemovedDays.size() + " future schedules for removed days");
                scheduleNotificationRepository.disableNotificationsByScheduleIds(schedulesToDeleteForRemovedDays,
                        "DISABLED");
                scheduleRepository.deleteAllById(schedulesToDeleteForRemovedDays);
                // Remove from our working lists to prevent stale data
                futureSchedules = futureSchedules.stream()
                        .filter(s -> !schedulesToDeleteForRemovedDays.contains(s.getId()))
                        .toList();
                existingSchedules = existingSchedules.stream()
                        .filter(s -> !schedulesToDeleteForRemovedDays.contains(s.getId()))
                        .toList();
            }

            // Step 4a2: Handle TIME SLOT REMOVAL - Delete future schedules for time slots
            // that are no longer in the request (for days that ARE still in the request)
            java.util.Map<String, java.util.Set<java.sql.Time>> requestedStartTimesByDay = new java.util.HashMap<>();
            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getAddedSchedules()) {
                String day = dto.getDay().toUpperCase();
                requestedStartTimesByDay
                        .computeIfAbsent(day, k -> new java.util.HashSet<>())
                        .add(java.sql.Time.valueOf(dto.getStartTime()));
            }

            List<String> schedulesToDeleteForRemovedTimeSlots = futureSchedules.stream()
                    .filter(s -> s.getRecurrenceKey() != null
                            && requestedDays.contains(s.getRecurrenceKey().toUpperCase())
                            && s.getStartTime() != null)
                    .filter(s -> {
                        java.util.Set<java.sql.Time> requestedTimes =
                                requestedStartTimesByDay.get(s.getRecurrenceKey().toUpperCase());
                        return requestedTimes == null || !requestedTimes.contains(s.getStartTime());
                    })
                    .map(SessionSchedule::getId)
                    .toList();

            if (!schedulesToDeleteForRemovedTimeSlots.isEmpty()) {
                System.out.println("Deleting " + schedulesToDeleteForRemovedTimeSlots.size()
                        + " future schedules for removed time slots");
                scheduleNotificationRepository.disableNotificationsByScheduleIds(
                        schedulesToDeleteForRemovedTimeSlots, "DISABLED");
                scheduleRepository.deleteAllById(schedulesToDeleteForRemovedTimeSlots);
                // Remove from our working lists to prevent stale data
                futureSchedules = futureSchedules.stream()
                        .filter(s -> !schedulesToDeleteForRemovedTimeSlots.contains(s.getId()))
                        .toList();
                existingSchedules = existingSchedules.stream()
                        .filter(s -> !schedulesToDeleteForRemovedTimeSlots.contains(s.getId()))
                        .toList();
            }

            // Step 4b: Handle END DATE SHORTENING - Delete future schedules beyond new end
            // date
            List<String> schedulesToDeleteBeyondEndDate = futureSchedules.stream()
                    .filter(s -> toLocalDate(s.getMeetingDate()).isAfter(newEndDate))
                    .map(SessionSchedule::getId)
                    .toList();

            if (!schedulesToDeleteBeyondEndDate.isEmpty()) {
                System.out.println(
                        "Deleting " + schedulesToDeleteBeyondEndDate.size() + " future schedules beyond new end date");
                scheduleNotificationRepository.disableNotificationsByScheduleIds(schedulesToDeleteBeyondEndDate,
                        "DISABLED");
                scheduleRepository.deleteAllById(schedulesToDeleteBeyondEndDate);
                // Remove from our working lists to prevent stale data
                futureSchedules = futureSchedules.stream()
                        .filter(s -> !schedulesToDeleteBeyondEndDate.contains(s.getId()))
                        .toList();
                existingSchedules = existingSchedules.stream()
                        .filter(s -> !schedulesToDeleteBeyondEndDate.contains(s.getId()))
                        .toList();
            }

            // Step 4c: Handle START DATE CHANGES - Delete future schedules before new start
            // date
            List<String> schedulesToDeleteBeforeStartDate = futureSchedules.stream()
                    .filter(s -> toLocalDate(s.getMeetingDate()).isBefore(newStartDate))
                    .map(SessionSchedule::getId)
                    .toList();

            if (!schedulesToDeleteBeforeStartDate.isEmpty()) {
                System.out.println("Deleting " + schedulesToDeleteBeforeStartDate.size()
                        + " future schedules before new start date");
                scheduleNotificationRepository.disableNotificationsByScheduleIds(schedulesToDeleteBeforeStartDate,
                        "DISABLED");
                scheduleRepository.deleteAllById(schedulesToDeleteBeforeStartDate);
                // Remove from our working lists to prevent stale data
                futureSchedules = futureSchedules.stream()
                        .filter(s -> !schedulesToDeleteBeforeStartDate.contains(s.getId()))
                        .toList();
                existingSchedules = existingSchedules.stream()
                        .filter(s -> !schedulesToDeleteBeforeStartDate.contains(s.getId()))
                        .toList();
            }

            // Step 5: Process each day pattern in the request
            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getAddedSchedules()) {
                // If schedule has an ID and exists in DB, treat it as a single schedule update
                if (dto.getId() != null && !dto.getId().isEmpty() && scheduleRepository.existsById(dto.getId())) {
                    updateSingleSchedule(dto, request);
                    continue; // Skip pattern-based update logic for this DTO
                }

                String dayOfWeek = dto.getDay().toUpperCase();
                Time dtoStartTime = Time.valueOf(dto.getStartTime());

                // Get existing schedules for this day AND start_time
                // (to correctly handle multiple time slots on the same day)
                List<SessionSchedule> existingSchedulesForDay = existingSchedules.stream()
                        .filter(s -> s.getRecurrenceKey() != null && s.getRecurrenceKey().equalsIgnoreCase(dayOfWeek)
                                && s.getStartTime() != null && s.getStartTime().equals(dtoStartTime))
                        .sorted((a, b) -> toLocalDate(a.getMeetingDate()).compareTo(toLocalDate(b.getMeetingDate())))
                        .toList();

                // Step 5a: UPDATE existing future schedules for this day with new properties
                // (pattern-based)
                List<SessionSchedule> futureSchedulesForDay = existingSchedulesForDay.stream()
                        .filter(s -> toLocalDate(s.getMeetingDate()).isAfter(today))
                        .toList();

                for (SessionSchedule schedule : futureSchedulesForDay) {
                    updateScheduleProperties(schedule, dto, request);
                    scheduleRepository.save(schedule);
                }

                // Step 5b: CREATE new schedules for EXTENDED period
                // Find the last existing date for this day
                LocalDate lastExistingDate = existingSchedulesForDay.isEmpty()
                        ? null
                        : toLocalDate(existingSchedulesForDay.get(existingSchedulesForDay.size() - 1).getMeetingDate());

                // Determine starting point for new schedules
                LocalDate createFrom;
                if (lastExistingDate == null) {
                    // No existing schedules for this day, start from the beginning
                    createFrom = getNextOrSameDay(newStartDate, dayOfWeek);
                } else if (lastExistingDate.isBefore(newEndDate)) {
                    // Extend from last existing date
                    createFrom = lastExistingDate.plusWeeks(1);
                } else {
                    // No extension needed
                    createFrom = null;
                }

                // Create schedules for the extended period
                if (createFrom != null) {
                    LocalDate current = createFrom;
                    while (!current.isAfter(newEndDate)) {
                        // Use properties from the DTO (which should match last week's data)
                        SessionSchedule schedule = new SessionSchedule();
                        schedule.setSessionId(session.getId());
                        schedule.setRecurrenceType(request.getRecurrenceType());
                        schedule.setRecurrenceKey(dayOfWeek.toLowerCase());
                        schedule.setMeetingDate(java.sql.Date.valueOf(current));
                        schedule.setStartTime(Time.valueOf(dto.getStartTime()));
                        schedule.setThumbnailFileId(dto.getThumbnailFileId());
                        schedule.setDailyAttendance(dto.isDailyAttendance());
                        schedule.setStatus(LiveSessionStatus.LIVE.name());

                        // Calculate last entry time
                        LocalTime parsedStartTime = LocalTime.parse(dto.getStartTime());
                        LocalTime computedLastEntryTime = parsedStartTime
                                .plusMinutes(Long.parseLong(dto.getDuration()));
                        schedule.setLastEntryTime(Time.valueOf(computedLastEntryTime));

                        // Set meeting link
                        schedule.setCustomMeetingLink(
                                dto.getLink() != null ? dto.getLink() : request.getDefaultMeetLink());
                        schedule.setLinkType(dto.getLink() != null
                                ? resolveScheduleLinkType(dto.getLink(), request.getLinkType())
                                : resolveScheduleLinkType(request.getDefaultMeetLink(), request.getLinkType()));
                        schedule.setCustomWaitingRoomMediaId(null);

                        if (dto.getDefaultClassLink() != null) {
                            schedule.setDefaultClassLink(dto.getDefaultClassLink());
                            schedule.setDefaultClassName(dto.getDefaultClassName());
                            schedule.setDefaultClassLinkType(getLinkTypeFromUrl(dto.getDefaultClassLink()));
                        }

                        scheduleRepository.save(schedule);
                        System.out.println("Created new schedule for " + dayOfWeek + " on " + current);
                        current = current.plusWeeks(1);
                    }
                }

                // Step 5c: Handle START DATE BACKWARD EXTENSION
                // If new start date is before first existing schedule, create schedules for
                // that gap
                if (!existingSchedulesForDay.isEmpty()) {
                    LocalDate firstExistingDate = toLocalDate(existingSchedulesForDay.get(0).getMeetingDate());
                    LocalDate firstExpectedDate = getNextOrSameDay(newStartDate, dayOfWeek);

                    if (firstExpectedDate.isBefore(firstExistingDate)) {
                        LocalDate current = firstExpectedDate;
                        while (current.isBefore(firstExistingDate)) {
                            SessionSchedule schedule = new SessionSchedule();
                            schedule.setSessionId(session.getId());
                            schedule.setRecurrenceType(request.getRecurrenceType());
                            schedule.setRecurrenceKey(dayOfWeek.toLowerCase());
                            schedule.setMeetingDate(java.sql.Date.valueOf(current));
                            schedule.setStartTime(Time.valueOf(dto.getStartTime()));
                            schedule.setThumbnailFileId(dto.getThumbnailFileId());
                            schedule.setDailyAttendance(dto.isDailyAttendance());
                            schedule.setStatus(LiveSessionStatus.LIVE.name());

                            LocalTime parsedStartTime = LocalTime.parse(dto.getStartTime());
                            LocalTime computedLastEntryTime = parsedStartTime
                                    .plusMinutes(Long.parseLong(dto.getDuration()));
                            schedule.setLastEntryTime(Time.valueOf(computedLastEntryTime));

                            schedule.setCustomMeetingLink(
                                    dto.getLink() != null ? dto.getLink() : request.getDefaultMeetLink());
                            schedule.setLinkType(dto.getLink() != null
                                    ? resolveScheduleLinkType(dto.getLink(), request.getLinkType())
                                    : resolveScheduleLinkType(request.getDefaultMeetLink(), request.getLinkType()));
                            schedule.setCustomWaitingRoomMediaId(null);

                            if (dto.getDefaultClassLink() != null) {
                                schedule.setDefaultClassLink(dto.getDefaultClassLink());
                                schedule.setDefaultClassName(dto.getDefaultClassName());
                                schedule.setDefaultClassLinkType(getLinkTypeFromUrl(dto.getDefaultClassLink()));
                            }

                            scheduleRepository.save(schedule);
                            System.out.println(
                                    "Created new schedule for extended start date " + dayOfWeek + " on " + current);
                            current = current.plusWeeks(1);
                        }
                    }
                }
            }
        }

        // Always process updated_schedules if present (independent of added_schedules)
        handleUpdatedSchedules(request);

        // ONCE-recurrence sync: when an admin edits a one-time session and only
        // changes start_time / last_entry_time, the frontend often doesn't
        // include the schedule update in added_schedules / updated_schedules.
        // Without this, /get-sessions/search returns the stale schedule time
        // even though the top-level session.start_time was updated correctly.
        // Sync the single schedule's date + time fields from the session
        // timestamps (interpreted in the session's stored timezone).
        syncOnceRecurrenceSchedule(request, session);
    }

    /**
     * For sessions whose recurrence_type is "once", keep the single
     * SessionSchedule row in lock-step with the parent LiveSession's
     * start_time / last_entry_time. This guards the read APIs (search list
     * which reads ss.start_time) against drifting away from session.startTime
     * after a time-only edit.
     *
     * No-op for other recurrence types and when the session has zero or more
     * than one active schedule.
     */
    private void syncOnceRecurrenceSchedule(LiveSessionStep1RequestDTO request, LiveSession session) {
        String recurrence = request.getRecurrenceType();
        if (recurrence == null || !"once".equalsIgnoreCase(recurrence)) return;
        if (request.getStartTime() == null) return;

        List<SessionSchedule> currentSchedules = scheduleRepository.findBySessionId(session.getId())
                .stream()
                .filter(s -> !LiveSessionStatus.DELETED.name().equalsIgnoreCase(s.getStatus()))
                .toList();
        if (currentSchedules.size() != 1) return;

        SessionSchedule sch = currentSchedules.get(0);

        // session.startTime / lastEntryTime hold the user's wall-clock value;
        // extract using the same .atZone(UTC) pattern used elsewhere in this
        // file (see handleAddedSchedules date extraction). The previous code
        // shifted by the session timezone, double-converting the value.
        ZonedDateTime startZdt = request.getStartTime().toInstant().atZone(ZoneOffset.UTC);
        Date newMeetingDate = Date.valueOf(startZdt.toLocalDate());
        Time newStartTime = Time.valueOf(startZdt.toLocalTime());

        boolean changed = false;
        if (!newMeetingDate.equals(sch.getMeetingDate())) {
            sch.setMeetingDate(newMeetingDate);
            changed = true;
        }
        if (!newStartTime.equals(sch.getStartTime())) {
            sch.setStartTime(newStartTime);
            changed = true;
        }
        if (request.getLastEntryTime() != null) {
            ZonedDateTime endZdt = request.getLastEntryTime().toInstant().atZone(ZoneOffset.UTC);
            Time newLastEntryTime = Time.valueOf(endZdt.toLocalTime());
            if (!newLastEntryTime.equals(sch.getLastEntryTime())) {
                sch.setLastEntryTime(newLastEntryTime);
                changed = true;
            }
        }
        if (changed) {
            scheduleRepository.save(sch);
            log.info("Synced ONCE schedule {} to session {}: meetingDate={} startTime={}",
                    sch.getId(), session.getId(), newMeetingDate, newStartTime);
        }
    }

    /**
     * Helper to update individual schedule properties from DTO
     */
    private void updateScheduleProperties(SessionSchedule schedule, LiveSessionStep1RequestDTO.ScheduleDTO dto,
            LiveSessionStep1RequestDTO request) {
        if (dto.getStartTime() != null) {
            schedule.setStartTime(Time.valueOf(dto.getStartTime()));

            if (dto.getDuration() != null) {
                LocalTime parsedStartTime = LocalTime.parse(dto.getStartTime());
                LocalTime computedLastEntryTime = parsedStartTime.plusMinutes(Long.parseLong(dto.getDuration()));
                schedule.setLastEntryTime(Time.valueOf(computedLastEntryTime));
            }
        }

        String incomingLink = dto.getLink() != null ? dto.getLink() : request.getDefaultMeetLink();
        if (wouldStealProviderMeeting(incomingLink, schedule.getProviderMeetingId(), schedule.getLinkType())) {
            log.info("keeping provider link for scheduleId={} meetingId={} (incoming link is a "
                    + "different meeting of the same provider)", schedule.getId(), schedule.getProviderMeetingId());
        } else if (dto.getLink() != null) {
            schedule.setCustomMeetingLink(dto.getLink());
            schedule.setLinkType(resolveScheduleLinkType(dto.getLink(), request.getLinkType()));
        } else if (request.getDefaultMeetLink() != null) {
            schedule.setCustomMeetingLink(request.getDefaultMeetLink());
            schedule.setLinkType(resolveScheduleLinkType(request.getDefaultMeetLink(), request.getLinkType()));
        } else if (request.getLinkType() != null && !request.getLinkType().isBlank()) {
            // No link provided (e.g. BBB auto-creates later) — use explicit linkType
            schedule.setLinkType(request.getLinkType());
        }

        if (dto.getThumbnailFileId() != null) {
            schedule.setThumbnailFileId(dto.getThumbnailFileId());
        }

        schedule.setDailyAttendance(dto.isDailyAttendance());
    }

    /**
     * Check if we need to recreate all schedules (recurrence type change)
     */
    private boolean shouldRecreateAllSchedules(LiveSessionStep1RequestDTO request, LiveSession session) {
        // TODO: Implement logic to detect WEEKLY <-> NONE conversion
        // For now, return false
        return false;
    }

    /**
     * Helper method to convert java.util.Date to LocalDate
     */
    private LocalDate toLocalDate(java.util.Date date) {
        if (date == null)
            return null;
        return date.toInstant()
                .atZone(ZoneOffset.UTC)
                .toLocalDate();
    }

    private LiveSession getOrCreateSession(LiveSessionStep1RequestDTO request, CustomUserDetails user) {
        if (request.getSessionId() != null && !request.getSessionId().isEmpty()) {
            return sessionRepository.findById(request.getSessionId())
                    .orElseThrow(() -> new RuntimeException("Session not found with id: " + request.getSessionId()));
        } else {
            LiveSession session = new LiveSession();
            session.setCreatedByUserId(user.getUserId());
            session.setStatus(LiveSessionStatus.DRAFT.name());
            return session;
        }
    }

    private void updateSessionFields(LiveSession session, LiveSessionStep1RequestDTO request, CustomUserDetails user) {
        if (request.getTitle() != null)
            session.setTitle(request.getTitle());
        if (request.getSubject() != null)
            session.setSubject(request.getSubject());
        if (request.getDescriptionHtml() != null)
            session.setDescriptionHtml(request.getDescriptionHtml());
        if (request.getDefaultMeetLink() != null) {
            session.setDefaultMeetLink(request.getDefaultMeetLink());
            session.setLinkType(getLinkTypeFromUrl(request.getDefaultMeetLink()));
        }

        if (request.getStartTime() != null)
            session.setStartTime(request.getStartTime());
        if (request.getLastEntryTime() != null)
            session.setLastEntryTime(request.getLastEntryTime());
        if (request.getInstituteId() != null)
            session.setInstituteId(request.getInstituteId());
        if (request.getBackgroundScoreFileId() != null)
            session.setBackgroundScoreFileId(request.getBackgroundScoreFileId());
        if (request.getThumbnailFileId() != null)
            session.setThumbnailFileId(request.getThumbnailFileId());
        if (request.getWaitingRoomTime() != null)
            session.setWaitingRoomTime(request.getWaitingRoomTime());
        if (request.getWaitingRoomType() != null)
            session.setWaitingRoomType(request.getWaitingRoomType());
        if (request.getLinkType() != null)
            session.setLinkType(request.getLinkType());
        if (request.getAllowRewind() != null)
            session.setAllowRewind(request.getAllowRewind());
        if (request.getSessionStreamingServiceType() != null)
            session.setSessionStreamingServiceType(request.getSessionStreamingServiceType());
        if (request.getJoinLink() != null)
            session.setRegistrationFormLinkForPublicSessions(request.getJoinLink());
        if (request.getCoverFileId() != null)
            session.setCoverFileId(request.getCoverFileId());

        if (request.getBookingTypeId() != null)
            session.setBookingTypeId(request.getBookingTypeId());
        if (request.getSource() != null)
            session.setSource(request.getSource());
        if (request.getSourceId() != null)
            session.setSourceId(request.getSourceId());

        // New Field
        session.setAllowPlayPause(request.isAllowPlayPause());
        if (request.getShowToLearners() != null)
            session.setShowToLearners(request.getShowToLearners());
        // Normalize rather than store verbatim: the read queries splice this column into
        // `AT TIME ZONE`, so an unresolvable value (older ICU clients still send the legacy
        // `Asia/Calcutta`, which prod Postgres dropped) aborts the whole query and takes
        // live-session dispatch down for every institute. See TimezoneNormalizer.
        //
        // Blank is passed through untouched rather than defaulted: the queries already treat
        // it as "unset" via NULLIF(s.timezone, ''), so rewriting it here would convert an
        // unset marker into an explicit zone and change what the column means.
        if (request.getTimeZone() != null)
            session.setTimezone(TimezoneNormalizer.normalizePreservingBlank(request.getTimeZone()));

        // Save BBB meeting config as JSON
        if (request.getBbbConfig() != null) {
            try {
                session.setBbbConfigJson(new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(request.getBbbConfig()));
            } catch (Exception e) {
                System.out.println("Failed to serialize BBB config: " + e.getMessage());
            }
        }

        // Save feedback config as JSON
        if (request.getFeedbackConfig() != null) {
            try {
                session.setFeedbackConfigJson(new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(request.getFeedbackConfig()));
            } catch (Exception e) {
                System.out.println("Failed to serialize feedback config: " + e.getMessage());
            }
        }

        // Only stamp the creator on first create. This used to run on every
        // step-1 call, so editing somebody else's class silently transferred
        // ownership of it. That was invisible before V524; now that
        // created_by_user_id decides who can see a session (and who is its
        // implicit instructor), an admin opening a teacher's class to fix a
        // typo would have taken it away from that teacher.
        if (!StringUtils.hasText(session.getCreatedByUserId())) {
            session.setCreatedByUserId(user.getUserId());
        }

        Object learnerButtonConfig = request.getLearnerButtonConfig();

        if (learnerButtonConfig == null && request.getAddedSchedules() != null) {
            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getAddedSchedules()) {
                if (dto.getLearnerButtonConfig() != null) {
                    learnerButtonConfig = dto.getLearnerButtonConfig();
                    break;
                }
            }
        }

        if (learnerButtonConfig == null && request.getUpdatedSchedules() != null) {
            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getUpdatedSchedules()) {
                if (dto.getLearnerButtonConfig() != null) {
                    learnerButtonConfig = dto.getLearnerButtonConfig();
                    break;
                }
            }
        }

        if (learnerButtonConfig != null) {
            try {
                session.setLearnerButtonConfig(new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(learnerButtonConfig));
            } catch (Exception e) {
                System.err.println("Error serializing LearnerButtonConfig: " + e.getMessage());
            }
        }
    }

    private void handleDeletedSchedules(LiveSessionStep1RequestDTO request) {
        if (request.getDeletedScheduleIds() != null) {
            // First, disable all notifications for these schedule IDs
            scheduleNotificationRepository.disableNotificationsByScheduleIds(request.getDeletedScheduleIds(),
                    "DISABLED");

            // Then delete the schedules from session_schedule table
            for (String id : request.getDeletedScheduleIds()) {
                scheduleRepository.deleteById(id);
            }
        }
    }

    private void handleAddedSchedules(LiveSessionStep1RequestDTO request, LiveSession session) {
        if (request.getAddedSchedules() != null && !request.getAddedSchedules().isEmpty()) {
            LocalDate startDate = request.getStartTime()
                    .toInstant()
                    .atZone(ZoneOffset.UTC)
                    .toLocalDate();
            LocalDate endDate = LocalDate.parse(request.getSessionEndDate(), DateTimeFormatter.ISO_DATE);

            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getAddedSchedules()) {
                // If schedule has an ID and exists in DB, treat it as an update instead
                if (dto.getId() != null && !dto.getId().isEmpty() && scheduleRepository.existsById(dto.getId())) {
                    updateSingleSchedule(dto, request);
                    continue;
                }

                String dayOfWeek = dto.getDay().toUpperCase();

                LocalDate current = getNextOrSameDay(startDate, dayOfWeek);
                while (!current.isAfter(endDate)) {
                    SessionSchedule schedule = new SessionSchedule();
                    schedule.setSessionId(session.getId());
                    schedule.setRecurrenceType(request.getRecurrenceType());
                    schedule.setRecurrenceKey(dayOfWeek.toLowerCase());
                    schedule.setMeetingDate(java.sql.Date.valueOf(current));
                    schedule.setStartTime(Time.valueOf(dto.getStartTime()));
                    schedule.setThumbnailFileId(dto.getThumbnailFileId());
                    schedule.setDailyAttendance(dto.isDailyAttendance());

                    schedule.setStatus(LiveSessionStatus.LIVE.name());

                    LocalTime parsedStartTime = LocalTime.parse(dto.getStartTime());
                    LocalTime computedLastEntryTime = parsedStartTime.plusMinutes(Long.parseLong(dto.getDuration()));
                    schedule.setLastEntryTime(Time.valueOf(computedLastEntryTime));

                    schedule.setCustomMeetingLink(dto.getLink() != null ? dto.getLink() : request.getDefaultMeetLink());
                    schedule.setLinkType(dto.getLink() != null
                            ? getLinkTypeFromUrl(dto.getLink())
                            : getLinkTypeFromUrl(request.getDefaultMeetLink()));
                    schedule.setCustomWaitingRoomMediaId(null);

                    if (dto.getDefaultClassLink() != null) {
                        schedule.setDefaultClassLink(dto.getDefaultClassLink());
                        schedule.setDefaultClassName(dto.getDefaultClassName());
                        schedule.setDefaultClassLinkType(getLinkTypeFromUrl(dto.getDefaultClassLink()));
                    }

                    scheduleRepository.save(schedule);
                    current = current.plusWeeks(1);
                }
            }
        } else {
            LocalDate meetingLocalDate = request.getStartTime().toLocalDateTime().toLocalDate();
            LocalTime startLocalTime = request.getStartTime().toLocalDateTime().toLocalTime();
            LocalTime lastEntryLocalTime = request.getLastEntryTime().toLocalDateTime().toLocalTime();

            SessionSchedule schedule = new SessionSchedule();
            schedule.setSessionId(session.getId());
            schedule.setRecurrenceType(request.getRecurrenceType() != null ? request.getRecurrenceType() : "NONE");
            schedule.setMeetingDate(Date.valueOf(meetingLocalDate));
            schedule.setStartTime(Time.valueOf(startLocalTime));
            schedule.setLastEntryTime(Time.valueOf(lastEntryLocalTime));
            schedule.setCustomMeetingLink(request.getDefaultMeetLink());
            schedule.setLinkType(resolveScheduleLinkType(request.getDefaultMeetLink(), request.getLinkType()));
            schedule.setCustomWaitingRoomMediaId(null);
            schedule.setThumbnailFileId(request.getThumbnailFileId());
            schedule.setDailyAttendance(false); // default for single schedule
            schedule.setStatus(LiveSessionStatus.LIVE.name());

            if (request.getDefaultClassLink() != null) {
                schedule.setDefaultClassLink(request.getDefaultClassLink());
                schedule.setDefaultClassName(request.getDefaultClassName());
                schedule.setDefaultClassLinkType(getLinkTypeFromUrl(request.getDefaultClassLink()));
            }

            scheduleRepository.save(schedule);
        }
    }

    private void handleUpdatedSchedules(LiveSessionStep1RequestDTO request) {
        if (request.getUpdatedSchedules() != null) {
            for (LiveSessionStep1RequestDTO.ScheduleDTO dto : request.getUpdatedSchedules()) {
                updateSingleSchedule(dto, request);
            }
        }
    }

    private void updateSingleSchedule(LiveSessionStep1RequestDTO.ScheduleDTO dto, LiveSessionStep1RequestDTO request) {
        SessionSchedule schedule = scheduleRepository.findById(dto.getId())
                .orElseThrow(() -> new RuntimeException("Schedule not found with id: " + dto.getId()));

        // Update day
        if (dto.getDay() != null) {
            schedule.setRecurrenceKey(dto.getDay().toLowerCase());
        }

        // Update start time and calculate last entry time based on duration
        if (dto.getStartTime() != null) {
            schedule.setStartTime(Time.valueOf(dto.getStartTime()));

            if (dto.getDuration() != null) {
                LocalTime parsedStartTime = LocalTime.parse(dto.getStartTime());
                LocalTime computedLastEntryTime = parsedStartTime.plusMinutes(Long.parseLong(dto.getDuration()));
                schedule.setLastEntryTime(Time.valueOf(computedLastEntryTime));
            }
        }

        // Update meeting link and link type
        if (dto.getLink() != null) {
            schedule.setCustomMeetingLink(dto.getLink());
            schedule.setLinkType(resolveScheduleLinkType(dto.getLink(), request.getLinkType()));
        } else if (request.getDefaultMeetLink() != null) {
            schedule.setCustomMeetingLink(request.getDefaultMeetLink());
            schedule.setLinkType(resolveScheduleLinkType(request.getDefaultMeetLink(), request.getLinkType()));
        } else if (request.getLinkType() != null && !request.getLinkType().isBlank()) {
            schedule.setLinkType(request.getLinkType());
        }

        // Update other fields
        if (dto.getThumbnailFileId() != null) {
            schedule.setThumbnailFileId(dto.getThumbnailFileId());
        }
        schedule.setDailyAttendance(dto.isDailyAttendance());

        if (dto.getDefaultClassLink() != null) {
            schedule.setDefaultClassLink(dto.getDefaultClassLink());
            schedule.setDefaultClassName(dto.getDefaultClassName());
            schedule.setDefaultClassLinkType(getLinkTypeFromUrl(dto.getDefaultClassLink()));
        }

        scheduleRepository.save(schedule);
    }

    /**
     * Detects the provider from a meeting URL.
     *
     * <p>Returns the values the FRONTEND matches on ({@code StreamingPlatform}: "zoom",
     * "google meet"), NOT the enum names. The admin dashboard's recurring-session branch
     * compares linkType case-sensitively against those literals; anything else — including
     * {@code LinkType.ZOOM.name()} ("ZOOM") and {@code LinkType.GMEET.name()} ("GMEET") —
     * falls through to a plain participant link, so the teacher's "Start as Host" silently
     * joined them as an attendee and the class never actually started. The backend is
     * unaffected either way: it reads this field through
     * {@code MeetingProvider.fromString()}, which upper-cases and accepts both spellings.
     */
    /**
     * True when applying {@code incomingLink} would point a provider-managed occurrence at a
     * DIFFERENT meeting of the SAME provider.
     *
     * <p>The edit DTO carries one link per weekday, but each occurrence gets its own provider
     * meeting. Applying the DTO link blindly re-pointed every later occurrence of that weekday
     * at the FIRST occurrence's meeting while provider_meeting_id kept its own — host and
     * learners then joined different rooms and the class recorded where nobody was.
     *
     * <p>Deliberately narrow: switching provider (Zoom to YouTube, say), clearing the link, or
     * supplying a link for this row's own meeting all return false and are applied as before.
     * Only the same-provider-wrong-meeting case is refused, because that one is never intentional.
     */
    static boolean wouldStealProviderMeeting(String incomingLink, String providerMeetingId, String currentLinkType) {
        if (providerMeetingId == null || providerMeetingId.isBlank()
                || incomingLink == null || incomingLink.isBlank()
                || currentLinkType == null || currentLinkType.isBlank()) {
            return false;
        }
        // A link for this very meeting is harmless — same room, so let it through.
        if (incomingLink.contains(providerMeetingId)) {
            return false;
        }
        // Different provider entirely means a deliberate switch, not the weekday collision.
        return getLinkTypeFromUrl(incomingLink).equalsIgnoreCase(currentLinkType);
    }

    public static String getLinkTypeFromUrl(String link) {
        if (link == null || link.isEmpty()) {
            return "UNKNOWN";
        }
        String lowerLink = link.toLowerCase();
        if (lowerLink.contains("youtube.com") || lowerLink.contains("youtu.be")) {
            return LinkType.YOUTUBE.name();
        } else if (lowerLink.contains("zoom.us") || lowerLink.contains("zoom.com")) {
            return ZOOM_LINK_TYPE;
        } else if (lowerLink.contains("meet.google.com")) {
            return GMEET_LINK_TYPE;
        } else if (List.of("meeting.zoho.com", "meeting.zoho.in", "meeting.zoho.eu").stream()
                .anyMatch(lowerLink::contains)) {
            return LinkType.ZOHO_MEETING.name();
        } else {
            return LinkType.RECORDED.name();
        }
    }

    /**
     * Resolve schedule-level linkType: use URL-based detection first,
     * but fall back to the explicit request linkType when URL is empty/unknown.
     * This handles providers like BBB where the meeting link is auto-created later.
     */
    public static String resolveScheduleLinkType(String link, String requestLinkType) {
        String fromUrl = getLinkTypeFromUrl(link);
        if ("UNKNOWN".equals(fromUrl) && requestLinkType != null && !requestLinkType.isBlank()) {
            return requestLinkType;
        }
        return fromUrl;
    }

    private LocalDate getNextOrSameDay(LocalDate startDate, String dayOfWeekStr) {
        java.time.DayOfWeek targetDay = java.time.DayOfWeek.valueOf(dayOfWeekStr);
        java.time.DayOfWeek startDay = startDate.getDayOfWeek();
        int daysToAdd = (targetDay.getValue() - startDay.getValue() + 7) % 7;
        return startDate.plusDays(daysToAdd);
    }
}
