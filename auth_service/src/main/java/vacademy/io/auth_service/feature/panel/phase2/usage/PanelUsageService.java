package vacademy.io.auth_service.feature.panel.phase2.usage;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.HasPanelsResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.InternalInstituteRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.InternalInstitutesResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.RoomRef;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageContent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageDay;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageIdleRoom;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageMultiRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageNotes;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageRoom;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionEvent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageSessionsResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageTeacher;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageTotals;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UserRef;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Errors;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.ContentFact;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.EventFact;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.InstituteFact;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.LivePanel;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.SessionFact;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;
import vacademy.io.auth_service.feature.panel.service.PanelTimers;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * The usage report of an institute's classroom panels (see {@link PanelUsageMath} for what is
 * counted). Read-only, computed from panel_session and panel_activity on request, no rollup table.
 *
 * <p>Every admin read checks first that the caller is an ACTIVE ADMIN of the institute it names,
 * inside the same transaction as the reads, and every query filters on that institute. Nothing here
 * makes an HTTP call. With panel.usage.enabled off every endpoint answers 404 FEATURE_OFF before it
 * reads anything.
 *
 * <p>A full report is cached for {@link #CACHE_TTL} per (institute, from, to, zone). The cache is
 * consulted only after the caller has been authorised.
 */
@Service
public class PanelUsageService {

    private static final Logger log = LoggerFactory.getLogger(PanelUsageService.class);

    static final Duration CACHE_TTL = Duration.ofMinutes(5);
    static final int CACHE_ENTRIES = 2000;
    static final int CONTENT_TOP = 20;
    static final int TEACHER_CONTENT_TOP = 3;
    static final int MULTI_MAX = 50;
    static final int PAGE_SIZE_DEFAULT = 50;
    static final int PAGE_SIZE_MAX = 200;
    static final int MAX_PAGE = 10_000;
    static final int ID_MAX_LENGTH = 255;
    static final int INSTITUTES_PAGE = 500;
    /** Longest a single report statement may run. */
    static final int STATEMENT_SECONDS = 15;
    /** PostgreSQL's SQLState for a statement cancelled by statement_timeout. */
    static final String QUERY_CANCELED = "57014";

    /** Caps of the internal summary, which feeds a short weekly email. */
    static final int SUMMARY_ROOMS = 15;
    static final int SUMMARY_IDLE_ROOMS = 10;
    static final int SUMMARY_TEACHERS = 10;
    static final int SUMMARY_CONTENT = 5;

    static final String CLASS = "CLASS";

    private final PanelUsageRepository repository;
    private final InstituteOAuthClientAccessGuard accessGuard;
    private final PanelTx tx;
    private final PanelPhase2Properties phase2;
    private final PanelProperties properties;
    private final Cache<ReportKey, UsageResponse> cache;

    @Autowired
    public PanelUsageService(PanelUsageRepository repository, InstituteOAuthClientAccessGuard accessGuard, PanelTx tx,
            PanelPhase2Properties phase2, PanelProperties properties) {
        this.repository = repository;
        this.accessGuard = accessGuard;
        this.tx = tx;
        this.phase2 = phase2;
        this.properties = properties;
        this.cache = Caffeine.newBuilder().expireAfterWrite(CACHE_TTL).maximumSize(CACHE_ENTRIES).build();
    }

    record ReportKey(String instituteId, LocalDate from, LocalDate to, ZoneId zone) {
    }

    /** A validated report window. */
    record Window(LocalDate from, LocalDate to, ZoneId zone, long startMs, long endMs) {
    }

    // ------------------------------------------------------------ requests ---

    /** GET /admin/usage. */
    public UsageResponse usage(CustomUserDetails user, String instituteId, String from, String to, String tz) {
        phase2.requireUsage();
        Window window = window(from, to, tz);
        return reportTx(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            return cachedReport(instituteId, window);
        });
    }

    /** GET /admin/usage/sessions: the drill-down and the CSV source, newest first. */
    public UsageSessionsResponse sessions(CustomUserDetails user, String instituteId, String from, String to,
            String tz, String roomId, String userId, Integer page, Integer size) {
        phase2.requireUsage();
        Window window = window(from, to, tz);
        String room = optionalId(roomId, "room_id");
        String teacher = optionalId(userId, "user_id");
        int pageNo = page == null ? 0 : page;
        int pageSize = size == null ? PAGE_SIZE_DEFAULT : size;
        if (pageNo < 0 || pageNo > MAX_PAGE) {
            throw PanelApiException.badRequest("page is out of range");
        }
        if (pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
            throw PanelApiException.badRequest("size must be between 1 and " + PAGE_SIZE_MAX);
        }
        return reportTx(() -> {
            accessGuard.requireInstituteAdmin(user, instituteId);
            repository.limitStatementTime(STATEMENT_SECONDS);
            long now = repository.nowMs();
            long total = repository.countSessions(instituteId, window.startMs(), window.endMs(), room, teacher);
            List<SessionFact> rows = repository.sessionPage(instituteId, window.startMs(), window.endMs(), room,
                    teacher, pageSize, (long) pageNo * pageSize);
            Map<String, List<PanelUsageMath.Event>> events = new HashMap<>();
            for (EventFact e : repository.events(instituteId, rows.stream().map(SessionFact::id).toList())) {
                events.computeIfAbsent(e.sessionId(), k -> new ArrayList<>())
                        .add(new PanelUsageMath.Event(e.seq(), e.kind(), e.title(), e.startedMs()));
            }
            List<UsageSessionRow> out = new ArrayList<>();
            for (SessionFact s : rows) {
                long end = endOf(s, now, window.endMs());
                List<UsageSessionEvent> timed = PanelUsageMath.durations(events.getOrDefault(s.id(), List.of()), end)
                        .stream()
                        .map(t -> new UsageSessionEvent(t.event().kind(), t.event().title(),
                                iso(t.event().startedMs()), PanelUsageMath.minutes(t.durationMs())))
                        .toList();
                out.add(new UsageSessionRow(s.id(), new RoomRef(s.roomId(), s.roomName()),
                        new UserRef(s.userId(), s.userName()), iso(s.createdMs()), iso(end),
                        PanelUsageMath.minutes(end - s.createdMs()), s.endReason(), s.startedVia(), timed));
            }
            return new UsageSessionsResponse(out, pageNo, pageSize, total);
        });
    }

    /**
     * GET /admin/usage/multi: totals for several institutes. The caller must be ADMIN of every one;
     * all of them are checked before any report is read.
     */
    public List<UsageMultiRow> multi(CustomUserDetails user, String instituteIds, String from, String to, String tz) {
        phase2.requireUsage();
        Window window = window(from, to, tz);
        List<String> ids = instituteIds == null ? List.of()
                : Arrays.stream(instituteIds.split(",")).map(String::trim).filter(id -> !id.isEmpty()).distinct()
                        .toList();
        if (ids.isEmpty()) {
            throw PanelApiException.badRequest("institute_ids is required");
        }
        if (ids.size() > MULTI_MAX) {
            throw PanelApiException.badRequest("At most " + MULTI_MAX + " institutes at a time");
        }
        tx.run(() -> {
            for (String id : ids) {
                accessGuard.requireInstituteAdmin(user, id);
            }
            return null;
        });
        List<UsageMultiRow> rows = new ArrayList<>();
        for (String id : ids) {
            rows.add(new UsageMultiRow(id, reportTx(() -> cachedReport(id, window)).totals()));
        }
        return rows;
    }

    /**
     * Internal /usage-summary for the weekly email: the report with short lists. Rooms are sorted
     * least used first, because those are the ones worth a look.
     */
    public UsageResponse summary(String instituteId, String from, String to, String tz) {
        phase2.requireUsage();
        requireId(instituteId, "institute_id");
        Window window = window(from, to, tz);
        UsageResponse full = reportTx(() -> cachedReport(instituteId, window));
        List<UsageRoom> rooms = full.byRoom().stream()
                .sorted(Comparator.comparingDouble(UsageRoom::panelHours).thenComparing(r -> nameOf(r.room())))
                .limit(SUMMARY_ROOMS).toList();
        return new UsageResponse(full.instituteId(), full.from(), full.to(), full.tz(), full.generatedAt(),
                full.totals(), full.byDay(), rooms, full.byTeacher().stream().limit(SUMMARY_TEACHERS).toList(),
                full.idleRooms().stream().limit(SUMMARY_IDLE_ROOMS).toList(),
                full.content().stream().limit(SUMMARY_CONTENT).toList(), full.notes());
    }

    /** Internal /institutes: institutes that have a live panel, 500 a page. */
    public InternalInstitutesResponse institutes(Integer page) {
        requireUsageOrFleet();
        int pageNo = page == null ? 0 : page;
        if (pageNo < 0 || pageNo > MAX_PAGE) {
            throw PanelApiException.badRequest("page is out of range");
        }
        List<InstituteFact> rows = repository.institutesWithPanels(INSTITUTES_PAGE + 1, (long) pageNo * INSTITUTES_PAGE);
        boolean more = rows.size() > INSTITUTES_PAGE;
        List<InternalInstituteRow> out = rows.stream().limit(INSTITUTES_PAGE)
                .map(r -> new InternalInstituteRow(r.instituteId(), r.roomsWithPanel(), r.devices(),
                        r.firstPairedMs() == null ? null : iso(r.firstPairedMs())))
                .toList();
        return new InternalInstitutesResponse(out, pageNo, more);
    }

    /** Internal /has-panels. */
    public HasPanelsResponse hasPanels(String instituteId) {
        requireUsageOrFleet();
        requireId(instituteId, "institute_id");
        return new HasPanelsResponse(repository.hasLivePanels(instituteId));
    }

    /** The two internal listing endpoints serve both the weekly report and the fleet alerts. */
    private void requireUsageOrFleet() {
        if (!phase2.isUsageEnabled() && !phase2.isFleetEnabled()) {
            throw PanelPhase2Errors.featureOff();
        }
    }

    // ---------------------------------------------------------- validation ---

    Window window(String from, String to, String tz) {
        if (from == null || to == null) {
            throw PanelApiException.badRequest("from and to are required");
        }
        LocalDate start;
        LocalDate end;
        try {
            start = LocalDate.parse(from.trim());
            end = LocalDate.parse(to.trim());
        } catch (DateTimeParseException e) {
            throw PanelApiException.badRequest("from and to must be dates like 2026-11-01");
        }
        if (end.isBefore(start)) {
            throw PanelApiException.badRequest("to must not be before from");
        }
        if (ChronoUnit.DAYS.between(start, end) + 1 > phase2.getUsageMaxDays()) {
            throw PanelApiException.badRequest("At most " + phase2.getUsageMaxDays() + " days at a time");
        }
        ZoneId zone = PanelUsageMath.zoneOf(tz);
        long[] bounds = PanelUsageMath.window(start, end, zone);
        return new Window(start, end, zone, bounds[0], bounds[1]);
    }

    private static void requireId(String id, String name) {
        if (id == null || id.isBlank() || id.length() > ID_MAX_LENGTH || PanelSecrets.hasControlChars(id)) {
            throw PanelApiException.badRequest(name + " is required");
        }
    }

    private static String optionalId(String id, String name) {
        if (id == null || id.isBlank()) {
            return null;
        }
        if (id.length() > ID_MAX_LENGTH || PanelSecrets.hasControlChars(id)) {
            throw PanelApiException.badRequest("Invalid " + name);
        }
        return id;
    }

    // -------------------------------------------------------------- report ---

    /** Call inside a transaction, after authorisation. */
    /**
     * A report transaction. A statement that ran into the report statement limit answers 503 BUSY,
     * like a database that cannot be reached, instead of a generic error.
     */
    private <T> T reportTx(Supplier<T> work) {
        try {
            return tx.run(work);
        } catch (RuntimeException e) {
            if (statementTimedOut(e)) {
                log.warn("Panel usage report hit the statement limit of {} s", STATEMENT_SECONDS);
                throw PanelApiException.busy(HttpStatus.SERVICE_UNAVAILABLE);
            }
            throw e;
        }
    }

    /** A cancelled statement (SQLState 57014) or a query timeout anywhere in the cause chain. */
    static boolean statementTimedOut(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof QueryTimeoutException) {
                return true;
            }
            if (t instanceof SQLException sql && QUERY_CANCELED.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private UsageResponse cachedReport(String instituteId, Window window) {
        ReportKey key = new ReportKey(instituteId, window.from(), window.to(), window.zone());
        return cache.get(key, k -> report(instituteId, window));
    }

    UsageResponse report(String instituteId, Window window) {
        repository.limitStatementTime(STATEMENT_SECONDS);
        long now = repository.nowMs();
        List<SessionFact> sessions = repository.sessions(instituteId, window.startMs(), window.endMs());
        List<ContentFact> content = repository.content(instituteId, window.startMs(), window.endMs(),
                Math.max(1, properties.getSessionHours()) + 1);
        List<LivePanel> panels = repository.livePanels(instituteId);
        Long recordedFrom = repository.contentRecordedFromMs(instituteId);
        return assemble(instituteId, window, now, sessions, content, panels, recordedFrom);
    }

    /** The report from its raw rows. Pure, so the unit tests can feed it rows directly. */
    static UsageResponse assemble(String instituteId, Window window, long now, List<SessionFact> sessions,
            List<ContentFact> content, List<LivePanel> panels, Long recordedFromMs) {
        ZoneId zone = window.zone();

        long totalMs = 0;
        int withEvents = 0;
        Set<String> teachers = new HashSet<>();
        Set<String> roomsUsed = new HashSet<>();
        Map<LocalDate, DayAcc> days = new LinkedHashMap<>();
        for (LocalDate d = window.from(); !d.isAfter(window.to()); d = d.plusDays(1)) {
            days.put(d, new DayAcc());
        }
        Map<String, RoomAcc> rooms = new HashMap<>();
        Map<String, TeacherAcc> byTeacher = new HashMap<>();

        for (SessionFact s : sessions) {
            long ms = endOf(s, now, window.endMs()) - s.createdMs();
            LocalDate date = PanelUsageMath.localDate(s.createdMs(), zone);
            totalMs += ms;
            if (s.hasEvents()) {
                withEvents++;
            }
            teachers.add(s.userId());
            roomsUsed.add(s.roomId());

            DayAcc day = days.computeIfAbsent(date, k -> new DayAcc());
            day.ms += ms;
            day.sessions++;
            day.rooms.add(s.roomId());

            RoomAcc room = rooms.computeIfAbsent(s.roomId(), k -> new RoomAcc(s.roomId(), s.roomName()));
            room.ms += ms;
            room.sessions++;
            room.users.add(s.userId());
            room.days.add(date);
            room.lastStartMs = Math.max(room.lastStartMs, s.createdMs());

            TeacherAcc teacher = byTeacher.computeIfAbsent(s.userId(), k -> new TeacherAcc(s.userId(), s.userName()));
            teacher.ms += ms;
            teacher.sessions++;
            teacher.rooms.add(s.roomId());
            teacher.days.add(date);
        }

        // Content: rows are per teacher and item; an item's sessions add up because a session has one teacher.
        Map<List<String>, ContentAcc> items = new LinkedHashMap<>();
        Map<String, List<ContentFact>> contentByTeacher = new HashMap<>();
        int classesStarted = 0;
        for (ContentFact c : content) {
            List<String> itemKey = Arrays.asList(c.kind(), c.refId(), c.refId() == null ? c.title() : null);
            ContentAcc item = items.computeIfAbsent(itemKey, k -> new ContentAcc(c.kind(), c.refId()));
            item.ms += c.durationMs();
            item.sessions += c.sessions();
            item.teachers.add(c.userId());
            if (c.lastMs() >= item.lastMs) {
                item.lastMs = c.lastMs();
                item.title = c.title();
            }
            contentByTeacher.computeIfAbsent(c.userId(), k -> new ArrayList<>()).add(c);
            if (CLASS.equals(c.kind())) {
                classesStarted += c.events();
            }
        }

        Set<String> panelRooms = new HashSet<>();
        List<UsageIdleRoom> idle = new ArrayList<>();
        for (LivePanel p : panels) {
            if (!panelRooms.add(p.roomId())) {
                continue;
            }
            if (!roomsUsed.contains(p.roomId())) {
                boolean online = p.lastSeenMs() != null && now - p.lastSeenMs() < PanelTimers.DEVICE_ONLINE_MS;
                idle.add(new UsageIdleRoom(new RoomRef(p.roomId(), p.roomName()), p.deviceId(),
                        p.lastUsedMs() == null ? null : iso(p.lastUsedMs()), online));
            }
        }

        UsageTotals totals = new UsageTotals(PanelUsageMath.hours(totalMs), sessions.size(), teachers.size(),
                roomsUsed.size(), panelRooms.size(), idle.size(), classesStarted,
                PanelUsageMath.coveragePct(withEvents, sessions.size()));

        List<UsageDay> byDay = days.entrySet().stream()
                .filter(e -> !e.getKey().isBefore(window.from()) && !e.getKey().isAfter(window.to()))
                .map(e -> new UsageDay(e.getKey().toString(), PanelUsageMath.hours(e.getValue().ms),
                        e.getValue().sessions, e.getValue().rooms.size()))
                .toList();

        List<UsageRoom> byRoom = rooms.values().stream()
                .sorted(Comparator.comparingLong((RoomAcc r) -> -r.ms).thenComparing(r -> lower(r.name)))
                .map(r -> new UsageRoom(new RoomRef(r.id, r.name), PanelUsageMath.hours(r.ms), r.sessions,
                        r.users.size(), iso(r.lastStartMs), r.days.size()))
                .toList();

        List<UsageTeacher> teacherRows = byTeacher.values().stream()
                .sorted(Comparator.comparingLong((TeacherAcc t) -> -t.ms).thenComparing(t -> lower(t.name)))
                .map(t -> new UsageTeacher(new UserRef(t.id, t.name), PanelUsageMath.hours(t.ms), t.sessions,
                        t.rooms.size(), t.days.size(), topContent(contentByTeacher.getOrDefault(t.id, List.of()))))
                .toList();

        List<UsageContent> contentRows = items.values().stream()
                .sorted(Comparator.comparingLong((ContentAcc c) -> -c.ms).thenComparing(c -> lower(c.title)))
                .limit(CONTENT_TOP)
                .map(c -> new UsageContent(c.kind, c.refId, c.title, PanelUsageMath.minutes(c.ms), c.sessions,
                        c.teachers.size()))
                .toList();

        String recordedFrom = recordedFromMs == null ? null
                : PanelUsageMath.localDate(recordedFromMs, zone).toString();

        return new UsageResponse(instituteId, window.from().toString(), window.to().toString(), zone.getId(),
                iso(now), totals, byDay, byRoom, teacherRows, idle, contentRows, new UsageNotes(recordedFrom));
    }

    private static List<UsageContent> topContent(List<ContentFact> rows) {
        return rows.stream()
                .sorted(Comparator.comparingLong((ContentFact c) -> -c.durationMs()).thenComparing(c -> lower(c.title())))
                .limit(TEACHER_CONTENT_TOP)
                .map(c -> new UsageContent(c.kind(), null, c.title(), PanelUsageMath.minutes(c.durationMs()), null,
                        null))
                .toList();
    }

    private static long endOf(SessionFact s, long now, long windowEndMs) {
        return PanelUsageMath.clippedEnd(s.createdMs(), s.endedMs(), s.panelSeenMs(), s.activeUntilMs(),
                s.expiresMs(), now, windowEndMs);
    }

    private static String iso(long epochMs) {
        return Instant.ofEpochMilli(epochMs).toString();
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase();
    }

    private static String nameOf(RoomRef room) {
        return room == null ? "" : lower(room.name());
    }

    private static final class DayAcc {
        long ms;
        int sessions;
        final Set<String> rooms = new HashSet<>();
    }

    private static final class RoomAcc {
        final String id;
        final String name;
        long ms;
        int sessions;
        long lastStartMs = Long.MIN_VALUE;
        final Set<String> users = new HashSet<>();
        final Set<LocalDate> days = new HashSet<>();

        RoomAcc(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    private static final class TeacherAcc {
        final String id;
        final String name;
        long ms;
        int sessions;
        final Set<String> rooms = new HashSet<>();
        final Set<LocalDate> days = new HashSet<>();

        TeacherAcc(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    private static final class ContentAcc {
        final String kind;
        final String refId;
        String title;
        long ms;
        int sessions;
        long lastMs = Long.MIN_VALUE;
        final Set<String> teachers = new HashSet<>();

        ContentAcc(String kind, String refId) {
            this.kind = kind;
            this.refId = refId;
        }
    }

    /** For tests: drop every cached report. */
    void clearCache() {
        cache.invalidateAll();
    }
}
