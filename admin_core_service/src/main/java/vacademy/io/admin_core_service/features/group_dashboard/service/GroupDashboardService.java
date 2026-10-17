package vacademy.io.admin_core_service.features.group_dashboard.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.common.exceptions.VacademyException;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Group dashboards for admins: Contacts, Automations and Engagement.
 *
 * <p>Same load rules as the CRM Dashboard: each section runs in its own read-only
 * transaction (replica) with a statement timeout, aggregates in SQL, and is cached
 * per institute and window for {@link #CACHE_TTL}, so a page load costs one round of
 * queries per institute every few minutes at most. A failed section is named in
 * {@code errors} instead of failing the page.
 */
@Slf4j
@Service
public class GroupDashboardService {

    static final Set<String> GROUPS = Set.of("contacts", "automations", "engagement");
    static final Set<Integer> RANGES = Set.of(7, 30, 90);
    static final Duration CACHE_TTL = Duration.ofMinutes(3);
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";

    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final Cache<String, Object> cache = Caffeine.newBuilder()
            .expireAfterWrite(CACHE_TTL)
            .maximumSize(1_000)
            .build();

    public GroupDashboardService(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
    }

    public Map<String, Object> getDashboard(String group, String instituteId, Integer days, String timezone) {
        String g = group == null ? "" : group.trim().toLowerCase();
        if (!GROUPS.contains(g)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown dashboard: " + group);
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        Window w = window(days, timezone, Instant.now());
        Map<String, Object> sections = new LinkedHashMap<>();
        Map<String, String> errors = new LinkedHashMap<>();
        for (String section : sectionsOf(g)) {
            String key = String.join("|", instituteId, g, section, String.valueOf(w.days()), w.tz().getId(),
                    w.toDay().toString());
            try {
                Object value = cache.get(key, k -> compute(g, section, params(instituteId, w)));
                if (value != null) sections.put(section, value);
            } catch (Exception e) {
                log.warn("[GroupDashboard] {}.{} failed for institute {}: {}", g, section, instituteId, e.getMessage());
                errors.put(section, "unavailable");
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("group", g);
        out.put("days", w.days());
        out.put("from_day", w.fromDay().toString());
        out.put("to_day", w.toDay().toString());
        out.put("sections", sections);
        out.put("errors", errors);
        out.put("generated_at", Instant.now().toString());
        return out;
    }

    static List<String> sectionsOf(String group) {
        return switch (group) {
            case "contacts" -> List.of("summary", "daily", "tags");
            case "automations" -> List.of("totals", "daily", "workflows");
            default -> List.of("totals", "daily", "engines");
        };
    }

    private Object compute(String group, String section, MapSqlParameterSource p) {
        String sql = switch (group + "." + section) {
            case "contacts.summary" -> GroupDashboardSql.CONTACTS_SUMMARY;
            case "contacts.daily" -> GroupDashboardSql.CONTACTS_DAILY;
            case "contacts.tags" -> GroupDashboardSql.CONTACTS_TAGS;
            case "automations.totals" -> GroupDashboardSql.WF_TOTALS;
            case "automations.daily" -> GroupDashboardSql.WF_DAILY;
            case "automations.workflows" -> GroupDashboardSql.WF_PER_WORKFLOW;
            case "engagement.totals" -> GroupDashboardSql.ENG_TOTALS;
            case "engagement.daily" -> GroupDashboardSql.ENG_DAILY;
            case "engagement.engines" -> GroupDashboardSql.ENG_ENGINES;
            default -> throw new IllegalArgumentException(section);
        };
        boolean single = section.equals("summary") || section.equals("totals");
        return inTx(() -> {
            List<Map<String, Object>> rows = jdbc.queryForList(sql, p);
            if (single) return rows.isEmpty() ? Map.of() : rows.get(0);
            return rows;
        });
    }

    // ── window ───────────────────────────────────────────────────────────────

    record Window(int days, ZoneId tz, LocalDate fromDay, LocalDate toDay,
                  LocalDateTime from, LocalDateTime to, LocalDateTime prevFrom, LocalDateTime dayAgo) {
    }

    /** The last {@code days} calendar days in the user's zone, today included; the previous window has the same length. */
    static Window window(Integer days, String timezone, Instant now) {
        int d = days != null && RANGES.contains(days) ? days : 30;
        ZoneId tz = zone(timezone);
        LocalDate toDay = now.atZone(tz).toLocalDate();
        LocalDate fromDay = toDay.minusDays(d - 1L);
        Instant from = fromDay.atStartOfDay(tz).toInstant();
        Instant to = toDay.plusDays(1).atStartOfDay(tz).toInstant();
        Instant prevFrom = from.minus(Duration.between(from, to));
        return new Window(d, tz, fromDay, toDay, utc(from), utc(to), utc(prevFrom),
                utc(now.minus(1, ChronoUnit.DAYS)));
    }

    private static ZoneId zone(String tz) {
        if (tz == null || tz.isBlank()) return ZoneId.of("Asia/Kolkata");
        try {
            return ZoneId.of(tz.trim());
        } catch (DateTimeException e) {
            return ZoneId.of("Asia/Kolkata");
        }
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static MapSqlParameterSource params(String instituteId, Window w) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", w.tz().getId())
                .addValue("from", w.from(), java.sql.Types.TIMESTAMP)
                .addValue("to", w.to(), java.sql.Types.TIMESTAMP)
                .addValue("prevFrom", w.prevFrom(), java.sql.Types.TIMESTAMP)
                .addValue("dayAgo", w.dayAgo(), java.sql.Types.TIMESTAMP)
                .addValue("fromDay", w.fromDay().toString())
                .addValue("toDay", w.toDay().toString());
    }

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }
}
