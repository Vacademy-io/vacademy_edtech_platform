package vacademy.io.admin_core_service.features.crm_dashboard.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.audience.dto.LeadFilterDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadVisibility;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.audience.service.LeadVisibilityResolver;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardRequestDTO;
import vacademy.io.admin_core_service.features.crm_dashboard.dto.CrmDashboardResponseDTO;
import vacademy.io.admin_core_service.features.live_session.util.TimezoneNormalizer;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * CRM Dashboard — one request, only the blocks the page will draw.
 *
 * <p>Load rules (the dashboard must never make the CRM slower):
 * <ul>
 *   <li>Every block runs in its own read-only transaction, so it reads from the
 *       replica, and with a statement timeout, so a slow block is dropped from the
 *       answer (named in {@code errors}) instead of holding a connection.</li>
 *   <li>Aggregation happens in SQL; lists are LIMITed; the range is capped.</li>
 *   <li>Results are cached per scope for {@link #CACHE_TTL}: whole-institute admins
 *       share one entry, everyone else gets their own. Concurrent identical
 *       requests compute once.</li>
 * </ul>
 *
 * <p>Visibility: lead blocks use {@link LeadVisibilityResolver} — the CRM Leads list
 * scope — and the count tiles call the list query itself, so a number on the
 * dashboard equals the count of the list it links to.
 */
@Slf4j
@Service
public class CrmDashboardService {

    static final int DEFAULT_RANGE_DAYS = 30;
    static final int MAX_RANGE_DAYS = 366;
    /** Previous-period comparison only for ranges up to this length (keeps the scan bounded). */
    static final int MAX_COMPARE_DAYS = 92;
    static final Duration CACHE_TTL = Duration.ofMinutes(3);
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";

    static final List<String> ALL_BLOCKS = List.of(
            "summary", "followups", "pipeline", "sources", "counsellors", "calls", "lists", "quality", "views", "list_stats",
            "shifts");

    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final LeadVisibilityResolver leadVisibilityResolver;
    private final CounsellorScopeService counsellorScopeService;
    private final AudienceService audienceService;
    private final LeadFollowupService leadFollowupService;
    private final AuthService authService;

    private final Cache<String, Object> cache = Caffeine.newBuilder()
            .expireAfterWrite(CACHE_TTL)
            .maximumSize(2_000)
            .build();

    public CrmDashboardService(NamedParameterJdbcTemplate jdbc,
                               PlatformTransactionManager transactionManager,
                               LeadVisibilityResolver leadVisibilityResolver,
                               CounsellorScopeService counsellorScopeService,
                               AudienceService audienceService,
                               LeadFollowupService leadFollowupService,
                               AuthService authService) {
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.leadVisibilityResolver = leadVisibilityResolver;
        this.counsellorScopeService = counsellorScopeService;
        this.audienceService = audienceService;
        this.leadFollowupService = leadFollowupService;
        this.authService = authService;
    }

    public CrmDashboardResponseDTO getDashboard(CrmDashboardRequestDTO req, CustomUserDetails user) {
        String instituteId = req.getInstituteId();
        Window w = resolveWindow(req);
        LeadVisibility vis = readOnlyTx.execute(s -> leadVisibilityResolver.resolve(user, instituteId));
        Scope scope = toScope(vis, instituteId, user, trimToNull(req.getTeamId()),
                trimToNull(req.getAudienceId()));

        Set<String> wanted = new LinkedHashSet<>();
        if (req.getBlocks() == null || req.getBlocks().isEmpty()) {
            wanted.addAll(ALL_BLOCKS);
        } else {
            req.getBlocks().stream().map(b -> b == null ? "" : b.trim().toLowerCase())
                    .filter(ALL_BLOCKS::contains).forEach(wanted::add);
        }

        Map<String, Object> blocks = new LinkedHashMap<>();
        Map<String, String> errors = new LinkedHashMap<>();
        for (String block : wanted) {
            if (scope.empty()) {
                // Granted no lists: the leads page shows nothing, so neither do we.
                blocks.put(block, Map.of("empty", true));
                continue;
            }
            String key = cacheKey(instituteId, scope, block, w);
            try {
                Object value = cache.get(key, k -> compute(block, instituteId, scope, w, user));
                if (value != null) blocks.put(block, value);
            } catch (Exception e) {
                log.warn("[CrmDashboard] block {} failed for institute {}: {}", block, instituteId, e.getMessage());
                errors.put(block, "unavailable");
            }
        }

        return CrmDashboardResponseDTO.builder()
                .from(w.from().toString())
                .to(w.to().toString())
                .previousFrom(w.compare() ? w.prevFrom().toString() : null)
                .previousTo(w.compare() ? w.from().toString() : null)
                .scopeMode(vis.mode().name())
                .admin(vis.admin())
                .blocks(blocks)
                .errors(errors)
                .generatedAt(Instant.now().toString())
                .build();
    }

    // ─────────────────────────────────────────────────────────── blocks

    private Object compute(String block, String instituteId, Scope scope, Window w, CustomUserDetails user) {
        return switch (block) {
            case "summary" -> inTx(() -> summary(instituteId, scope, w));
            case "followups" -> inTx(() -> followups(instituteId, scope, w, user));
            case "pipeline" -> inTx(() -> pipeline(instituteId, scope, w));
            case "sources" -> inTx(() -> rows(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.SOURCES, params(instituteId, scope, w)));
            case "counsellors" -> inTx(() -> counsellors(instituteId, scope, w));
            case "calls" -> inTx(() -> calls(instituteId, scope, w));
            case "lists" -> inTx(() -> rows(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.LISTS, params(instituteId, scope, w)));
            case "quality" -> inTx(() -> quality(instituteId, scope, w));
            case "views" -> inTx(() -> jdbc.queryForMap(CrmDashboardSql.visAll() + CrmDashboardSql.VIEWS,
                    params(instituteId, scope, w)));
            case "list_stats" -> inTx(() -> listStats(instituteId, scope, w));
            case "shifts" -> inTx(() -> Map.of("day", todayDow(w), "rows",
                    rows(CrmDashboardSql.SHIFTS_TODAY, params(instituteId, scope, w).addValue("dow", todayDow(w)))));
            default -> null;
        };
    }

    private Map<String, Object> summary(String instituteId, Scope scope, Window w) {
        MapSqlParameterSource p = params(instituteId, scope, w);
        Map<LocalDate, Long> leads = new HashMap<>();
        Map<LocalDate, Long> contactedByDay = new HashMap<>();
        jdbc.query(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.DAILY_LEADS, p, rs -> {
            java.sql.Date d = rs.getDate("day");
            if (d != null) {
                leads.put(d.toLocalDate(), rs.getLong("n"));
                contactedByDay.put(d.toLocalDate(), rs.getLong("contacted"));
            }
        });
        // Conversions are keyed on converted_at, so they need every visible lead, not only new ones.
        Map<LocalDate, Long> converted = daySeries(CrmDashboardSql.visAll() + CrmDashboardSql.DAILY_CONVERTED, p);
        Map<String, Object> fr = jdbc.queryForMap(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.FIRST_RESPONSE, p);

        LocalDate fromDay = w.from().atZone(ZoneOffset.UTC).withZoneSameInstant(w.tz()).toLocalDate();
        LocalDate toDay = w.to().minusSeconds(1).atZone(ZoneOffset.UTC).withZoneSameInstant(w.tz()).toLocalDate();
        List<Map<String, Object>> daily = new ArrayList<>();
        long newLeads = 0, conv = 0;
        for (LocalDate d = fromDay; !d.isAfter(toDay); d = d.plusDays(1)) {
            long l = leads.getOrDefault(d, 0L), c = converted.getOrDefault(d, 0L);
            newLeads += l;
            conv += c;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("day", d.toString());
            row.put("leads", l);
            row.put("contacted", contactedByDay.getOrDefault(d, 0L));
            row.put("converted", c);
            daily.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("new_leads", newLeads);
        out.put("converted", conv);
        out.put("contacted", num(fr.get("contacted")));
        out.put("median_first_response_minutes", fr.get("median_minutes"));
        out.put("daily", daily);
        if (w.compare()) {
            LocalDate prevFromDay = w.prevFrom().atZone(ZoneOffset.UTC).withZoneSameInstant(w.tz()).toLocalDate();
            long pl = 0, pc = 0;
            List<Long> prevDaily = new ArrayList<>();
            for (LocalDate d = prevFromDay; d.isBefore(fromDay); d = d.plusDays(1)) {
                long l = leads.getOrDefault(d, 0L);
                pl += l;
                pc += converted.getOrDefault(d, 0L);
                prevDaily.add(l);
            }
            out.put("previous_new_leads", pl);
            out.put("previous_converted", pc);
            out.put("previous_daily_leads", prevDaily);
        }
        return out;
    }

    /**
     * The Follow-ups page tiles, counted by the leads list query itself with the
     * page's own request shape (open follow-up in the window, converted leads
     * excluded), so the dashboard and the page always agree.
     */
    private Map<String, Object> followups(String instituteId, Scope scope, Window w, CustomUserDetails user) {
        Timestamp now = Timestamp.from(w.now());
        Timestamp todayEnd = Timestamp.from(w.todayEnd());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("overdue", countLeads(instituteId, scope, user, null, now));
        out.put("today", countLeads(instituteId, scope, user, now, todayEnd));
        out.put("upcoming", countLeads(instituteId, scope, user, todayEnd, null));
        // The completed endpoint narrows by one counsellor at most; a multi-person team
        // filter can't be expressed there, so the tile is left out rather than over-counted.
        String team = scope.teamOwnerCsv();
        if (team == null || !team.contains(",")) {
            out.put("completed_today", leadFollowupService.completed(user, instituteId, team, null,
                    Timestamp.from(w.todayStart()), now, null, null, PageRequest.of(0, 1), false)
                    .getTotalElements());
        }
        return out;
    }

    private long countLeads(String instituteId, Scope scope, CustomUserDetails user, Timestamp from, Timestamp to) {
        LeadFilterDTO f = new LeadFilterDTO();
        f.setInstituteId(instituteId);
        f.setAssignedCounselorId(scope.teamOwnerCsv());
        if (!scope.audienceId().isEmpty()) f.setAudienceId(scope.audienceId());
        f.setConversionStatusFilter("EXCLUDE_CONVERTED");
        f.setFollowUpPending(true);
        f.setFollowUpFrom(from);
        f.setFollowUpTo(to);
        f.setPage(0);
        f.setSize(1);
        return audienceService.getLeads(f, user).getTotalElements();
    }

    private Map<String, Object> pipeline(String instituteId, Scope scope, Window w) {
        MapSqlParameterSource p = params(instituteId, scope, w);
        List<Map<String, Object>> counts = jdbc.queryForList(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.PIPELINE, p);
        List<Map<String, Object>> labels = jdbc.queryForList(CrmDashboardSql.STATUS_LABELS, p);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("statuses", labels);
        out.put("counts", counts);
        return out;
    }

    private Map<String, Object> counsellors(String instituteId, Scope scope, Window w) {
        MapSqlParameterSource p = params(instituteId, scope, w);
        List<Map<String, Object>> rows = jdbc.queryForList(CrmDashboardSql.visSubmittedIn() + CrmDashboardSql.COUNSELLORS, p);
        Map<String, Long> overdue = new HashMap<>();
        for (Map<String, Object> r : jdbc.queryForList(CrmDashboardSql.visAll() + CrmDashboardSql.OVERDUE_BY_OWNER, p)) {
            overdue.put((String) r.get("owner_id"), num(r.get("n")));
        }
        Set<String> ids = new HashSet<>();
        rows.forEach(r -> ids.add((String) r.get("owner_id")));
        ids.addAll(overdue.keySet());
        Map<String, String> names = names(ids);
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, Object> r : rows) {
            String id = (String) r.get("owner_id");
            Map<String, Object> m = new LinkedHashMap<>(r);
            m.put("name", names.getOrDefault(id, ""));
            m.put("overdue", overdue.getOrDefault(id, 0L));
            out.add(m);
            seen.add(id);
        }
        // Counsellors with overdue work but no new leads in the range still need to show up.
        overdue.forEach((id, n) -> {
            if (!seen.contains(id) && out.size() < 60) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("owner_id", id);
                m.put("assigned", 0L);
                m.put("contacted", 0L);
                m.put("converted", 0L);
                m.put("median_minutes", null);
                m.put("name", names.getOrDefault(id, ""));
                m.put("overdue", n);
                out.add(m);
            }
        });
        return Map.of("rows", out);
    }

    private Map<String, Object> calls(String instituteId, Scope scope, Window w) {
        if (scope.callsRestricted()) {
            // Restricted to granted lists with no owner set: calls carry no list, so we can't
            // prove which ones the caller may see. Show nothing rather than too much.
            return Map.of("restricted", true);
        }
        MapSqlParameterSource p = params(instituteId, scope, w);
        Map<String, Object> out = new LinkedHashMap<>(jdbc.queryForMap(CrmDashboardSql.CALLS_TOTALS, p));
        out.put("by_status", jdbc.queryForList(CrmDashboardSql.CALLS_BY_STATUS, p));
        out.put("heatmap", jdbc.queryForList(CrmDashboardSql.CALLS_HEATMAP, p));
        return out;
    }

    private Map<String, Object> quality(String instituteId, Scope scope, Window w) {
        MapSqlParameterSource p = params(instituteId, scope, w);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", jdbc.queryForList(CrmDashboardSql.visAll() + CrmDashboardSql.QUALITY, p));
        out.put("tiers", jdbc.queryForList(CrmDashboardSql.TIER_LABELS, p));
        return out;
    }

    /**
     * Lead List cards: per-list counts plus a 14-day daily series, inside the caller's
     * lead scope. Two grouped scans, cached like every other block.
     */
    private Map<String, Object> listStats(String instituteId, Scope scope, Window w) {
        MapSqlParameterSource p = params(instituteId, scope, w);
        Map<String, Map<String, Object>> byList = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc.queryForList(CrmDashboardSql.visAll() + CrmDashboardSql.LIST_STATS, p)) {
            Map<String, Object> m = new LinkedHashMap<>(r);
            m.put("daily", new long[14]);
            byList.put((String) r.get("audience_id"), m);
        }
        LocalDate today = w.todayStart().atZone(w.tz()).toLocalDate();
        jdbc.query(CrmDashboardSql.visAll() + CrmDashboardSql.LIST_DAILY, p, rs -> {
            Map<String, Object> m = byList.get(rs.getString("audience_id"));
            java.sql.Date d = rs.getDate("day");
            if (m == null || d == null) return;
            int idx = 13 - (int) ChronoUnit.DAYS.between(d.toLocalDate(), today);
            if (idx >= 0 && idx < 14) ((long[]) m.get("daily"))[idx] = rs.getLong("n");
        });
        return Map.of("rows", new ArrayList<>(byList.values()));
    }

    // ─────────────────────────────────────────────────────────── scope

    /**
     * The leads-list scope as SQL binds. A team filter narrows inside the caller's
     * own scope and never widens it: an empty intersection means nothing visible.
     */
    private Scope toScope(LeadVisibility vis, String instituteId, CustomUserDetails user, String teamId,
                          String audienceId) {
        boolean empty = vis.allowedAudienceIds() != null && vis.allowedAudienceIds().isEmpty();
        String allowedCsv = vis.allowedAudienceIds() == null ? "" : String.join(",", vis.allowedAudienceIds());
        String scopeCsv = vis.scopeOwnerIds() == null ? "" : String.join(",", vis.scopeOwnerIds());

        String ownerCsv = vis.forcedOwnerId() == null ? "" : vis.forcedOwnerId();
        String teamOwnerCsv = null;
        if (vis.forcedOwnerId() == null && teamId != null) {
            List<String> team = new ArrayList<>(counsellorScopeService.usersInTeams(List.of(teamId)));
            List<String> owners = vis.ownerIds();
            if (owners != null) {
                Set<String> allowed = new HashSet<>(owners);
                team.removeIf(id -> !allowed.contains(id));
            }
            if (team.isEmpty()) {
                empty = true;
            } else {
                ownerCsv = String.join(",", team);
                teamOwnerCsv = ownerCsv;
            }
        }

        // Calls are owned by a counsellor: limit to the owner set when one exists.
        List<String> owners = !ownerCsv.isEmpty() ? List.of(ownerCsv.split(",")) : vis.ownerIds();
        String callOwnerCsv = owners == null ? "" : String.join(",", owners);
        boolean callsRestricted = owners == null && vis.allowedAudienceIds() != null;

        boolean shared = vis.admin() && ownerCsv.isEmpty() && scopeCsv.isEmpty() && allowedCsv.isEmpty();
        String cacheIdentity = shared ? "ADMIN" : vis.mode().name() + ":" + user.getUserId();
        // A list the caller was not granted is as empty as the leads page shows it.
        if (audienceId != null && vis.allowedAudienceIds() != null && !vis.allowedAudienceIds().contains(audienceId)) {
            empty = true;
        }
        return new Scope(ownerCsv, scopeCsv, vis.includeUnassigned(), allowedCsv, callOwnerCsv,
                callsRestricted, teamOwnerCsv, empty,
                cacheIdentity + "|" + (teamId == null ? "" : teamId) + "|" + (audienceId == null ? "" : audienceId),
                audienceId == null ? "" : audienceId);
    }

    record Scope(String ownerCsv, String scopeCsv, boolean includeUnassigned, String allowedCsv,
                 String callOwnerCsv, boolean callsRestricted, String teamOwnerCsv, boolean empty,
                 String cacheIdentity, String audienceId) {
    }

    // ─────────────────────────────────────────────────────────── window

    /**
     * Range defaults to the last 30 days, is capped at {@link #MAX_RANGE_DAYS} and
     * compared with the equal-length period before it when short enough. The
     * follow-up "now" is rounded to the minute so cached answers are reusable.
     */
    Window resolveWindow(CrmDashboardRequestDTO req) {
        Instant now = parseInstant(req.getNow(), Instant.now()).truncatedTo(ChronoUnit.MINUTES);
        Instant to = parseInstant(req.getTo(), now);
        Instant from = parseInstant(req.getFrom(), to.minus(DEFAULT_RANGE_DAYS, ChronoUnit.DAYS));
        if (!from.isBefore(to)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "from must be before to");
        }
        if (Duration.between(from, to).toDays() > MAX_RANGE_DAYS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "Date range can be at most " + MAX_RANGE_DAYS + " days");
        }
        ZoneId tz = zone(req.getTimezone());
        Instant todayStart = now.atZone(tz).toLocalDate().atStartOfDay(tz).toInstant();
        Instant todayEnd = parseInstant(req.getTodayEnd(), todayStart.plus(1, ChronoUnit.DAYS).minusMillis(1));
        boolean compare = Duration.between(from, to).toDays() <= MAX_COMPARE_DAYS;
        Instant prevFrom = compare ? from.minus(Duration.between(from, to)) : from;
        return new Window(utc(from), utc(to), utc(prevFrom), compare, tz, now, todayStart, todayEnd);
    }

    record Window(LocalDateTime from, LocalDateTime to, LocalDateTime prevFrom, boolean compare, ZoneId tz,
                  Instant now, Instant todayStart, Instant todayEnd) {
    }

    // ─────────────────────────────────────────────────────────── helpers

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }

    private MapSqlParameterSource params(String instituteId, Scope scope, Window w) {
        return new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("ownerCsv", scope.ownerCsv())
                .addValue("scopeCsv", scope.scopeCsv())
                .addValue("includeUnassigned", scope.includeUnassigned())
                .addValue("allowedCsv", scope.allowedCsv())
                .addValue("audienceId", scope.audienceId())
                .addValue("callOwnerCsv", scope.callOwnerCsv())
                .addValue("tz", w.tz().getId())
                .addValue("from", w.from(), java.sql.Types.TIMESTAMP)
                .addValue("to", w.to(), java.sql.Types.TIMESTAMP)
                .addValue("seriesFrom", w.prevFrom(), java.sql.Types.TIMESTAMP)
                .addValue("now", utc(w.now()), java.sql.Types.TIMESTAMP)
                .addValue("todayStart", utc(w.todayStart()), java.sql.Types.TIMESTAMP);
    }

    private List<Map<String, Object>> rows(String sql, MapSqlParameterSource p) {
        return jdbc.queryForList(sql, p);
    }

    private Map<LocalDate, Long> daySeries(String sql, MapSqlParameterSource p) {
        Map<LocalDate, Long> out = new HashMap<>();
        jdbc.query(sql, p, rs -> {
            java.sql.Date d = rs.getDate("day");
            if (d != null) out.put(d.toLocalDate(), rs.getLong("n"));
        });
        return out;
    }

    private Map<String, String> names(Collection<String> userIds) {
        List<String> ids = userIds.stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        Map<String, String> out = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
        } catch (Exception e) {
            log.warn("[CrmDashboard] counsellor name lookup failed: {}", e.getMessage());
        }
        return out;
    }

    /** Pool shifts store the weekday as MON..SUN; today in the caller's zone. */
    static String todayDow(Window w) {
        return w.now().atZone(w.tz()).getDayOfWeek().name().substring(0, 3);
    }

    private String cacheKey(String instituteId, Scope scope, String block, Window w) {
        String base = instituteId + "|" + scope.cacheIdentity() + "|" + block + "|" + w.tz().getId();
        return switch (block) {
            case "followups" -> base + "|" + w.now() + "|" + w.todayEnd();
            case "quality", "shifts" -> base + "|" + w.todayStart();
            case "views", "list_stats" -> base + "|" + w.now() + "|" + w.todayStart();
            default -> base + "|" + w.from() + "|" + w.to();
        };
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    private static Instant parseInstant(String raw, Instant fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return Instant.parse(raw.trim());
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Invalid date: " + raw);
        }
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static ZoneId zone(String raw) {
        try {
            return ZoneId.of(TimezoneNormalizer.normalize(raw));
        } catch (Exception e) {
            return ZoneId.of(TimezoneNormalizer.DEFAULT_TIMEZONE);
        }
    }

    private static String trimToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
