package vacademy.io.admin_core_service.features.live_session.service;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.dto.AdminMarkAttendanceRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.MarkAttendanceRequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;
import vacademy.io.admin_core_service.features.live_session.enums.SessionLog;
import vacademy.io.admin_core_service.features.live_session.dto.AttendanceCriteriaConfigDTO;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.scheduler.LiveSessionNotificationProcessor;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class LIveSessionAttendanceService {

    @Autowired
    private LiveSessionLogsRepository liveSessionLogRepository;

    @Autowired
    private LiveSessionNotificationProcessor notificationProcessor;

    @Autowired
    private AttendanceCriteriaService attendanceCriteriaService;

    @Autowired
    private LiveSessionRepository liveSessionRepository;

    public void markAttendance(MarkAttendanceRequestDTO request , CustomUserDetails user) {
        String userId = request.getUserSourceId().isEmpty() ? user.getUserId() : request.getUserSourceId();

        String previousStatus = upsertPresent(request, userId);

        // Notify only when the attendance state actually moved. The learner
        // waiting room re-marks on a 30s poll (and again on every rejoin or
        // refresh), so an unconditional call here mailed the learner dozens of
        // times for one class. The row was always idempotent; the mail was not.
        //
        // And stay silent entirely while a minimum-attendance rule is in force:
        // this row only records that the learner opened the join link, so
        // "you were marked present" is not yet true. The provider callback
        // decides, and notifies once with the real verdict — otherwise a learner
        // who leaves early is told PRESENT and then ABSENT for the same class.
        if (isStatusChange(previousStatus, "PRESENT") && !criteriaDecidesLater(request.getSessionId())) {
            notificationProcessor.sendAttendanceNotification(request.getSessionId(), userId, "PRESENT");
        }
    }

    public void markGuestAttendance(MarkAttendanceRequestDTO request ) {
        upsertPresent(request, request.getUserSourceId());
    }

    public void markAttendanceForGuest(MarkAttendanceRequestDTO request ) {
        upsertPresent(request, request.getUserSourceId());
    }

    /**
     * One atomic INSERT ... ON CONFLICT round trip instead of check-then-save.
     * A whole batch hits this concurrently at class start, so the flow must not
     * hold a connection across multiple statements or race on the existence
     * check (which historically produced duplicate attendance rows).
     */
    private String upsertPresent(MarkAttendanceRequestDTO request, String userSourceId) {
        return liveSessionLogRepository.upsertAttendanceReturningPreviousStatus(
                UUID.randomUUID().toString(),
                request.getSessionId(),
                request.getScheduleId(),
                request.getUserSourceType(),
                userSourceId,
                "PRESENT",
                "ONLINE",
                request.getDetails());
    }

    /**
     * Whether this session defers the attendance verdict to the provider callback.
     * Any failure resolves to false, so a lookup problem can only cost the old
     * behaviour (a join-time mail), never silence a learner who gets no other one.
     */
    private boolean criteriaDecidesLater(String sessionId) {
        try {
            return liveSessionRepository.findById(sessionId)
                    .map(attendanceCriteriaService::resolve)
                    .map(AttendanceCriteriaConfigDTO::isActive)
                    .orElse(false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * True when a mark is worth notifying about: either the first mark for this
     * schedule+user (no previous status) or a genuine transition such as an
     * admin-set ABSENT being overwritten by the learner actually joining.
     * Re-marking the same status is a no-op as far as the learner is concerned.
     */
    private static boolean isStatusChange(String previousStatus, String newStatus) {
        return previousStatus == null || !previousStatus.equalsIgnoreCase(newStatus);
    }

    /**
     * Admin batch marking — sets statusType=OFFLINE since admin is marking manually.
     * Returns a map with "updated" and "created" counts. Stays on check-then-save
     * because the response shape needs per-row created/updated attribution and this
     * path is a single admin request, not a concurrent stampede; the V415 unique
     * index still backstops it against duplicates.
     */
    public Map<String, Integer> adminMarkAttendance(AdminMarkAttendanceRequestDTO request) {
        int updated = 0;
        int created = 0;

        for (AdminMarkAttendanceRequestDTO.AttendanceEntry entry : request.getEntries()) {
            Optional<LiveSessionLogs> existingLog = liveSessionLogRepository.findExistingAttendanceRecord(
                    request.getScheduleId(),
                    entry.getUserSourceId()
            );

            // Captured before the overwrite: re-saving an attendance sheet
            // resubmits every row, so notifying unconditionally re-mailed
            // learners whose status never moved.
            boolean statusChanged;

            if (existingLog.isPresent()) {
                LiveSessionLogs log = existingLog.get();
                statusChanged = isStatusChange(log.getStatus(), entry.getStatus());
                log.setStatus(entry.getStatus());
                log.setStatusType("OFFLINE");
                // Re-type rows an older admin screen saved as EXTERNAL_USER for
                // enrolled learners; the report only reads USER rows for them.
                if (entry.getUserSourceType() != null && !entry.getUserSourceType().isBlank()) {
                    log.setUserSourceType(entry.getUserSourceType());
                }
                if (entry.getDetails() != null && !entry.getDetails().isBlank()) {
                    log.setDetails(entry.getDetails());
                }
                log.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
                liveSessionLogRepository.save(log);
                updated++;
            } else {
                statusChanged = true;
                LiveSessionLogs log = LiveSessionLogs.builder()
                        .sessionId(request.getSessionId())
                        .scheduleId(request.getScheduleId())
                        .userSourceType(entry.getUserSourceType() != null ? entry.getUserSourceType() : "USER")
                        .userSourceId(entry.getUserSourceId())
                        .logType(SessionLog.ATTENDANCE_RECORDED.name())
                        .status(entry.getStatus())
                        .statusType("OFFLINE")
                        .details(entry.getDetails())
                        .createdAt(new Timestamp(System.currentTimeMillis()))
                        .updatedAt(new Timestamp(System.currentTimeMillis()))
                        .build();
                liveSessionLogRepository.save(log);
                created++;
            }

            // Send attendance notification to learner
            if (statusChanged) {
                notificationProcessor.sendAttendanceNotification(
                        request.getSessionId(), entry.getUserSourceId(), entry.getStatus());
            }
        }

        return Map.of("updated", updated, "created", created);
    }
}
