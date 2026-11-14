package vacademy.io.admin_core_service.features.reporting.sections;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Classroom panels: how much the institute's interactive panels were used.
 *
 * <h3>Where the numbers come from</h3>
 * Panel sessions live in auth_service, so this is one HMAC call per document to
 * {@code /auth-service/internal/panel/v1/usage-summary}, the same bounded
 * exception to the SPI's "SQL only" rule that {@link AssessmentsSection} makes. A
 * failed call THROWS: "auth_service was unreachable" must never render as "the
 * panels were not used". A 404 from auth (its usage feature switched off) drops
 * the section, as {@code classroom.report.enabled=false} does here.
 *
 * <p>The bean exists only while {@code classroom.report.enabled} is true, so with
 * the switch off the section is not listed or offered anywhere.
 *
 * <h3>What is counted</h3>
 * Panel hours are computed by auth from signed-in panel sessions, each ending at
 * the earliest of its recorded end, the panel's last check-in plus a short
 * margin, and (for idle sign-outs) the moment it went idle. An idle room is an
 * active room with a working panel and no session in the window. See
 * auth_service's panel usage service for the full definitions.
 *
 * <h3>Rows</h3>
 * Least-used rooms first, then idle rooms. The runner keeps 25 rows and trims
 * from the END, and the idle rooms are the finding an admin acts on, so the
 * lists are sized to fit whole: 12 rooms + 10 idle rooms + 2 notes declaring
 * each cut + 1 link line.
 */
@Component
@ConditionalOnProperty(name = "classroom.report.enabled", havingValue = "true")
@Slf4j
public class ClassroomPanelsSection implements ReportSection {

    static final String KEY = "classroom_panels";

    /** Rooms listed individually, least used first. */
    static final int MAX_ROOM_ROWS = 12;
    /** Idle rooms listed individually. */
    static final int MAX_IDLE_ROWS = 10;

    static final String H_HOURS = "Panel hours";
    static final String H_ROOMS = "Rooms used";
    static final String H_TEACHERS = "Teachers";
    static final String H_IDLE = "Idle rooms";

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private final ClassroomPanelReportClient client;
    private final boolean enabled;
    private final String consoleBaseUrl;

    @Autowired
    public ClassroomPanelsSection(
            ClassroomPanelReportClient client,
            @Value("${classroom.report.enabled:false}") boolean enabled,
            @Value("${classroom.console.base-url:https://dash.vacademy.io}") String consoleBaseUrl) {
        this.client = client;
        this.enabled = enabled;
        this.consoleBaseUrl = consoleBaseUrl;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String title() {
        return "Classroom panels";
    }

    @Override
    public String description() {
        return "Panel hours, rooms used and rooms whose panel was not used in the period.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN");
    }

    @Override
    public boolean identifying() {
        // Rooms and counts only. No learner is ever named.
        return false;
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // Panels belong to the institute; there is no batch dimension.
        return Set.of(ReportContext.ScopeType.INSTITUTE);
    }

    @Override
    public boolean isAvailableFor(String instituteId) {
        if (!enabled) return false;
        // A failed probe answers false: the section is simply not offered until
        // auth can be asked. It never claims the institute has no panels.
        Boolean has = client.hasPanels(instituteId);
        return Boolean.TRUE.equals(has);
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        // Switched off on purpose (not a failed lookup): drop the section from the
        // document instead of failing the whole report for schedules that still
        // list it.
        if (!enabled || ctx.namingRestricted() || ctx.cohortRestricted()) {
            return emptyFacts();
        }

        ZoneId zone = ctx.getZone() == null ? ZoneOffset.UTC : ctx.getZone();
        LocalDate from = LocalDate.ofInstant(ctx.getWindowStart(), zone);
        // windowEnd is exclusive; the endpoint takes inclusive local dates.
        LocalDate to = LocalDate.ofInstant(ctx.getWindowEnd().minusMillis(1), zone);
        if (to.isBefore(from)) to = from;

        ClassroomPanelReportClient.UsageResult result =
                client.usageSummary(ctx.getInstituteId(), from, to, zone.getId());
        if (result != null && result.status() == ClassroomPanelReportClient.Status.FEATURE_OFF) {
            // auth's usage feature is switched off: the same as admin_core's own switch.
            return emptyFacts();
        }
        JsonNode s = result == null || result.status() != ClassroomPanelReportClient.Status.OK ? null
                : result.body();
        if (s == null || !s.path("totals").isObject()) {
            throw new IllegalStateException(
                    "classroom panel usage unavailable for institute " + ctx.getInstituteId());
        }
        return build(s, zone);
    }

