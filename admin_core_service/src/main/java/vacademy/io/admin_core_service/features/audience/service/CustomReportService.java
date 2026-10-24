package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.reports.custom.CustomReportCatalogDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.custom.CustomReportRequest;
import vacademy.io.admin_core_service.features.audience.dto.reports.custom.CustomReportResponseDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Curated, self-serve report builder over a lead-centric semantic model.
 *
 * <p>Safety first: the client never sends SQL. It picks {@code dimension} / {@code measure} /
 * {@code filter} keys, each validated against a static whitelist ({@link #DIMENSIONS},
 * {@link #MEASURES}, {@link #FILTERS}) that maps to fixed, vetted SQL fragments. Filter values bind
 * as JDBC parameters. There is no string interpolation of any user value into SQL.
 *
 * <p>Base: {@code user_lead_profile} (one row per institute lead) LEFT JOINed to each user's
 * lifetime PAID payment total. Same revenue/conversion semantics and RBAC scoping as
 * {@link RevenueReportService}. Counsellor ids in the grid are hydrated to names via auth-service.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CustomReportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ReportScopeResolver scopeResolver;
    private final LeadReportSettingService settingService;
    private final AuthService authService;

    private static final int DEFAULT_RANGE_DAYS = 30;
    private static final int MAX_ROWS = 1000;
    private static final String COUNSELLOR_KEY = "counsellor";
    private static final String STATUS_KEY = "conversion_status";

    // ── Whitelist: dimension key → (label, group-by SQL expression) ──────────
    private record Dim(String label, String expr) {
    }

    private static final Map<String, Dim> DIMENSIONS = new LinkedHashMap<>();
    static {
        DIMENSIONS.put("source_type", new Dim("Source", "COALESCE(ulp.best_source_type, 'UNKNOWN')"));
        DIMENSIONS.put("lead_tier", new Dim("Tier", "COALESCE(ulp.lead_tier, 'UNCLASSIFIED')"));
        // conversion_status holds the lead's CURRENT status_key — the bidirectional
        // list↔side-view mirror keeps it in sync with audience_response.lead_status_id,
        // so this is the "current status" field. Values hydrate to catalog labels in run().
        DIMENSIONS.put(STATUS_KEY, new Dim("Current status", "ulp.conversion_status"));
        DIMENSIONS.put(COUNSELLOR_KEY, new Dim("Counsellor", "ulp.assigned_counselor_id"));
        DIMENSIONS.put("acquisition_month", new Dim("Acquisition month",
                "to_char((COALESCE(ulp.created_at, ulp.last_calculated_at) AT TIME ZONE 'UTC' AT TIME ZONE :tz), 'YYYY-MM')"));
    }

    // ── Whitelist: measure key → (label, aggregate SQL expression) ───────────
    private record Meas(String label, String expr) {
    }

    private static final String CONVERTED = "ulp.conversion_status = 'CONVERTED'";
    private static final String REVENUE_EXPR =
            "COALESCE(SUM(rev.revenue) FILTER (WHERE " + CONVERTED + "), 0)";

    private static final Map<String, Meas> MEASURES = new LinkedHashMap<>();
    static {
        MEASURES.put("leads", new Meas("Leads", "COUNT(*)"));
        MEASURES.put("converted", new Meas("Converted", "COUNT(*) FILTER (WHERE " + CONVERTED + ")"));
        MEASURES.put("lost", new Meas("Lost", "COUNT(*) FILTER (WHERE ulp.conversion_status = 'LOST')"));
        MEASURES.put("conversion_rate", new Meas("Conv %",
                "ROUND(100.0 * (COUNT(*) FILTER (WHERE " + CONVERTED + "))::numeric / NULLIF(COUNT(*), 0), 1)"));
        MEASURES.put("revenue", new Meas("Revenue", "ROUND(" + REVENUE_EXPR + "::numeric, 2)"));
        MEASURES.put("avg_deal_value", new Meas("Avg deal value",
                "ROUND(" + REVENUE_EXPR + "::numeric / NULLIF(COUNT(*) FILTER (WHERE " + CONVERTED + "), 0), 2)"));
        MEASURES.put("avg_lead_score", new Meas("Avg lead score", "ROUND(AVG(ulp.best_score)::numeric, 1)"));
    }

    // ── Whitelist: filterable field key → (label, WHERE SQL expression) ──────
    private record Filt(String label, String expr) {
    }

    private static final Map<String, Filt> FILTERS = new LinkedHashMap<>();
    static {
        FILTERS.put("source_type", new Filt("Source", "COALESCE(ulp.best_source_type, 'UNKNOWN')"));
        FILTERS.put("lead_tier", new Filt("Tier", "COALESCE(ulp.lead_tier, 'UNCLASSIFIED')"));
        FILTERS.put(STATUS_KEY, new Filt("Current status", "ulp.conversion_status"));
        FILTERS.put(COUNSELLOR_KEY, new Filt("Counsellor", "ulp.assigned_counselor_id"));
    }

    private static final String BASE_FROM = """
            FROM user_lead_profile ulp
            LEFT JOIN (
                SELECT pl.user_id, SUM(pl.payment_amount) AS revenue
                FROM payment_log pl
                WHERE pl.payment_status = 'PAID' AND pl.payment_amount IS NOT NULL
                GROUP BY pl.user_id
            ) rev ON rev.user_id = ulp.user_id
            WHERE ulp.institute_id = :instituteId
              AND COALESCE(ulp.created_at, ulp.last_calculated_at) >= :fromTs
              AND COALESCE(ulp.created_at, ulp.last_calculated_at) <  :toTs
              AND (:scopeCsv IS NULL OR ulp.assigned_counselor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))
            """;

    // ─────────────────────────────────────────────────────────────────────
    // Catalog
    // ─────────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public CustomReportCatalogDTO getCatalog(String instituteId, String callerUserId) {
        List<CustomReportCatalogDTO.Field> dims = DIMENSIONS.entrySet().stream()
                .map(e -> CustomReportCatalogDTO.Field.builder()
                        .key(e.getKey()).label(e.getValue().label()).type("string").build())
                .collect(Collectors.toList());
        List<CustomReportCatalogDTO.Field> measures = MEASURES.entrySet().stream()
                .map(e -> CustomReportCatalogDTO.Field.builder()
                        .key(e.getKey()).label(e.getValue().label()).type("number").build())
                .collect(Collectors.toList());

        // Pre-resolved filter options for the enumerable fields.
        List<CustomReportCatalogDTO.FilterField> filters = new ArrayList<>();
        filters.add(filterField("source_type", "Source", distinctSourceOptions(instituteId)));
        filters.add(filterField("lead_tier", "Tier", tierOptions(instituteId)));
        filters.add(filterField(STATUS_KEY, "Current status", statusOptions(instituteId)));
        filters.add(filterField(COUNSELLOR_KEY, "Counsellor", counsellorOptions(instituteId, callerUserId)));

        return CustomReportCatalogDTO.builder()
                .dimensions(dims).measures(measures).filters(filters).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Run
    // ─────────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public CustomReportResponseDTO run(CustomReportRequest req, String callerUserId) {
        String instituteId = req.getInstituteId();
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required.");
        }
        List<String> dims = clean(req.getDimensions());
        List<String> measures = clean(req.getMeasures());
        if (dims.isEmpty()) throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick at least one dimension.");
        if (measures.isEmpty()) throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick at least one measure.");
        dims.forEach(d -> require(DIMENSIONS.containsKey(d), "Unknown dimension: " + d));
        measures.forEach(m -> require(MEASURES.containsKey(m), "Unknown measure: " + m));

        LeadReportSettingService.ReportSettings settings = settingService.get(instituteId);
        ZoneId zone = safeZone(settings.timezone());
        Window w = resolveWindow(req.getFromDate(), req.getToDate(), zone);
        String scopeCsv = scopeResolver.resolveScopeUsersCsv(
                instituteId, callerUserId, trimToNull(req.getTeamId()), trimToNull(req.getCounsellorUserId()));

        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("tz", zone.getId())
                .addValue("fromTs", w.fromUtc(), Types.TIMESTAMP)
                .addValue("toTs", w.toUtc(), Types.TIMESTAMP)
                .addValue("scopeCsv", scopeCsv, Types.VARCHAR);

        // SELECT: dimensions (positions 1..D) then measures.
        List<String> selectExprs = new ArrayList<>();
        for (String d : dims) selectExprs.add(DIMENSIONS.get(d).expr());
        for (String m : measures) selectExprs.add(MEASURES.get(m).expr());

        StringBuilder sql = new StringBuilder("SELECT ")
                .append(String.join(", ", selectExprs))
                .append(' ').append(BASE_FROM);

        // Dynamic filters — each value list binds as an IN parameter.
        List<CustomReportRequest.Filter> reqFilters = req.getFilters() == null ? List.of() : req.getFilters();
        int fi = 0;
        for (CustomReportRequest.Filter f : reqFilters) {
            if (f == null || f.getField() == null) continue;
            String field = f.getField().trim();
            List<String> values = clean(f.getValues());
            if (values.isEmpty()) continue;
            require(FILTERS.containsKey(field), "Unknown filter field: " + field);
            String param = "f" + (fi++);
            sql.append(" AND ").append(FILTERS.get(field).expr()).append(" IN (:").append(param).append(')');
            p.addValue(param, values);
        }

        // GROUP BY dimension positions.
        sql.append(" GROUP BY ");
        sql.append(java.util.stream.IntStream.rangeClosed(1, dims.size())
                .mapToObj(Integer::toString).collect(Collectors.joining(", ")));

        // ORDER BY: requested sort if among the selected fields, else first measure desc.
        int orderPos = dims.size() + 1; // default: first measure
        String dir = "DESC";
        if (req.getSort() != null && req.getSort().getField() != null) {
            int pos = selectedPosition(req.getSort().getField().trim(), dims, measures);
            if (pos > 0) {
                orderPos = pos;
                dir = "asc".equalsIgnoreCase(req.getSort().getDir()) ? "ASC" : "DESC";
            }
        }
        sql.append(" ORDER BY ").append(orderPos).append(' ').append(dir)
                .append(" NULLS LAST");

        int limit = req.getLimit() == null ? MAX_ROWS : Math.max(1, Math.min(MAX_ROWS, req.getLimit()));
        sql.append(" LIMIT ").append(limit + 1); // +1 to detect truncation

        final int dimCount = dims.size();
        final int measCount = measures.size();
        List<List<Object>> rows = jdbc.query(sql.toString(), p, (rs, i) -> {
            List<Object> row = new ArrayList<>(dimCount + measCount);
            for (int c = 1; c <= dimCount; c++) row.add(rs.getString(c));
            for (int c = 1; c <= measCount; c++) {
                BigDecimal v = rs.getBigDecimal(dimCount + c);
                row.add(v == null ? null : v.doubleValue());
            }
            return row;
        });

        boolean truncated = rows.size() > limit;
        if (truncated) rows = rows.subList(0, limit);

        // Hydrate counsellor ids → names in-place.
        int counsellorIdx = dims.indexOf(COUNSELLOR_KEY);
        if (counsellorIdx >= 0) {
            List<String> ids = rows.stream().map(r -> (String) r.get(0 + counsellorIdx))
                    .filter(s -> s != null && !s.isBlank()).distinct().toList();
            Map<String, String> names = resolveNames(ids);
            for (List<Object> r : rows) {
                String id = (String) r.get(counsellorIdx);
                if (id != null) r.set(counsellorIdx, names.getOrDefault(id, id));
            }
        }

        // Hydrate current-status keys → catalog labels in-place (unknown keys stay raw).
        int statusIdx = dims.indexOf(STATUS_KEY);
        if (statusIdx >= 0) {
            Map<String, String> labels = statusLabels(instituteId);
            for (List<Object> r : rows) {
                String key = (String) r.get(statusIdx);
                if (key != null) r.set(statusIdx, labels.getOrDefault(key, key));
            }
        }

        List<CustomReportResponseDTO.Column> columns = new ArrayList<>();
        for (String d : dims) {
            columns.add(CustomReportResponseDTO.Column.builder()
                    .key(d).label(DIMENSIONS.get(d).label()).kind("dimension").type("string").build());
        }
        for (String m : measures) {
            columns.add(CustomReportResponseDTO.Column.builder()
                    .key(m).label(MEASURES.get(m).label()).kind("measure").type("number").build());
        }

        return CustomReportResponseDTO.builder()
                .columns(columns)
                .rows(rows)
                .rowCount(rows.size())
                .truncated(truncated)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Catalog option helpers
    // ─────────────────────────────────────────────────────────────────────

    private List<CustomReportCatalogDTO.Option> distinctSourceOptions(String instituteId) {
        try {
            List<String> values = jdbc.queryForList(
                    "SELECT DISTINCT COALESCE(best_source_type, 'UNKNOWN') AS s FROM user_lead_profile "
                            + "WHERE institute_id = :instituteId ORDER BY s",
                    new MapSqlParameterSource("instituteId", instituteId), String.class);
            return values.stream().map(v -> CustomReportCatalogDTO.Option.builder().value(v).label(v).build())
                    .collect(Collectors.toList());
        } catch (Exception e) {
            return List.of();
        }
    }

    /**
     * Current-status filter options: the institute's ACTIVE status catalog in display_order,
     * followed by any extra conversion_status values actually present on this institute's leads
     * (legacy / now-inactive keys), so every stored value stays filterable. Values are the raw
     * status_keys the filter binds on; labels come from the catalog when it knows the key.
     */
    private List<CustomReportCatalogDTO.Option> statusOptions(String instituteId) {
        try {
            MapSqlParameterSource p = new MapSqlParameterSource("instituteId", instituteId);
            List<CustomReportCatalogDTO.Option> out = new ArrayList<>();
            Map<String, String> labels = statusLabels(instituteId);
            List<String> catalogKeys = jdbc.queryForList(
                    "SELECT status_key FROM lead_status WHERE institute_id = :instituteId "
                            + "AND is_active = true ORDER BY display_order, status_key",
                    p, String.class);
            for (String key : catalogKeys) {
                out.add(CustomReportCatalogDTO.Option.builder()
                        .value(key).label(labels.getOrDefault(key, key)).build());
            }
            List<String> present = jdbc.queryForList(
                    "SELECT DISTINCT conversion_status FROM user_lead_profile "
                            + "WHERE institute_id = :instituteId AND conversion_status IS NOT NULL "
                            + "ORDER BY conversion_status",
                    p, String.class);
            for (String key : present) {
                if (!catalogKeys.contains(key)) {
                    out.add(CustomReportCatalogDTO.Option.builder()
                            .value(key).label(labels.getOrDefault(key, key)).build());
                }
            }
            return out;
        } catch (Exception e) {
            return staticOptions("LEAD", "CONVERTED", "LOST");
        }
    }

    /** status_key → catalog label for this institute (active AND inactive rows, for hydration). */
    private Map<String, String> statusLabels(String instituteId) {
        try {
            Map<String, String> labels = new LinkedHashMap<>();
            org.springframework.jdbc.core.RowCallbackHandler collector = rs -> {
                String label = rs.getString("label");
                if (label != null && !label.isBlank()) {
                    labels.putIfAbsent(rs.getString("status_key"), label);
                }
            };
            jdbc.query("SELECT status_key, label FROM lead_status WHERE institute_id = :instituteId",
                    new MapSqlParameterSource("instituteId", instituteId), collector);
            return labels;
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private List<CustomReportCatalogDTO.Option> counsellorOptions(String instituteId, String callerUserId) {
        try {
            String scopeCsv = scopeResolver.resolveScopeUsersCsv(instituteId, callerUserId, null, null);
            List<String> ids = jdbc.queryForList(
                    "SELECT DISTINCT assigned_counselor_id FROM user_lead_profile "
                            + "WHERE institute_id = :instituteId AND assigned_counselor_id IS NOT NULL "
                            + "AND (:scopeCsv IS NULL OR assigned_counselor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ',')))",
                    new MapSqlParameterSource("instituteId", instituteId)
                            .addValue("scopeCsv", scopeCsv, Types.VARCHAR), String.class);
            Map<String, String> names = resolveNames(ids);
            return ids.stream()
                    .map(id -> CustomReportCatalogDTO.Option.builder()
                            .value(id).label(names.getOrDefault(id, id)).build())
                    .sorted((a, b) -> a.getLabel().compareToIgnoreCase(b.getLabel()))
                    .collect(Collectors.toList());
        } catch (Exception e) {
            return List.of();
        }
    }

    /** Institute tier catalog (falls back to the legacy trio), plus UNCLASSIFIED for unscored leads. */
    private List<CustomReportCatalogDTO.Option> tierOptions(String instituteId) {
        List<CustomReportCatalogDTO.Option> out = new ArrayList<>();
        try {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT tier_key, label FROM lead_tier WHERE institute_id = :instituteId "
                            + "AND is_active = true ORDER BY display_order, tier_key",
                    new MapSqlParameterSource("instituteId", instituteId));
            for (Map<String, Object> r : rows) {
                String key = String.valueOf(r.get("tier_key"));
                Object label = r.get("label");
                out.add(CustomReportCatalogDTO.Option.builder()
                        .value(key).label(label != null ? label.toString() : key).build());
            }
        } catch (Exception ignored) {
            // table missing or query failure: fall through to the legacy trio
        }
        if (out.isEmpty()) out.addAll(staticOptions("HOT", "WARM", "COLD"));
        out.add(CustomReportCatalogDTO.Option.builder().value("UNCLASSIFIED").label("UNCLASSIFIED").build());
        return out;
    }

    private static List<CustomReportCatalogDTO.Option> staticOptions(String... values) {
        List<CustomReportCatalogDTO.Option> out = new ArrayList<>();
        for (String v : values) out.add(CustomReportCatalogDTO.Option.builder().value(v).label(v).build());
        return out;
    }

    private static CustomReportCatalogDTO.FilterField filterField(String key, String label,
                                                                  List<CustomReportCatalogDTO.Option> options) {
        return CustomReportCatalogDTO.FilterField.builder().key(key).label(label).options(options).build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static int selectedPosition(String field, List<String> dims, List<String> measures) {
        int di = dims.indexOf(field);
        if (di >= 0) return di + 1;
        int mi = measures.indexOf(field);
        if (mi >= 0) return dims.size() + mi + 1;
        return -1;
    }

    private static List<String> clean(List<String> in) {
        if (in == null) return new ArrayList<>();
        return in.stream().filter(s -> s != null && !s.isBlank()).map(String::trim)
                .distinct().collect(Collectors.toList());
    }

    private static void require(boolean cond, String message) {
        if (!cond) throw new VacademyException(HttpStatus.BAD_REQUEST, message);
    }

    private Map<String, String> resolveNames(Collection<String> userIds) {
        List<String> ids = userIds.stream()
                .filter(s -> s != null && !s.isBlank()).distinct().collect(Collectors.toList());
        if (ids.isEmpty()) return Collections.emptyMap();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
            if (users == null) return Collections.emptyMap();
            return users.stream().filter(u -> u != null && u.getId() != null)
                    .collect(Collectors.toMap(UserDTO::getId,
                            u -> Optional.ofNullable(u.getFullName()).orElse(u.getId()), (a, b) -> a));
        } catch (Exception e) {
            log.warn("[CustomReport] name hydration failed: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    private Window resolveWindow(String fromDate, String toDate, ZoneId zone) {
        LocalDate today = LocalDate.now(zone);
        LocalDate to = parseOr(toDate, today);
        LocalDate from = parseOr(fromDate, to.minusDays(DEFAULT_RANGE_DAYS - 1L));
        return new Window(toUtc(from, zone), toUtc(to.plusDays(1), zone));
    }

    private static Timestamp toUtc(LocalDate localDate, ZoneId zone) {
        return Timestamp.valueOf(localDate.atStartOfDay(zone)
                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private ZoneId safeZone(String tz) {
        try {
            return ZoneId.of(tz);
        } catch (Exception e) {
            return ZoneId.of("Asia/Kolkata");
        }
    }

    private static LocalDate parseOr(String iso, LocalDate fallback) {
        if (iso == null || iso.isBlank()) return fallback;
        try {
            return LocalDate.parse(iso.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String trimToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private record Window(Timestamp fromUtc, Timestamp toUtc) {
    }
}
