package vacademy.io.admin_core_service.features.classroom.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse.Instructor;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse.TodayClass;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionListDTO;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchResponse;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * Builds the classroom "today" list on top of the live-session search, so the caller's
 * role-based visibility and the batched enrichment apply exactly as they do on the web.
 *
 * <p>Times are computed here and sent ready to use, because a panel's own clock and time
 * zone data cannot be trusted.
 */
@Service
@Slf4j
public class ClassroomTodayService {

    public static final String SCOPE_MINE = "mine";
    public static final String SCOPE_ALL = "all";

    static final int MAX_CLASSES = 50;

    private static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter TIME_LABEL = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT);

    private final GetLiveSessionService liveSessionService;
    private final Clock clock;

    @Autowired
    public ClassroomTodayService(GetLiveSessionService liveSessionService) {
        this(liveSessionService, Clock.systemUTC());
    }

    ClassroomTodayService(GetLiveSessionService liveSessionService, Clock clock) {
        this.liveSessionService = liveSessionService;
        this.clock = clock;
    }

    public ClassroomTodayResponse today(String instituteId, String scope, CustomUserDetails user) {
        SessionSearchResponse found = liveSessionService.searchSessions(buildRequest(instituteId, scope, user), user);
        long now = clock.millis();

        List<LiveSessionListDTO> sessions = found.getSessions() != null ? found.getSessions() : List.of();
        List<TodayClass> classes = new ArrayList<>(sessions.size());
        for (LiveSessionListDTO session : sessions) {
            if (session.getMeetingDate() == null || session.getStartTime() == null) {
                log.warn("classroom.today.row_without_time scheduleId={}", session.getScheduleId());
                continue;
            }
            classes.add(toClass(session, now));
        }
        // The query orders by wall-clock time. Rows in different zones only line up on the instant.
        classes.sort(Comparator.comparingLong(TodayClass::getStartsAtMs)
                .thenComparing(TodayClass::getScheduleId, Comparator.nullsLast(Comparator.naturalOrder())));

        long total = found.getPagination() != null && found.getPagination().getTotalElements() != null
                ? found.getPagination().getTotalElements()
                : classes.size();
        return new ClassroomTodayResponse(now, classes, total > MAX_CLASSES);
    }

    static SessionSearchRequest buildRequest(String instituteId, String scope, CustomUserDetails user) {
        SessionSearchRequest request = new SessionSearchRequest();
        request.setInstituteId(instituteId);
        request.setPage(0);
        request.setSize(MAX_CLASSES);
        request.setSortBy("startTime");
        request.setSortDirection("ASC");
        request.setStatuses(List.of("LIVE"));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        if (!SCOPE_ALL.equalsIgnoreCase(scope)) {
            request.setInstructorUserIds(List.of(user.getUserId()));
        }
        return request;
    }

    private static TodayClass toClass(LiveSessionListDTO session, long now) {
        ZoneId zone = resolveZone(session.getTimezone());
        // java.sql.Date and Time carry a wall-clock value in the JVM zone. These conversions read
        // it back in that same zone, so the stored date and time survive whatever the JVM runs in.
        LocalDate date = new java.sql.Date(session.getMeetingDate().getTime()).toLocalDate();
        LocalTime startTime = session.getStartTime().toLocalTime();
        LocalDateTime startWallClock = date.atTime(startTime);
        ZonedDateTime start = startWallClock.atZone(zone);
        long startsAt = start.toInstant().toEpochMilli();

        Long endsAt = null;
        if (session.getLastEntryTime() != null) {
            LocalDateTime endWallClock = date.atTime(session.getLastEntryTime().toLocalTime());
            if (endWallClock.isBefore(startWallClock)) {
                endWallClock = endWallClock.plusDays(1);
            }
            endsAt = endWallClock.atZone(zone).toInstant().toEpochMilli();
        }

        return TodayClass.builder()
                .scheduleId(session.getScheduleId())
                .sessionId(session.getSessionId())
                .title(session.getTitle())
                .subject(session.getSubject())
                .batches(batchesOf(session))
                .meetingDate(date.toString())
                .startsAtMs(startsAt)
                .endsAtMs(endsAt)
                .timeLabel(start.format(TIME_LABEL))
                .timezone(session.getTimezone())
                .linkType(session.getLinkType())
                .streamingType(session.getSessionStreamingServiceType())
                .liveNow(startsAt <= now && (endsAt == null || endsAt > now))
                .instructors(instructorsOf(session))
                .externalLink(externalLinkOf(session))
                .build();
    }

    /**
     * Never throws. {@code ZoneId.of} refuses values Postgres accepts, such as {@code IST} or a
     * lower-case region, and one such row must not cost the teacher the whole list.
     */
    static ZoneId resolveZone(String timezone) {
        if (!StringUtils.hasText(timezone)) {
            return DEFAULT_ZONE;
        }
        String id = timezone.trim();
        try {
            return ZoneId.of(id);
        } catch (DateTimeException notARegion) {
            // tried below
        }
        try {
            return ZoneId.of(id.toUpperCase(Locale.ROOT), ZoneId.SHORT_IDS);
        } catch (DateTimeException notAnAbbreviation) {
            // tried below
        }
        for (String region : ZoneId.getAvailableZoneIds()) {
            if (region.equalsIgnoreCase(id)) {
                return ZoneId.of(region);
            }
        }
        log.warn("classroom.today.unknown_timezone timezone={}", id);
        return DEFAULT_ZONE;
    }

    /**
     * The meeting link is offered only when neither column names a hosted provider. Both are
     * checked because the two columns were historically swapped. It is the link learners get,
     * never a moderator link, and only http(s) is passed on to the device.
     */
    static String externalLinkOf(LiveSessionListDTO session) {
        if (isHostedProvider(session.getLinkType()) || isHostedProvider(session.getSessionStreamingServiceType())) {
            return null;
        }
        String link = session.getMeetingLink();
        if (!StringUtils.hasText(link)) {
            return null;
        }
        String trimmed = link.trim();
        String lower = trimmed.toLowerCase(Locale.ROOT);
        return lower.startsWith("https://") || lower.startsWith("http://") ? trimmed : null;
    }

    /** Matched loosely on purpose: a spelling we did not list must not count as external. */
    private static boolean isHostedProvider(String value) {
        if (value == null) {
            return false;
        }
        String v = value.toLowerCase(Locale.ROOT);
        return v.contains("bbb") || v.contains("zoom") || v.contains("meet") || v.contains("zoho");
    }

    private static List<String> batchesOf(LiveSessionListDTO session) {
        if (session.getPackageSessionDetails() == null) {
            return List.of();
        }
        return session.getPackageSessionDetails().stream()
                .map(d -> (Objects.toString(d.getLevelName(), "") + " " + Objects.toString(d.getPackageName(), "")).trim())
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
    }

    /** Only the id and name: the search enrichment also carries contact details. */
    private static List<Instructor> instructorsOf(LiveSessionListDTO session) {
        if (session.getInstructors() == null) {
            return List.of();
        }
        return session.getInstructors().stream()
                .map(i -> new Instructor(i.getUserId(), i.getFullName()))
                .toList();
    }
}