    SectionFacts build(JsonNode s, ZoneId zone) {
        JsonNode t = s.path("totals");
        double hours = t.path("panel_hours").asDouble(0);
        int sessions = t.path("sessions").asInt(0);
        int teachers = t.path("teachers").asInt(0);
        int roomsUsed = t.path("rooms_used").asInt(0);
        int roomsWithPanel = t.path("rooms_with_panel").asInt(0);
        JsonNode idleList = s.path("idle_rooms");
        int idleCount = Math.max(t.path("idle_rooms").asInt(0), idleList.size());

        boolean empty = sessions == 0 && idleCount == 0;

        Set<String> idleIds = new HashSet<>();
        for (JsonNode r : idleList) {
            String id = r.path("room").path("id").asText("");
            if (!id.isEmpty()) idleIds.add(id);
        }

        List<SectionFacts.Row> rows = new ArrayList<>();
        int roomsListed = 0;
        int roomsAvailable = 0;
        for (JsonNode r : s.path("by_room")) {
            if (idleIds.contains(r.path("room").path("id").asText(""))) continue;
            roomsAvailable++;
            if (roomsListed >= MAX_ROOM_ROWS) continue;
            roomsListed++;
            rows.add(row(roomName(r), hoursText(r.path("panel_hours").asDouble(0)),
                    String.valueOf(r.path("sessions").asInt(0)),
                    String.valueOf(r.path("teachers").asInt(0)),
                    lastUsed(r.path("last_used_at"), zone)));
        }
        // by_room arrives capped, so the true count of used rooms is the total.
        int roomsHidden = Math.max(roomsAvailable, roomsUsed) - roomsListed;
        if (roomsHidden > 0) {
            rows.add(note(roomsHidden + " more room" + (roomsHidden == 1 ? "" : "s")
                    + " used more than these not shown"));
        }

        int idleListed = 0;
        for (JsonNode r : idleList) {
            if (idleListed >= MAX_IDLE_ROWS) break;
            idleListed++;
            rows.add(row(roomName(r) + " (not used)", "0", "0", "0",
                    lastUsed(r.path("last_used_at"), zone)));
        }
        int idleHidden = idleCount - idleListed;
        if (idleHidden > 0) {
            rows.add(note(idleHidden + " more idle room" + (idleHidden == 1 ? "" : "s") + " not shown"));
        }

        String link = consoleLink();
        if (!empty && link != null) {
            rows.add(note("Full usage report: " + link));
        }

        return SectionFacts.builder()
                .sectionKey(KEY)
                .title(title())
                .identifying(false)
                .empty(empty)
                .headline(H_HOURS, hoursText(hours))
                .headline(H_ROOMS, roomsUsed + " of " + roomsWithPanel)
                .headline(H_TEACHERS, String.valueOf(teachers))
                .headline(H_IDLE, String.valueOf(idleCount))
                .tone(H_IDLE, idleCount > 0 ? "warn" : "good")
                .column("Room")
                .column("Hours")
                .column("Sessions")
                .column("Teachers")
                .column("Last used")
                .rows(rows)
                .build();
    }

    String consoleLink() {
        if (consoleBaseUrl == null || consoleBaseUrl.isBlank()) return null;
        String base = consoleBaseUrl.trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + "/settings?selectedTab=classroomPanels&view=usage";
    }

    private SectionFacts emptyFacts() {
        return SectionFacts.builder()
                .sectionKey(KEY).title(title()).identifying(false).empty(true)
                .build();
    }

    private static SectionFacts.Row row(String... values) {
        SectionFacts.Row.RowBuilder b = SectionFacts.Row.builder();
        for (String v : values) b.value(v);
        return b.build();
    }

    /** A row that carries a remark rather than a room. */
    private static SectionFacts.Row note(String text) {
        return row(text, "", "", "", "");
    }

    private static String roomName(JsonNode r) {
        String name = r.path("room").path("name").asText("").trim();
        return name.isEmpty() ? "(unnamed room)" : name;
    }

    /** One decimal place, without a trailing ".0". */
    static String hoursText(double hours) {
        if (Double.isNaN(hours) || Double.isInfinite(hours) || hours < 0) hours = 0;
        BigDecimal d = BigDecimal.valueOf(hours).setScale(1, RoundingMode.HALF_UP).stripTrailingZeros();
        return d.scale() < 0 ? d.setScale(0).toPlainString() : d.toPlainString();
    }

    /** Local day in the report's zone, or "never" when the room has no session on record. */
    static String lastUsed(JsonNode at, ZoneId zone) {
        if (at == null || at.isNull() || at.isMissingNode()) return "never";
        String raw = at.asText("").trim();
        if (raw.isEmpty()) return "never";
        Instant instant;
        try {
            instant = Instant.parse(raw);
        } catch (Exception e) {
            try {
                // auth's timestamps are UTC without an offset when written from a
                // plain timestamp column.
                instant = LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC);
            } catch (Exception e2) {
                return "—";
            }
        }
        return DAY.format(instant.atZone(zone));
    }
}
