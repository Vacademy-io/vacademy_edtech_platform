package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerLiveClassDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerLiveClassProjection;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerLiveSessionsResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerUpcomingClassDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerUpcomingClassProjection;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.live_session.util.LiveClassEngagementScore;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Data for the Live Sessions tab on the admin learner profile: the learner's past classes with
 * attendance, attended minutes and a per-class concentration (engagement) score, and their next
 * classes with the links to join them.
 */
@Service
@RequiredArgsConstructor
public class LearnerLiveSessionService {

    /** A range wider than this is almost certainly a mistake, and the query is per-day work. */
    private static final long MAX_RANGE_DAYS = 400;
    private static final int MAX_UPCOMING = 20;
    /** Extra rows fetched so classes that already ended today don't eat into the requested count. */
    private static final int UPCOMING_OVERFETCH = 10;

    private final LiveSessionParticipantRepository liveSessionParticipantRepository;
    private final ObjectMapper objectMapper;

    public LearnerLiveSessionsResponseDTO getLearnerLiveSessions(String userId, String batchId, LocalDate start,
                                                                 LocalDate end) {
        if (start.isAfter(end)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "startDate must not be after endDate");
        }
        if (ChronoUnit.DAYS.between(start, end) > MAX_RANGE_DAYS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Date range is too long — pick at most " + MAX_RANGE_DAYS + " days");
        }

        Instant now = Instant.now();
        List<LearnerLiveClassDTO> classes = new ArrayList<>();
        int present = 0, absent = 0, unmarked = 0, scored = 0, timed = 0;
        long scoreSum = 0, durationSum = 0;

        for (LearnerLiveClassProjection p : liveSessionParticipantRepository.findLearnerLiveClasses(userId, blankToNull(batchId), start, end)) {
            ZoneId zone = zoneOf(p.getTimezone());
            // Only classes that have started: a class later today (or later in the range) has no
            // attendance to show yet and would read as a miss.
            if (p.getMeetingDate() == null || p.getStartTime() == null
                    || p.getMeetingDate().atTime(p.getStartTime()).atZone(zone).toInstant().isAfter(now)) {
                continue;
            }

            Integer meetingMinutes = meetingMinutes(p.getStartTime(), p.getLastEntryTime());
            LiveClassEngagementScore.Result score = LiveClassEngagementScore.compute(
                    p.getDurationMinutes(), meetingMinutes, p.getEngagementData(), objectMapper);
            Integer concentration = score.scorable() ? score.score() : null;

            String status = p.getAttendanceStatus();
            if ("PRESENT".equals(status)) present++;
            else if ("ABSENT".equals(status)) absent++;
            else unmarked++;

            if (concentration != null) {
                scored++;
                scoreSum += concentration;
            }
            if (p.getDurationMinutes() != null && p.getDurationMinutes() > 0) {
                timed++;
                durationSum += p.getDurationMinutes();
            }

            classes.add(LearnerLiveClassDTO.builder()
                    .scheduleId(p.getScheduleId())
                    .sessionId(p.getSessionId())
                    .title(p.getSessionTitle())
                    .subject(p.getSubject())
                    .meetingDate(p.getMeetingDate())
                    .startTime(p.getStartTime())
                    .lastEntryTime(p.getLastEntryTime())
                    .accessLevel(p.getAccessLevel())
                    .timezone(zone.getId())
                    .attendanceStatus(status)
                    .statusType(p.getStatusType())
                    .durationMinutes(p.getDurationMinutes())
                    .meetingDurationMinutes(meetingMinutes)
                    .concentrationScore(concentration)
                    .build());
        }

        classes.sort(Comparator.comparing(LearnerLiveClassDTO::getMeetingDate)
                .thenComparing(LearnerLiveClassDTO::getStartTime)
                .reversed());

        int total = classes.size();
        return LearnerLiveSessionsResponseDTO.builder()
                .userId(userId)
                .totalClasses(total)
                .presentCount(present)
                .absentCount(absent)
                .unmarkedCount(unmarked)
                .attendancePercentage(total == 0 ? 0.0 : round1(present * 100.0 / total))
                .avgConcentrationScore(scored == 0 ? null : round1((double) scoreSum / scored))
                .scoredClasses(scored)
                .avgDurationMinutes(timed == 0 ? null : round1((double) durationSum / timed))
                .classes(classes)
                .build();
    }

    public List<LearnerUpcomingClassDTO> getLearnerUpcomingClasses(String userId, String batchId, int limit) {
        int capped = Math.max(1, Math.min(limit, MAX_UPCOMING));
        Instant now = Instant.now();
        List<LearnerUpcomingClassDTO> result = new ArrayList<>();

        for (LearnerUpcomingClassProjection p :
                liveSessionParticipantRepository.findLearnerUpcomingClasses(userId, blankToNull(batchId),
                        capped + UPCOMING_OVERFETCH)) {
            if (p.getMeetingDate() == null || p.getStartTime() == null) continue;
            ZoneId zone = zoneOf(p.getTimezone());
            Instant startAt = p.getMeetingDate().atTime(p.getStartTime()).atZone(zone).toInstant();
            // A class with no last-entry time is treated as ending when it starts.
            Instant endAt = p.getLastEntryTime() == null ? startAt
                    : p.getMeetingDate().atTime(p.getLastEntryTime()).atZone(zone).toInstant();
            // Last entry before start means the class runs past midnight.
            if (endAt.isBefore(startAt)) endAt = endAt.plus(1, ChronoUnit.DAYS);
            if (!endAt.isAfter(now)) continue;

            result.add(LearnerUpcomingClassDTO.builder()
                    .scheduleId(p.getScheduleId())
                    .sessionId(p.getSessionId())
                    .title(p.getTitle())
                    .subject(p.getSubject())
                    .meetingDate(p.getMeetingDate())
                    .startTime(p.getStartTime())
                    .lastEntryTime(p.getLastEntryTime())
                    .accessLevel(p.getAccessLevel())
                    .timezone(zone.getId())
                    .meetingLink(p.getMeetingLink())
                    .live(!startAt.isAfter(now))
                    .build());
            if (result.size() >= capped) break;
        }
        return result;
    }

    private static ZoneId zoneOf(String raw) {
        try {
            return ZoneId.of(TimezoneNormalizer.normalize(raw));
        } catch (Exception e) {
            return ZoneId.of(TimezoneNormalizer.DEFAULT_TIMEZONE);
        }
    }

    /** Scheduled length (start → last entry), matching the workflow report's denominator. */
    private static Integer meetingMinutes(LocalTime start, LocalTime lastEntry) {
        if (start == null || lastEntry == null) return null;
        long mins = ChronoUnit.MINUTES.between(start, lastEntry);
        return mins > 0 ? (int) mins : null;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
