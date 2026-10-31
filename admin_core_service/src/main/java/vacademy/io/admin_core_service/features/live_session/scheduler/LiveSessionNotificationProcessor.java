package vacademy.io.admin_core_service.features.live_session.scheduler;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.ScheduleNotification;
import vacademy.io.admin_core_service.features.live_session.enums.LiveClassAction;
import vacademy.io.admin_core_service.features.live_session.enums.NotificationStatusEnum;
import vacademy.io.admin_core_service.features.live_session.enums.NotificationTypeEnum;
import vacademy.io.admin_core_service.features.live_session.constants.AttendanceEmailBody;
import vacademy.io.admin_core_service.features.live_session.constants.LiveClassEmailBody;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassTemplateService;
import vacademy.io.admin_core_service.features.live_session.service.LiveClassTemplateService.ResolvedTemplate;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionParticipants;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.repository.ScheduleNotificationRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.institute.service.InstituteService;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.live_session.service.TimezoneSettingService;
import vacademy.io.admin_core_service.features.live_session.service.GetSessionByIdService;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionNotificationConfig;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionNotificationConfigRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import vacademy.io.admin_core_service.features.live_session.client.LiveSessionUserDirectoryClient;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionInstructorService;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionAttendanceOnlyModeService;

import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class LiveSessionNotificationProcessor {

    private static final java.time.format.DateTimeFormatter OLD_TIME_FORMATTER =
            java.time.format.DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy 'at' h:mm a", Locale.ENGLISH);

    private final ScheduleNotificationRepository scheduleNotificationRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final LiveSessionParticipantRepository liveSessionParticipantRepository;
    private final SessionScheduleRepository sessionScheduleRepository;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper; // kept for future template rendering
    private final InstituteService instituteService;
    private final InstituteDomainRoutingRepository domainRoutingRepository;
    private final TimezoneSettingService timezoneSettingService;
    private final GetSessionByIdService getSessionByIdService;
    private final InstituteStudentRepository studentRepository;
    private final LiveSessionNotificationConfigRepository notificationConfigRepository;
    private final LiveClassTemplateService liveClassTemplateService;
    private final WorkflowTriggerService workflowTriggerService;
    private final LiveSessionInstructorService liveSessionInstructorService;
    private final LiveSessionUserDirectoryClient userDirectoryClient;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    @Autowired
    private SessionScheduleRepository scheduleRepository;


    /**
     * Look-back window for the LIVE_SESSION_END dispatch. MUST equal the
     * Quartz cadence (5 min). The repository query uses a half-open interval
     * (now - 5m, now] so consecutive ticks' windows are non-overlapping —
     * each ended class falls into exactly one tick's window. We cannot use a
     * wider window because the workflow engine's default idempotency strategy
     * is UUID (per-call random key, no dedupe), so any overlap would fire the
     * workflow twice for the same class.
     */
    private static final int LIVE_SESSION_END_LOOKBACK_MINUTES = 5;

    /**
     * Same semantics as {@link #LIVE_SESSION_END_LOOKBACK_MINUTES} but for the
     * LIVE_SESSION_START dispatch — fires when a schedule's start time crosses
     * into the window. The cadence MUST match the Quartz tick (5 min). The
     * idempotency strategy for LIVE_SESSION_START triggers is EVENT_BASED
     * (see {@code WorkflowBuilderService.isPeriodicScanTrigger}), so the
     * unique index on {@code workflow_execution.idempotency_key} provides
     * cross-replica dedup as a backstop.
     */
    private static final int LIVE_SESSION_START_LOOKBACK_MINUTES = 5;


    @Transactional
    public void processDueNotifications() {
        // Since trigger times are now stored in UTC, we need to compare with UTC time
        ZoneId utcZone = ZoneId.of("UTC");
        LocalDateTime now = LocalDateTime.now(utcZone);
        LocalDateTime windowEnd = now.plusMinutes(5);
        System.out.println("current time (UTC): " + now);
        System.out.println("Current time on server is "+now);

        // Dispatch LIVE_SESSION_START workflow trigger for any class whose
        // start time crossed into the look-back window. Folded into this
        // processor (instead of a separate scheduler) so a single Quartz tick
        // handles all live-session periodic work. Wrapped so a workflow
        // failure can't poison the END dispatch or reminder dispatch below.
        try {
            dispatchStartedLiveSessionWorkflows();
        } catch (Exception e) {
            System.out.println("LIVE_SESSION_START dispatch failed (continuing): " + e.getMessage());
        }

        // Dispatch LIVE_SESSION_END workflow trigger for any class whose end fell
        // in the look-back window. Folded into this processor (instead of a
        // separate scheduler) so a single Quartz tick handles all live-session
        // periodic work. Wrapped so a workflow failure can't poison the existing
        // reminder dispatch below.
        try {
            dispatchEndedLiveSessionWorkflows();
        } catch (Exception e) {
            System.out.println("LIVE_SESSION_END dispatch failed (continuing with reminders): " + e.getMessage());
        }

        // 1) Mark past-due PENDING notifications as EXPIRED (no send)
        List<ScheduleNotification> pastDue = scheduleNotificationRepository.findPastDue(now.minusMinutes(2));
        for (ScheduleNotification sn : pastDue) {
            sn.setStatus(NotificationStatusEnum.DISABLED.name()); // or EXPIRED if you add enum
            scheduleNotificationRepository.save(sn);
        }

        // 2) Send only those strictly within [now, now+5m]
        List<ScheduleNotification> due = scheduleNotificationRepository.findPendingBetween(now.minusMinutes(2), windowEnd);
        if (due.isEmpty()) return;

        for (ScheduleNotification sn : due) {
            String idempotencyKey = buildIdempotencyKey(sn);
            try {
                int claimed = scheduleNotificationRepository.claimWithIdempotencyKey(
                        sn.getId(),
                        idempotencyKey,
                        NotificationStatusEnum.PENDING.name()
                );

                if (claimed == 0) {
                    continue;
                }

                Optional<LiveSession> sessionOpt = liveSessionRepository.findById(sn.getSessionId());
                if (sessionOpt.isEmpty()) {
                    scheduleNotificationRepository.updateStatus(sn.getId(), NotificationStatusEnum.DISABLED.name());
                    continue;
                }
                LiveSession session = sessionOpt.get();

                // Get all participants (both BATCH and USER types)
                List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sn.getSessionId());
                if (participants == null || participants.isEmpty()) {
                    scheduleNotificationRepository.updateStatus(sn.getId(), NotificationStatusEnum.SENT.name());
                    continue;
                }

                // Fetch schedule details for email template
                Optional<SessionSchedule> scheduleOpt = sessionScheduleRepository.findById(sn.getScheduleId());
                SessionSchedule schedule = scheduleOpt.orElse(null);
                
                // Fetch students from both batch and individual user participants
                List<Object[]> rows = getStudentsForNotification(participants, session.getInstituteId(), session.getId());

                if (!rows.isEmpty()) {
                    Set<String> channels = parseChannels(sn.getChannel());
                    String sessionTitle = session.getTitle() != null ? session.getTitle() : "Live Class";

                    // Email notifications (existing behavior)
                    if (channels.contains("EMAIL")) {
                        if (sn.getType().equals(NotificationTypeEnum.BEFORE_LIVE.name())) {
                            NotificationDTO notification = buildBeforeLiveEmailNotification(session, sn, schedule, rows);
                            notificationService.sendEmailViaUnified(notification, session.getInstituteId());
                        }
                        if (sn.getType().equals(NotificationTypeEnum.ON_LIVE.name())) {
                            NotificationDTO notification = buildOnLiveEmailNotification(session, sn, schedule, rows);
                            notificationService.sendEmailViaUnified(notification, session.getInstituteId());
                        }
                    }

                    // Push notifications
                    if (channels.contains("PUSH_NOTIFICATION")) {
                        List<String> userIds = extractUserIds(rows);
                        String pushTitle = sn.getType().equals(NotificationTypeEnum.ON_LIVE.name())
                                ? "Live Class Started" : "Live Class Starting Soon";
                        String pushBody = sessionTitle + (sn.getType().equals(NotificationTypeEnum.ON_LIVE.name())
                                ? " has started – Join now!" : " begins shortly. Get ready!");
                        notificationService.sendPushViaUnified(
                                session.getInstituteId(), userIds, pushTitle, pushBody,
                                Map.of("sessionId", session.getId(), "type", "LIVE_CLASS"));
                    }

                    // System notifications (SSE)
                    if (channels.contains("SYSTEM_NOTIFICATION")) {
                        List<String> userIds = extractUserIds(rows);
                        String alertTitle = sn.getType().equals(NotificationTypeEnum.ON_LIVE.name())
                                ? "Live Class Started" : "Live Class Starting Soon";
                        String alertBody = sessionTitle + (sn.getType().equals(NotificationTypeEnum.ON_LIVE.name())
                                ? " has started – Join now!" : " begins shortly.");
                        notificationService.sendSystemAlertViaUnified(
                                session.getInstituteId(), userIds, alertTitle, alertBody);
                    }
                }

                scheduleNotificationRepository.updateStatus(sn.getId(), NotificationStatusEnum.SENT.name());
            } catch (Exception ex) {
                scheduleNotificationRepository.releaseClaim(sn.getId(), NotificationStatusEnum.PENDING.name());
                System.out.println("Skip failure tracking per requirements; keep PENDING to retry next run"+ex);
            }
        }
    }

    /**
     * Fires the LIVE_SESSION_START workflow trigger for every schedule whose
     * start (meeting_date + start_time, in session timezone) crossed into the
     * look-back window. Sibling of {@link #dispatchEndedLiveSessionWorkflows()}
     * with identical dedup semantics — see that method's Javadoc for the
     * EVENT_BASED idempotency strategy.
     */
    private void dispatchStartedLiveSessionWorkflows() {
        List<SessionSchedule> started = sessionScheduleRepository.findStartedInLastMinutes(LIVE_SESSION_START_LOOKBACK_MINUTES);
        if (started == null || started.isEmpty()) return;
        System.out.println("LIVE_SESSION_START dispatch: " + started.size() + " schedule(s) started in last "
                + LIVE_SESSION_START_LOOKBACK_MINUTES + " minutes");

        for (SessionSchedule schedule : started) {
            try {
                Optional<LiveSession> sessionOpt = liveSessionRepository.findById(schedule.getSessionId());
                if (sessionOpt.isEmpty()) continue;
                LiveSession session = sessionOpt.get();

                Map<String, Object> ctx = new HashMap<>();
                ctx.put("liveSession", session);
                ctx.put("sessionId", session.getId());
                ctx.put("scheduleId", schedule.getId());
                ctx.put("instituteId", session.getInstituteId());
                ctx.put("sessionTitle", session.getTitle());
                ctx.put("meetingDate", schedule.getMeetingDate());
                ctx.put("startTime", schedule.getStartTime());

                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.LIVE_SESSION_START.name(),
                        schedule.getId(),
                        session.getInstituteId(),
                        ctx);
            } catch (Exception e) {
                System.out.println("LIVE_SESSION_START dispatch skipped scheduleId="
                        + schedule.getId() + " due to: " + e.getMessage());
            }
        }
    }

    /**
     * Fires the LIVE_SESSION_END workflow trigger for every schedule whose end
     * (meeting_date + last_entry_time, in session timezone) fell within the
     * look-back window.
     *
     * <p>De-duplication is handled by the workflow engine's idempotency layer:
     * LIVE_SESSION_END triggers are configured with EVENT_BASED strategy
     * (includeTriggerId + includeEventType + includeEventId), which produces
     * a stable key {@code trigger_X_eventType_LIVE_SESSION_END_eventId_<scheduleId>}.
     * The unique index on {@code workflow_execution.idempotency_key} (V30)
     * rejects duplicate INSERTs on the second-arriving replica's call. See
     * WorkflowBuilderService for where this strategy is set on trigger creation.
     *
     * <p>Per-row try/catch so a single bad schedule (or workflow failure) can't
     * stop the rest of the dispatch.
     */
    private void dispatchEndedLiveSessionWorkflows() {
        List<SessionSchedule> ended = sessionScheduleRepository.findEndedInLastMinutes(LIVE_SESSION_END_LOOKBACK_MINUTES);
        if (ended == null || ended.isEmpty()) return;
        System.out.println("LIVE_SESSION_END dispatch: " + ended.size() + " schedule(s) ended in last "
                + LIVE_SESSION_END_LOOKBACK_MINUTES + " minutes");

        for (SessionSchedule schedule : ended) {
            try {
                Optional<LiveSession> sessionOpt = liveSessionRepository.findById(schedule.getSessionId());
                if (sessionOpt.isEmpty()) continue;
                LiveSession session = sessionOpt.get();

                Map<String, Object> ctx = new HashMap<>();
                ctx.put("liveSession", session);
                ctx.put("sessionId", session.getId());
                ctx.put("scheduleId", schedule.getId());
                ctx.put("instituteId", session.getInstituteId());
                ctx.put("sessionTitle", session.getTitle());
                ctx.put("meetingDate", schedule.getMeetingDate());
                ctx.put("startTime", schedule.getStartTime());
                ctx.put("endTime", schedule.getLastEntryTime());

                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.LIVE_SESSION_END.name(),
                        schedule.getId(),
                        session.getInstituteId(),
                        ctx);
            } catch (Exception e) {
                System.out.println("LIVE_SESSION_END dispatch skipped scheduleId="
                        + schedule.getId() + " due to: " + e.getMessage());
            }
        }
    }

    private String buildIdempotencyKey(ScheduleNotification notification) {
        String schedulePart = notification.getScheduleId() != null ? notification.getScheduleId() : "NO_SCHEDULE";
        return schedulePart + ":" + notification.getId();
    }

    private List<String> getBatchIdsForSession(String sessionId) {
        List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);
        if (participants == null || participants.isEmpty()) return Collections.emptyList();
        Set<String> batchIds = new HashSet<>();
        for (LiveSessionParticipants p : participants) {
            if ("BATCH".equalsIgnoreCase(p.getSourceType())) {
                batchIds.add(p.getSourceId());
            }
        }
        return new ArrayList<>(batchIds);
    }

    private List<Object[]> getStudentsForNotification(List<LiveSessionParticipants> participants,
                                                     String instituteId,
                                                     String sessionId) {
        List<Object[]> allStudents = new ArrayList<>();

        // Attendance-only institute: learners are never told about classes, so
        // only the instructors' rows go out (on create, reminders, edit, cancel).
        if (attendanceOnlyModeService.suppressesLearnerNotifications(instituteId, sessionId)) {
            allStudents.addAll(getInstructorRecipients(sessionId));
            return allStudents;
        }
        
        // Separate batch and individual user participants
        List<String> batchIds = new ArrayList<>();
        List<String> individualUserIds = new ArrayList<>();
        
        for (LiveSessionParticipants p : participants) {
            if ("BATCH".equalsIgnoreCase(p.getSourceType())) {
                batchIds.add(p.getSourceId());
            } else if ("USER".equalsIgnoreCase(p.getSourceType())) {
                individualUserIds.add(p.getSourceId());
            }
        }
        
        // Fetch students from batch participants (existing functionality)
        if (!batchIds.isEmpty()) {
            List<Object[]> batchStudents = mappingRepository.findMappingsWithStudentContactsByInstitute(
                    batchIds,
                    instituteId,
                    Arrays.asList("ACTIVE", "ENROLLED")
            );
            allStudents.addAll(batchStudents);
        }
        
        // Fetch individual users directly
        if (!individualUserIds.isEmpty()) {
            List<Object[]> individualStudents = mappingRepository.findStudentContactsByUserIds(individualUserIds);
            allStudents.addAll(individualStudents);
        }

        allStudents.addAll(getInstructorRecipients(sessionId));

        return allStudents;
    }

    /**
     * The session's instructors, as notification rows (V524), so a teacher is
     * told about their own class the same way the learners are.
     *
     * <p>Their contacts come from auth_service, not from the {@code student}
     * table the learner rows come from: staff have no row there, so the
     * existing contact query returns nothing for them.
     *
     * <p>Shaped as the 5-element "individual user" row
     * {@code [user_id, full_name, mobile_number, email, region]} that every
     * notification builder in this class already understands, which is what
     * makes instructors work across all of them (on-create, before-live,
     * on-live, delete, attendance) without touching each builder.
     *
     * <p>Never throws: a directory hiccup must not stop the learners' mail.
     */
    private List<Object[]> getInstructorRecipients(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return Collections.emptyList();
        }
        try {
            List<String> instructorIds = liveSessionInstructorService
                    .getExplicitInstructorUserIds(sessionId);
            if (instructorIds.isEmpty()) {
                return Collections.emptyList();
            }
            Map<String, LiveSessionUserDirectoryClient.DirectoryUser> directory =
                    userDirectoryClient.findUsersByIds(instructorIds);

            List<Object[]> rows = new ArrayList<>();
            for (String userId : instructorIds) {
                LiveSessionUserDirectoryClient.DirectoryUser user = directory.get(userId);
                // No resolvable email means nothing to send to; skip rather than
                // emit a row the mailer would reject.
                if (user == null || user.email() == null || user.email().isBlank()) {
                    continue;
                }
                rows.add(new Object[]{userId, user.fullName(), user.mobileNumber(), user.email(), null});
            }
            return rows;
        } catch (Exception e) {
            System.out.println("Instructor notification recipients skipped for session "
                    + sessionId + ": " + e.getMessage());
            return Collections.emptyList();
        }
    }

    private NotificationDTO buildOnLiveEmailNotification(LiveSession session, ScheduleNotification sn, SessionSchedule schedule, List<Object[]> rows) {
        ResolvedTemplate template = liveClassTemplateService.resolveTemplate(session.getInstituteId(), NotificationEventType.LIVE_CLASS_ON_LIVE);
        NotificationDTO dto = new NotificationDTO();
        dto.setBody(template.body());
        dto.setSubject(template.subject());
        dto.setNotificationType("EMAIL");
        dto.setSource("ADMIN_CORE");
        dto.setSourceId(session.getId());

        List<NotificationToUserDTO> users = new ArrayList<>();
        for (Object[] r : rows) {
            // Handle different data structures from batch vs individual user queries
            String userId, fullName, email;
            
            if (r.length >= 7) {
                // Batch query result: [mapping_id, user_id, expiry_date, full_name, mobile_number, email, region, package_session_id]
                userId = (String) r[1];
                fullName = (String) r[3];
                email = (String) r[5];
            } else {
                // Individual user query result: [user_id, full_name, mobile_number, email, region]
                userId = (String) r[0];
                fullName = (String) r[1];
                email = (String) r[3];
            }
            NotificationToUserDTO u = new NotificationToUserDTO();
            Map<String, String> placeholders = new HashMap<>();
            placeholders.put("NAME", fullName);
            placeholders.put("SESSION_TITLE", session.getTitle() != null ? session.getTitle() : "Live Class");

            placeholders.put("ACTION", LiveClassAction.STARTED.getDisplayName());

            // Add theme color
            placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
            placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
            placeholders.put("YEAR", getCurrentYear());

            // Add schedule details if available
            if (schedule != null) {
                // Build live class URL based on access level and domain routing
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                System.out.println("DEBUG: Final live class URL: " + liveClassUrl);
                placeholders.put("LINK", liveClassUrl);

                // Format date and time for all configured timezones
                String allTimezonesTimes = timezoneSettingService.createTimezoneDisplayString(
                    schedule.getMeetingDate(), schedule.getStartTime(), session.getInstituteId(), session.getTimezone());
                placeholders.put("ALL_TIMEZONE_TIMES", allTimezonesTimes);
                
                // Keep individual DATE and TIME for backward compatibility
                placeholders.put("DATE", new SimpleDateFormat("EEEE, MMMM d, yyyy").format(schedule.getMeetingDate()));
                placeholders.put("TIME", new SimpleDateFormat("h:mm a").format(schedule.getStartTime()));
            } else {
                // Build live class URL even if schedule is null
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                placeholders.put("LINK", liveClassUrl);
                placeholders.put("ALL_TIMEZONE_TIMES", "TBD");
                placeholders.put("DATE", "TBD");
                placeholders.put("TIME", "TBD");
            }

            u.setPlaceholders(placeholders);
            u.setUserId(userId);
            u.setChannelId(email);
            users.add(u);
        }
        dto.setUsers(users);
        return dto;
    }
    private NotificationDTO buildBeforeLiveEmailNotification(LiveSession session, ScheduleNotification sn, SessionSchedule schedule, List<Object[]> rows) {
        ResolvedTemplate template = liveClassTemplateService.resolveTemplate(session.getInstituteId(), NotificationEventType.LIVE_CLASS_BEFORE_LIVE);
        NotificationDTO dto = new NotificationDTO();
        dto.setBody(template.body());
        dto.setSubject(template.subject());
        dto.setNotificationType("EMAIL");
        dto.setSource("ADMIN_CORE");
        dto.setSourceId(session.getId());

        List<NotificationToUserDTO> users = new ArrayList<>();
        for (Object[] r : rows) {
            // Handle different data structures from batch vs individual user queries
            String userId, fullName, email;
            
            if (r.length >= 7) {
                // Batch query result: [mapping_id, user_id, expiry_date, full_name, mobile_number, email, region, package_session_id]
                userId = (String) r[1];
                fullName = (String) r[3];
                email = (String) r[5];
            } else {
                // Individual user query result: [user_id, full_name, mobile_number, email, region]
                userId = (String) r[0];
                fullName = (String) r[1];
                email = (String) r[3];
            }
            NotificationToUserDTO u = new NotificationToUserDTO();
            Map<String, String> placeholders = new HashMap<>();
            placeholders.put("NAME", fullName);
            placeholders.put("SESSION_TITLE", session.getTitle() != null ? session.getTitle() : "Live Class");

            placeholders.put("ACTION", LiveClassAction.STARTING.getDisplayName());

            // Add theme color
            placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
            placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
            placeholders.put("YEAR", getCurrentYear());

            // Add schedule details if available
            if (schedule != null) {
                // Build live class URL based on access level and domain routing
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                System.out.println("DEBUG: Final live class URL: " + liveClassUrl);
                placeholders.put("LINK", liveClassUrl);

                // Format date and time for all configured timezones
                String allTimezonesTimes = timezoneSettingService.createTimezoneDisplayString(
                    schedule.getMeetingDate(), schedule.getStartTime(), session.getInstituteId(), session.getTimezone());
                placeholders.put("ALL_TIMEZONE_TIMES", allTimezonesTimes);
                
                // Keep individual DATE and TIME for backward compatibility
                placeholders.put("DATE", new SimpleDateFormat("EEEE, MMMM d, yyyy").format(schedule.getMeetingDate()));
                placeholders.put("TIME", new SimpleDateFormat("h:mm a").format(schedule.getStartTime()));
            } else {
                // Build live class URL even if schedule is null
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                placeholders.put("LINK", liveClassUrl);
                placeholders.put("ALL_TIMEZONE_TIMES", "TBD");
                placeholders.put("DATE", "TBD");
                placeholders.put("TIME", "TBD");
            }

            u.setPlaceholders(placeholders);
            u.setUserId(userId);
            u.setChannelId(email);
            users.add(u);
        }
        dto.setUsers(users);
        return dto;
    }


    @Transactional
    public void sendDeleteNotification(String sessionId, String instituteId) {
        try {
            // Get session details before deletion
            Optional<LiveSession> sessionOpt = liveSessionRepository.findById(sessionId);
            if (sessionOpt.isEmpty()) {
                System.out.println("Session not found for delete notification: " + sessionId);
                return;
            }
            LiveSession session = sessionOpt.get();

            // Get all participants (both BATCH and USER types)
            List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);
            if (participants == null || participants.isEmpty()) {
                System.out.println("No participants found for session: " + sessionId);
                return;
            }

            // Get the most recent schedule for date/time information
            List<SessionSchedule> schedules = sessionScheduleRepository.findBySessionId(sessionId);
            SessionSchedule schedule = schedules.isEmpty() ? null : schedules.get(0);

            // Fetch students from both batch and individual user participants
            List<Object[]> rows = getStudentsForNotification(participants, instituteId, sessionId);

            if (!rows.isEmpty()) {
                NotificationDTO notification = buildDeleteEmailNotification(session, schedule, rows);
                notificationService.sendEmailViaUnified(notification, instituteId);
                System.out.println("Delete notification sent for session: " + sessionId + " to " + rows.size() + " participants");
            }
        } catch (Exception ex) {
            System.out.println("Error sending delete notification for session " + sessionId + ": " + ex.getMessage());
            // Don't rethrow - we don't want to prevent deletion if notification fails
        }
    }

    @Transactional
    public void sendDeleteNotificationForSchedules(List<String> scheduleIds, String instituteId) {
        for (String scheduleId : scheduleIds) {
            try {
                // Get session ID from schedule
                String sessionId = sessionScheduleRepository.findSessionIdByScheduleId(scheduleId, NotificationStatusEnum.DELETED.name());
                if (sessionId == null) {
                    System.out.println("Session ID not found for schedule: " + scheduleId);
                    continue;
                }

                // Get session details
                Optional<LiveSession> sessionOpt = liveSessionRepository.findById(sessionId);
                if (sessionOpt.isEmpty()) {
                    System.out.println("Session not found for schedule delete notification: " + sessionId);
                    continue;
                }
                LiveSession session = sessionOpt.get();

                // Get participants
                List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);
                if (participants == null || participants.isEmpty()) {
                    System.out.println("No participants found for session: " + sessionId);
                    continue;
                }

                // Get the specific schedule being deleted
                Optional<SessionSchedule> scheduleOpt = sessionScheduleRepository.findById(scheduleId);
                SessionSchedule schedule = scheduleOpt.orElse(null);
                scheduleRepository.softDeleteScheduleByIdIn(List.of(scheduleId));

                // Fetch students
                List<Object[]> rows = getStudentsForNotification(participants, instituteId, sessionId);

                if (!rows.isEmpty()) {
                    NotificationDTO notification = buildDeleteEmailNotification(session, schedule, rows);
                    notificationService.sendEmailViaUnified(notification, instituteId);
                    System.out.println("Delete notification sent for schedule: " + scheduleId + " to " + rows.size() + " participants");
                }
            } catch (Exception ex) {
                System.out.println("Error sending delete notification for schedule " + scheduleId + ": " + ex.getMessage());
            }
        }
    }

    private NotificationDTO buildDeleteEmailNotification(LiveSession session, SessionSchedule schedule, List<Object[]> rows) {
        ResolvedTemplate template = liveClassTemplateService.resolveTemplate(session.getInstituteId(), NotificationEventType.LIVE_CLASS_DELETE);
        NotificationDTO dto = new NotificationDTO();
        dto.setBody(template.body());
        dto.setSubject(template.subject());
        dto.setNotificationType("EMAIL");
        dto.setSource("ADMIN_CORE");
        dto.setSourceId(session.getId());

        List<NotificationToUserDTO> users = new ArrayList<>();
        for (Object[] r : rows) {
            // Handle different data structures from batch vs individual user queries
            String userId, fullName, email;
            
            if (r.length >= 7) {
                // Batch query result: [mapping_id, user_id, expiry_date, full_name, mobile_number, email, region, package_session_id]
                userId = (String) r[1];
                fullName = (String) r[3];
                email = (String) r[5];
            } else {
                // Individual user query result: [user_id, full_name, mobile_number, email, region]
                userId = (String) r[0];
                fullName = (String) r[1];
                email = (String) r[3];
            }
            
            NotificationToUserDTO u = new NotificationToUserDTO();
            Map<String, String> placeholders = new HashMap<>();
            placeholders.put("NAME", fullName);
            placeholders.put("SESSION_TITLE", session.getTitle() != null ? session.getTitle() : "Live Class");

            // Add theme color
            placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
            placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
            placeholders.put("YEAR", getCurrentYear());

            // Add schedule details if available
            if (schedule != null) {
                // Format date and time for all configured timezones
                String allTimezonesTimes = timezoneSettingService.createTimezoneDisplayString(
                    schedule.getMeetingDate(), schedule.getStartTime(), session.getInstituteId(), session.getTimezone());
                placeholders.put("ALL_TIMEZONE_TIMES", allTimezonesTimes);
                
                // Keep individual DATE and TIME for backward compatibility
                placeholders.put("DATE", new SimpleDateFormat("EEEE, MMMM d, yyyy").format(schedule.getMeetingDate()));
                placeholders.put("TIME", new SimpleDateFormat("h:mm a").format(schedule.getStartTime()));
            } else {
                placeholders.put("ALL_TIMEZONE_TIMES", "TBD");
                placeholders.put("DATE", "TBD");
                placeholders.put("TIME", "TBD");
            }

            u.setPlaceholders(placeholders);
            u.setUserId(userId);
            u.setChannelId(email);
            users.add(u);
        }
        dto.setUsers(users);
        return dto;
    }

    public void sendOnEditNotification(String sessionId, List<SessionSchedule> schedules,
                                       String oldMeetingDate, String oldStartTime) {
        try {
            LiveSession session = liveSessionRepository.findById(sessionId)
                    .orElseThrow(() -> new RuntimeException("Session not found: " + sessionId));

            SessionSchedule selectedSchedule = findEarliestUpcomingSchedule(schedules);
            if (selectedSchedule == null) {
                System.out.println("No upcoming schedule found for session: " + sessionId);
                return;
            }

            List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);
            if (participants == null || participants.isEmpty()) {
                System.out.println("No participants found for session: " + sessionId);
                return;
            }

            List<Object[]> rows = getStudentsForNotification(participants, session.getInstituteId(), session.getId());
            if (rows.isEmpty()) {
                System.out.println("No students found for notification for session: " + sessionId);
                return;
            }

            NotificationDTO notification = buildOnEditEmailNotification(session, selectedSchedule, rows,
                    oldMeetingDate, oldStartTime);
            notificationService.sendEmailViaUnified(notification, session.getInstituteId());

            System.out.println("ON_EDIT notification sent for session: " + sessionId + " to " + rows.size() + " participants");
        } catch (Exception ex) {
            System.out.println("Error sending ON_EDIT notification for session " + sessionId + ": " + ex.getMessage());
        }
    }

    private NotificationDTO buildOnEditEmailNotification(LiveSession session, SessionSchedule schedule, List<Object[]> rows,
                                                         String oldMeetingDate, String oldStartTime) {
        ResolvedTemplate template = liveClassTemplateService.resolveTemplate(session.getInstituteId(), NotificationEventType.LIVE_CLASS_ON_EDIT);
        String oldTime = formatOldTime(oldMeetingDate, oldStartTime);
        NotificationDTO dto = new NotificationDTO();
        dto.setBody(template.body());
        dto.setSubject(template.subject());
        dto.setNotificationType("EMAIL");
        dto.setSource("ADMIN_CORE");
        dto.setSourceId(session.getId());

        List<NotificationToUserDTO> users = new java.util.ArrayList<>();
        for (Object[] r : rows) {
            String userId, fullName, email;
            if (r.length >= 7) {
                userId = (String) r[1];
                fullName = (String) r[3];
                email = (String) r[5];
            } else {
                userId = (String) r[0];
                fullName = (String) r[1];
                email = (String) r[3];
            }

            NotificationToUserDTO u = new NotificationToUserDTO();
            Map<String, String> placeholders = new java.util.HashMap<>();
            placeholders.put("NAME", fullName);
            placeholders.put("SESSION_TITLE", session.getTitle() != null ? session.getTitle() : "Live Class");
            placeholders.put("ACTION", LiveClassAction.RESCHEDULED.getDisplayName());
            placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
            placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
            placeholders.put("YEAR", getCurrentYear());
            placeholders.put("OLD_TIME", oldTime);

            String liveClassUrl = buildLiveClassUrl(session, session.getId(), userId);
            placeholders.put("LINK", liveClassUrl);

            if (schedule != null) {
                String allTimezonesTimes = timezoneSettingService.createTimezoneDisplayString(
                        schedule.getMeetingDate(), schedule.getStartTime(), session.getInstituteId(), session.getTimezone());
                placeholders.put("ALL_TIMEZONE_TIMES", allTimezonesTimes);
                placeholders.put("DATE", new SimpleDateFormat("EEEE, MMMM d, yyyy").format(schedule.getMeetingDate()));
                placeholders.put("TIME", new SimpleDateFormat("h:mm a").format(schedule.getStartTime()));
            } else {
                placeholders.put("ALL_TIMEZONE_TIMES", "TBD");
                placeholders.put("DATE", "TBD");
                placeholders.put("TIME", "TBD");
            }

            u.setPlaceholders(placeholders);
            u.setUserId(userId);
            u.setChannelId(email);
            users.add(u);
        }
        dto.setUsers(users);
        return dto;
    }

    public void sendOnCreateNotification(String sessionId, List<SessionSchedule> schedules) {
        try {
            // Get session details
            LiveSession session = liveSessionRepository.findById(sessionId)
                    .orElseThrow(() -> new RuntimeException("Session not found: " + sessionId));

            // Group schedules by meeting_date and find the earliest schedule >= current date
            SessionSchedule selectedSchedule = findEarliestUpcomingSchedule(schedules);
            if (selectedSchedule == null) {
                System.out.println("No upcoming schedule found for session: " + sessionId);
                return;
            }

            // Get all participants (both BATCH and USER types)
            List<LiveSessionParticipants> participants = liveSessionParticipantRepository.findBySessionId(sessionId);
            if (participants == null || participants.isEmpty()) {
                System.out.println("No participants found for session: " + sessionId);
                return;
            }

            // Fetch students from both batch and individual user participants
            List<Object[]> rows = getStudentsForNotification(participants, session.getInstituteId(), session.getId());
            if (rows.isEmpty()) {
                System.out.println("No students found for notification for session: " + sessionId);
                return;
            }

            // Build and send notification
            NotificationDTO notification = buildOnCreateEmailNotification(session, selectedSchedule, rows);
            notificationService.sendEmailViaUnified(notification, session.getInstituteId());

            System.out.println("ON_CREATE notification sent for session: " + sessionId + " to " + rows.size() + " participants");

        } catch (Exception ex) {
            System.out.println("Error sending ON_CREATE notification for session " + sessionId + ": " + ex.getMessage());
            // Don't rethrow - we don't want to prevent session creation if notification fails
        }
    }

    /**
     * Renders the pre-edit schedule for the {{OLD_TIME}} placeholder, e.g.
     * "Monday, July 20, 2026 at 2:30 PM".
     *
     * The date and time arrive from the client as plain wall-clock strings and are
     * formatted verbatim — matching {{DATE}} and {{TIME}}, which also render the
     * stored wall-clock value without timezone conversion.
     *
     * Falls back to "TBD" (the same placeholder the other schedule fields use when
     * unknown) rather than returning null: the caller always puts the result in the
     * map, and a missing key would ship the literal "{{OLD_TIME}}" text to learners.
     */
    private String formatOldTime(String oldMeetingDate, String oldStartTime) {
        if (oldMeetingDate == null || oldMeetingDate.isBlank()
                || oldStartTime == null || oldStartTime.isBlank()) {
            return "TBD";
        }
        try {
            java.time.LocalDate date = java.time.LocalDate.parse(oldMeetingDate.trim());
            java.time.LocalTime time = java.time.LocalTime.parse(oldStartTime.trim());
            return OLD_TIME_FORMATTER.format(LocalDateTime.of(date, time));
        } catch (Exception ex) {
            System.out.println("Could not parse old schedule for OLD_TIME (date=" + oldMeetingDate
                    + ", time=" + oldStartTime + "): " + ex.getMessage());
            return "TBD";
        }
    }

    /**
     * Groups schedules by meeting_date and returns the earliest schedule >= current date
     * If meeting_date = current date, then start_time must be >= current time
     */
    private SessionSchedule findEarliestUpcomingSchedule(List<SessionSchedule> schedules) {
        if (schedules == null || schedules.isEmpty()) {
            return null;
        }

        java.time.LocalDate currentDate = java.time.LocalDate.now();
        java.time.LocalTime currentTime = java.time.LocalTime.now();

        return schedules.stream()
                .filter(schedule -> schedule.getMeetingDate() != null)
                .filter(schedule -> {
                    java.time.LocalDate meetingDate = schedule.getMeetingDate().toInstant()
                            .atZone(java.time.ZoneId.systemDefault()).toLocalDate();

                    // If meeting is in the future, include it
                    if (meetingDate.isAfter(currentDate)) {
                        return true;
                    }

                    // If meeting is today, check if start time is >= current time
                    if (meetingDate.isEqual(currentDate)) {
                        if (schedule.getStartTime() != null) {
                            java.time.LocalTime startTime = schedule.getStartTime().toLocalTime();
                            return !startTime.isBefore(currentTime);
                        }
                        return false; // No start time for today's meeting
                    }

                    // Meeting is in the past
                    return false;
                })
                .min((s1, s2) -> {
                    java.time.LocalDate date1 = s1.getMeetingDate().toInstant()
                            .atZone(java.time.ZoneId.systemDefault()).toLocalDate();
                    java.time.LocalDate date2 = s2.getMeetingDate().toInstant()
                            .atZone(java.time.ZoneId.systemDefault()).toLocalDate();

                    int dateComparison = date1.compareTo(date2);
                    if (dateComparison != 0) {
                        return dateComparison;
                    }

                    // If dates are equal, compare by start time
                    if (s1.getStartTime() != null && s2.getStartTime() != null) {
                        return s1.getStartTime().compareTo(s2.getStartTime());
                    }
                    return 0;
                })
                .orElse(null);
    }

    /**
     * Gets students for notification from both batch and individual user participants
     /**
     * Builds ON_CREATE email notification
     */
    private NotificationDTO buildOnCreateEmailNotification(LiveSession session, SessionSchedule schedule, List<Object[]> rows) {
        ResolvedTemplate template = liveClassTemplateService.resolveTemplate(session.getInstituteId(), NotificationEventType.LIVE_CLASS_ON_CREATE);
        NotificationDTO dto = new NotificationDTO();
        dto.setBody(template.body());
        dto.setSubject(template.subject());
        dto.setNotificationType("EMAIL");
        dto.setSource("ADMIN_CORE");
        dto.setSourceId(session.getId());

        List<NotificationToUserDTO> users = new java.util.ArrayList<>();
        for (Object[] r : rows) {
            // Handle different data structures from batch vs individual user queries
            String userId, fullName, email;

            if (r.length >= 7) {
                // Batch query result: [mapping_id, user_id, expiry_date, full_name, mobile_number, email, region, package_session_id]
                userId = (String) r[1];
                fullName = (String) r[3];
                email = (String) r[5];
            } else {
                // Individual user query result: [user_id, full_name, mobile_number, email, region]
                userId = (String) r[0];
                fullName = (String) r[1];
                email = (String) r[3];
            }

            NotificationToUserDTO u = new NotificationToUserDTO();
            Map<String, String> placeholders = new java.util.HashMap<>();
            placeholders.put("NAME", fullName);
            placeholders.put("SESSION_TITLE", session.getTitle() != null ? session.getTitle() : "Live Class");

            placeholders.put("ACTION", LiveClassAction.CREATED.getDisplayName());

            // Add theme color
            placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
            placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
            placeholders.put("YEAR", getCurrentYear());

            // Add schedule details if available
            if (schedule != null) {
                // Build live class URL based on access level and domain routing
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                placeholders.put("LINK", liveClassUrl);

                // Format date and time for all configured timezones
                String allTimezonesTimes = timezoneSettingService.createTimezoneDisplayString(
                    schedule.getMeetingDate(), schedule.getStartTime(), session.getInstituteId(), session.getTimezone());
                placeholders.put("ALL_TIMEZONE_TIMES", allTimezonesTimes);
                
                // Keep individual DATE and TIME for backward compatibility
                placeholders.put("DATE", new SimpleDateFormat("EEEE, MMMM d, yyyy").format(schedule.getMeetingDate()));
                placeholders.put("TIME", new SimpleDateFormat("h:mm a").format(schedule.getStartTime()));
            } else {
                // Build live class URL even if schedule is null
                String liveClassUrl = buildLiveClassUrl(session, session.getId(),userId);
                placeholders.put("LINK", liveClassUrl);
                placeholders.put("ALL_TIMEZONE_TIMES", "TBD");
                placeholders.put("DATE", "TBD");
                placeholders.put("TIME", "TBD");
            }

            u.setPlaceholders(placeholders);
            u.setUserId(userId);
            u.setChannelId(email);
            users.add(u);
        }
        dto.setUsers(users);
        return dto;
    }


    /**
     * Builds the live class URL based on session access level and domain routing
     * @param session LiveSession object containing access level and institute ID
     * @param sessionId Session ID to append to the URL
     * @return Built URL or fallback URL if domain routing not found
     */
    private String buildLiveClassUrl(LiveSession session, String sessionId , String userId) {
        try {
            if (session == null || session.getInstituteId() == null || sessionId == null) {
                return "#";
            }

            // Fetch domain routing for LEARNER role
            Optional<InstituteDomainRouting> routingOpt = domainRoutingRepository
                    .findByInstituteIdAndRole(session.getInstituteId(), "LEARNER");
            
            if (routingOpt.isEmpty()) {
                System.out.println("No domain routing found for institute: " + session.getInstituteId() + " with role LEARNER");
                return "#";
            }

            InstituteDomainRouting routing = routingOpt.get();
            String subdomain = routing.getSubdomain();
            String domain = routing.getDomain();

            Student student=studentRepository.findTopByUserId(userId).orElse(null);
            if(student!=null){
                return String.format("%s.%s/study-library/live-class/%s", subdomain, domain, student.getUsername());
            }else{
                return String.format("%s.%s/register/live-class?sessionId=%s", subdomain, domain, sessionId);
            }
        } catch (Exception e) {
            System.out.println("Error building live class URL for session " + sessionId + ": " + e.getMessage());
            return "#";
        }
    }

    private Set<String> parseChannels(String channel) {
        if (channel == null || channel.isBlank()) return Set.of("EMAIL");
        if ("BOTH".equals(channel)) return Set.of("EMAIL", "WHATSAPP");
        return Arrays.stream(channel.split(",")).map(String::trim).collect(Collectors.toSet());
    }

    private List<String> extractUserIds(List<Object[]> rows) {
        Set<String> userIds = new LinkedHashSet<>();
        for (Object[] r : rows) {
            String userId = r.length >= 7 ? (String) r[1] : (String) r[0];
            if (userId != null) userIds.add(userId);
        }
        return new ArrayList<>(userIds);
    }

    /**
     * Sends attendance notification to a specific student when marked present/absent.
     * Checks LiveSessionNotificationConfig for ATTENDANCE type.
     */
    public void sendAttendanceNotification(String sessionId, String userId, String status) {
        sendAttendanceNotification(sessionId, userId, status, null);
    }

    /**
     * @param reasonDetail plain-language explanation appended to the message, e.g.
     *                     why a learner fell short of the minimum-attendance rule.
     *                     Null/blank keeps the original wording.
     */
    public void sendAttendanceNotification(String sessionId, String userId, String status,
                                           String reasonDetail) {
        try {
            Optional<LiveSessionNotificationConfig> configOpt = notificationConfigRepository
                    .findBySessionIdAndNotificationType(sessionId, NotificationTypeEnum.ATTENDANCE.name());
            if (configOpt.isEmpty() || !Boolean.TRUE.equals(configOpt.get().getEnabled())) {
                return;
            }

            LiveSessionNotificationConfig config = configOpt.get();
            Set<String> channels = parseChannels(config.getChannels());

            Optional<LiveSession> sessionOpt = liveSessionRepository.findById(sessionId);
            if (sessionOpt.isEmpty()) return;
            LiveSession session = sessionOpt.get();
            // Attendance-only institute: no learner notifications at all, this one included.
            if (attendanceOnlyModeService.suppressesLearnerNotifications(session)) {
                return;
            }

            String sessionTitle = session.getTitle() != null ? session.getTitle() : "Live Class";
            String title = "Attendance Marked: " + status;
            String body = "You have been marked as " + status + " for " + sessionTitle;
            if (reasonDetail != null && !reasonDetail.isBlank()) {
                // A learner told they are absent for a class they attended part of
                // deserves the arithmetic, not just the verdict.
                body = body + ". " + reasonDetail;
            }

            if (channels.contains("PUSH_NOTIFICATION")) {
                notificationService.sendPushViaUnified(
                        session.getInstituteId(), List.of(userId), title, body,
                        Map.of("sessionId", sessionId, "type", "ATTENDANCE", "status", status));
            }
            if (channels.contains("SYSTEM_NOTIFICATION")) {
                notificationService.sendSystemAlertViaUnified(
                        session.getInstituteId(), List.of(userId), title, body);
            }
            if (channels.contains("EMAIL")) {
                // Build a simple email notification for the student
                Student student = studentRepository.findTopByUserId(userId).orElse(null);
                if (student != null && student.getEmail() != null) {
                    // An attendance record is not an invitation. LiveClassEmailBody is
                    // the invitation body — it opens "We're excited to invite you to our
                    // upcoming ...", renders a "Join the Live Class" button and closes
                    // "We look forward to seeing you there!". Sent for attendance it
                    // invited a learner to a class that had already finished, pointed the
                    // button at "#", and left an empty orange card where
                    // {{ALL_TIMEZONE_TIMES}} would have been.
                    NotificationDTO dto = new NotificationDTO();
                    dto.setBody(AttendanceEmailBody.Attendance_Email_Body);
                    dto.setSubject(title + " - " + sessionTitle);
                    dto.setNotificationType("EMAIL");
                    dto.setSource("ADMIN_CORE");
                    dto.setSourceId(sessionId);

                    NotificationToUserDTO u = new NotificationToUserDTO();
                    Map<String, String> placeholders = new HashMap<>();
                    placeholders.put("NAME", student.getFullName() != null ? student.getFullName() : "Student");
                    placeholders.put("SESSION_TITLE", sessionTitle);
                    placeholders.put("STATUS", status);
                    placeholders.put("STATUS_COLOR",
                            "ABSENT".equalsIgnoreCase(status) ? "#dc2626" : "#16a34a");
                    // A whole sentence belongs in the body, not interpolated into the
                    // header. Empty note renders nothing at all.
                    placeholders.put("STATUS_NOTE", AttendanceEmailBody.noteBlock(reasonDetail));
                    placeholders.put("SESSION_DATE", sessionDateLabel(session));
                    placeholders.put("THEME_COLOR", getThemeColor(session.getInstituteId()));
                    placeholders.put("INSTITUTE_NAME", getInstituteName(session.getInstituteId()));
                    placeholders.put("YEAR", getCurrentYear());
                    u.setPlaceholders(placeholders);
                    u.setUserId(userId);
                    u.setChannelId(student.getEmail());

                    dto.setUsers(List.of(u));
                    notificationService.sendEmailViaUnified(dto, session.getInstituteId());
                }
            }
        } catch (Exception e) {
            System.out.println("Error sending attendance notification for session " + sessionId + ", user " + userId + ": " + e.getMessage());
        }
    }


    /** "26 August 2026" for the attendance mail, or an empty label if unknown. */
    private String sessionDateLabel(LiveSession session) {
        try {
            var schedules = scheduleRepository.findBySessionId(session.getId());
            if (schedules != null && !schedules.isEmpty()) {
                var d = schedules.get(0).getMeetingDate();
                if (d != null) {
                    return new SimpleDateFormat("d MMMM yyyy").format(d);
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private String getThemeColor(String instituteId) {
        try {
            if (instituteId != null && !instituteId.trim().isEmpty()) {
                var institute = instituteService.findById(instituteId);
                String themeCode = institute.getInstituteThemeCode();
                if (themeCode != null && !themeCode.trim().isEmpty()) {
                    return themeCode;
                }
            }
        } catch (Exception e) {
            System.out.println("Failed to fetch theme color for institute " + instituteId + ": " + e.getMessage());
        }
        // Default fallback color
        return "#ff6f3c";
    }

    private String getInstituteName(String instituteId) {
        try {
            if (instituteId != null && !instituteId.trim().isEmpty()) {
                var institute = instituteService.findById(instituteId);
                String name = institute.getInstituteName();
                if (name != null && !name.trim().isEmpty()) {
                    return name;
                }
            }
        } catch (Exception e) {
            System.out.println("Failed to fetch institute name for institute " + instituteId + ": " + e.getMessage());
        }
        return "Your Organization";
    }

    private String getCurrentYear() {
        return String.valueOf(java.time.Year.now().getValue());
    }

}

