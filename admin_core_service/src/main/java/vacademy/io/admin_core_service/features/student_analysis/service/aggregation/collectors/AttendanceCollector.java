package vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_session.dto.ScheduleAttendanceProjection;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.AttendanceSection;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

/**
 * Collects attendance data for a student over the report window.
 * Computes weekly buckets from the raw session list.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AttendanceCollector {

    private final LiveSessionParticipantRepository participantRepository;
    private final ObjectMapper objectMapper;

    private static final DateTimeFormatter MONTH_DAY_FMT = DateTimeFormatter.ofPattern("MMM dd");

    public AttendanceSection collect(String userId, String batchId, LocalDate startDate, LocalDate endDate) {
        return collect(userId, batchId, startDate, endDate, false);
    }

    /**
     * @param strictBatch the admin picked {@code batchId} on purpose (Reports tab filter): report
     *                    that batch only and never widen to the other batches.
     */
    public AttendanceSection collect(String userId, String batchId, LocalDate startDate, LocalDate endDate,
                                     boolean strictBatch) {
        try {
            List<ScheduleAttendanceProjection> records =
                    participantRepository.findAttendanceForUserAcrossBatches(userId, batchId, startDate, endDate);

            // The report's batchId is whatever batch the admin happened to open the learner from.
            // Sessions are frequently attached to a *different* package session the learner is also
            // enrolled in, in which case scoping to that one batch finds nothing and we would report
            // a flat 0% for a learner who actually attended. Widen to all of the learner's active
            // batches rather than publish a wrong number.
            if ((records == null || records.isEmpty()) && batchId != null && !strictBatch) {
                records = participantRepository.findAttendanceForUserAcrossBatches(userId, null, startDate, endDate);
                if (records != null && !records.isEmpty()) {
                    log.warn("[AttendanceCollector] userId={} had no sessions under batchId={} but {} across all "
                            + "active batches — reporting across all batches.", userId, batchId, records.size());
                }
            }

            // No sessions found ≠ the learner attended none of them. Reporting 0% here would be a
            // fabricated measurement: it is indistinguishable from a real 0% and it drags
            // OverviewBuilder's status down to "At Risk". Mark the section unavailable so the card
            // renders "No sessions in this period" and the overview simply omits attendance.
            if (records == null || records.isEmpty()) {
                log.info("[AttendanceCollector] No sessions found for userId={} batchId={} in [{} .. {}] "
                        + "— reporting as unavailable rather than 0%.", userId, batchId, startDate, endDate);
                return AttendanceSection.builder().available(false)
                        .totalSessions(0)
                        .sessions(List.of())
                        .weekly(List.of())
                        .build();
            }

            int present = 0, absent = 0, unmarked = 0;
            // LATE status — ScheduleAttendanceProjection may not have a LATE value;
            // we track it separately but it will always be 0 unless the projection supports it.
            int late = 0;
            List<AttendanceSection.SessionAttendanceItem> sessions = new ArrayList<>();

            for (ScheduleAttendanceProjection r : records) {
                String status = r.getAttendanceStatus();
                if ("PRESENT".equalsIgnoreCase(status)) present++;
                else if ("ABSENT".equalsIgnoreCase(status)) absent++;
                else if ("LATE".equalsIgnoreCase(status)) late++;
                else unmarked++;

                sessions.add(AttendanceSection.SessionAttendanceItem.builder()
                        .date(r.getMeetingDate() != null ? r.getMeetingDate().toString() : null)
                        .title(r.getSessionTitle())
                        .subject(r.getSubject())
                        .status(status)
                        .durationMinutes(null)
                        .engagement(null)
                        .build());
            }

            int totalSessions = present + absent + late + unmarked;

            // Fold "unmarked" into "absent" — see LiveClassCollector: attendance is auto-recorded as
            // PRESENT on join, so a session with no PRESENT record was not attended. This keeps the
            // Attendance card's Absent count consistent with the Live Classes card's Missed count.
            absent = absent + unmarked;
            unmarked = 0;

            // Overall % = (present + late) / total sessions — session-based, so it MATCHES the
            // Live Classes card exactly. We intentionally do NOT use getAttendancePercentage():
            // that query is day-based AND counts any day with an ATTENDANCE_RECORDED log as
            // "attended" even when the status is ABSENT, which inflated this number (73% vs the
            // real 62.2%). Both cards read the same present/total records now.
            double pct = totalSessions > 0 ? ((present + late) * 100.0 / totalSessions) : 0.0;

            // Build weekly buckets from sessions
            List<AttendanceSection.WeeklyBucket> weekly = buildWeeklyBuckets(sessions, startDate, endDate);

            return AttendanceSection.builder()
                    .available(true)
                    .overallPercentage(Math.round(pct * 100.0) / 100.0)
                    .present(present)
                    .absent(absent)
                    .late(late)
                    .unmarked(unmarked)
                    .totalSessions(totalSessions)
                    .trend(null)             // set by OverviewBuilder from prior report
                    .changeVsPrevious(null)  // set by OverviewBuilder from prior report
                    .note(null)              // LLM sets this; deterministic collectors leave it null
                    .sessions(sessions)
                    .weekly(weekly)
                    .build();

        } catch (Exception e) {
            log.error("[AttendanceCollector] Failed for userId={}: {}", userId, e.getMessage());
            return AttendanceSection.builder().available(false).build();
        }
    }

    /**
     * Groups sessions by calendar week (Mon–Sun) and computes a per-week attendance %.
     * Weeks that have no sessions are omitted from the output.
     */
    private List<AttendanceSection.WeeklyBucket> buildWeeklyBuckets(
            List<AttendanceSection.SessionAttendanceItem> sessions,
            LocalDate startDate, LocalDate endDate) {

        // Map from week-start-monday → [present+late, total]
        TreeMap<LocalDate, int[]> weekMap = new TreeMap<>();

        for (AttendanceSection.SessionAttendanceItem s : sessions) {
            if (s.getDate() == null) continue;
            try {
                LocalDate sessionDate = LocalDate.parse(s.getDate());
                // Clamp to report window
                if (sessionDate.isBefore(startDate) || sessionDate.isAfter(endDate)) continue;

                LocalDate weekStart = sessionDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
                weekMap.computeIfAbsent(weekStart, k -> new int[]{0, 0});
                weekMap.get(weekStart)[1]++; // total
                if ("PRESENT".equalsIgnoreCase(s.getStatus()) || "LATE".equalsIgnoreCase(s.getStatus())) {
                    weekMap.get(weekStart)[0]++; // attended
                }
            } catch (Exception ignored) {
                // malformed date — skip
            }
        }

        List<AttendanceSection.WeeklyBucket> buckets = new ArrayList<>();
        for (Map.Entry<LocalDate, int[]> entry : weekMap.entrySet()) {
            LocalDate weekStart = entry.getKey();
            int[] counts = entry.getValue();
            int total = counts[1];
            if (total == 0) continue;

            double weekPct = Math.round((counts[0] * 100.0 / total) * 10.0) / 10.0;

            // Compute week end (Sun), clamped to endDate
            LocalDate weekEnd = weekStart.plusDays(6);
            if (weekEnd.isAfter(endDate)) weekEnd = endDate;
            if (weekStart.isBefore(startDate)) weekStart = startDate;

            String label = weekStart.format(MONTH_DAY_FMT) + "–" + weekEnd.format(MONTH_DAY_FMT);
            buckets.add(AttendanceSection.WeeklyBucket.builder()
                    .week(label)
                    .percentage(weekPct)
                    .build());
        }
        return buckets;
    }
}
