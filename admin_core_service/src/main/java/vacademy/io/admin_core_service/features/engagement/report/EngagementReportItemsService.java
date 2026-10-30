package vacademy.io.admin_core_service.features.engagement.report;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Engine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportItems.Item;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportItemsDao.ItemRow;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * The rows behind the daily report's lead numbers: leads added, demos booked and scheduled, lead
 * status changes and conversions of one engine's (or every engine's) institute-local day. Same
 * definitions, scope and day rules as {@link EngagementDailyReportService}, so with no search the
 * total is the number the report shows for that engine, day and filter. Staff names (demo host,
 * who changed a status) come from auth_service; when it cannot answer they are left null.
 */
@Slf4j
@Service
public class EngagementReportItemsService {

    static final int MAX_SIZE = 500;
    /** Phone search in digits only from this many digits on ("+91 98765" finds 919876500001). */
    static final int MIN_PHONE_DIGITS = 3;
    private static final String STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '8s'";

    private final EngagementReportItemsDao dao;
    private final EngagementDailyReportDao reportDao;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate readOnlyTx;
    private final InstituteTimezoneService timezoneService;
    private final PlaceholderEmailService placeholderEmailService;
    private final AuthService authService;

    public EngagementReportItemsService(EngagementReportItemsDao dao,
                                        EngagementDailyReportDao reportDao,
                                        NamedParameterJdbcTemplate jdbc,
                                        PlatformTransactionManager transactionManager,
                                        InstituteTimezoneService timezoneService,
                                        PlaceholderEmailService placeholderEmailService,
                                        AuthService authService) {
        this.dao = dao;
        this.reportDao = reportDao;
        this.jdbc = jdbc;
        this.readOnlyTx = new TransactionTemplate(transactionManager);
        this.readOnlyTx.setReadOnly(true);
        this.timezoneService = timezoneService;
        this.placeholderEmailService = placeholderEmailService;
        this.authService = authService;
    }

    /** A kind's filter as SQL over its items CTE, and the list id it binds (list:&lt;id&gt; only). */
    /**
     * TEMPLATES_CREATED filters, as the report splits newTemplates: by proposed category, by where
     * the template stands now, and utility proposals Meta moved to marketing.
     */
    static final Map<String, String> TEMPLATE_FILTERS = Map.of(
            "marketing", "UPPER(p.proposed_category) = 'MARKETING'",
            "utility", "UPPER(p.proposed_category) = 'UTILITY'",
            "authentication", "UPPER(p.proposed_category) = 'AUTHENTICATION'",
            "in_review", "p.status IN ('AI_PROPOSED', 'USER_REVIEW')",
            "approved_by_you", "p.status = 'USER_APPROVED'",
            "with_meta", "p.status IN ('SUBMITTED', 'META_PENDING')",
            "live", "p.status IN ('META_APPROVED', 'META_RECATEGORISED')",
            "rejected", "p.status IN ('META_REJECTED', 'META_DISABLED')",
            "withdrawn", "p.status IN ('WITHDRAWN', 'SUPERSEDED')",
            "moved_to_marketing", "UPPER(p.proposed_category) = 'UTILITY' AND UPPER(p.meta_category) = 'MARKETING'");

    record Clause(String sql, String listId) {
        static final Clause NONE = new Clause("TRUE", null);
    }

    /**
     * @param engineId null or blank = every engine of the institute
     * @param date     YYYY-MM-DD in the institute's zone (required; not in the future, at most 90 days back)
     * @throws InvalidRequestException   bad kind, filter, date, page
     * @throws ResourceNotFoundException the engine is not one of this institute's
     */
    public EngagementReportItems items(String instituteId, String engineId, String date, String kind,
                                       String filter, String search, int page, int size) {
        String k = kind == null ? null : kind.trim().toUpperCase(Locale.ROOT);
        if (k == null || !EngagementReportItems.KINDS.contains(k)) {
            throw new InvalidRequestException("kind must be one of " + EngagementReportItems.KINDS);
        }
        Clause clause = clause(k, filter);
        if (page < 0) throw new InvalidRequestException("page must be 0 or more");
        if (size < 1) throw new InvalidRequestException("size must be at least 1");
        int pageSize = Math.min(size, MAX_SIZE);
        ZoneId zone = EngagementReportDay.zone(timezoneService.getTimezoneId(instituteId));
        LocalDate day = EngagementReportDay.parseReportDay(date, zone);
        String engine = engineId == null || engineId.isBlank() ? null : engineId.trim();

        List<Engine> engines = inTx(() -> reportDao.engines(instituteId));
        if (engine != null && engines.stream().noneMatch(e -> e.id().equals(engine))) {
            throw new ResourceNotFoundException("Engagement engine not found: " + engine);
        }
        List<String> engineIds = engines.stream().map(Engine::id)
                .filter(id -> engine == null || id.equals(engine)).toList();
        if (engineIds.isEmpty()) {
            return new EngagementReportItems(k, day.toString(), zone.getId(), engine, 0, page, pageSize, List.of());
        }

        EngagementReportDay.Bounds b = EngagementReportDay.bounds(day, zone);
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("engineIds", engineIds)
                .addValue("from", b.from(), Types.TIMESTAMP)
                .addValue("to", b.to(), Types.TIMESTAMP)
                .addValue("limit", pageSize)
                .addValue("offset", (long) page * pageSize);
        if (clause.listId() != null) p.addValue("listId", clause.listId());
        if ("TEMPLATES_CREATED".equals(k)) {
            String where = clause.sql() + " AND " + templateSearchSql(search, p);
            long[] n = {0};
            List<Map<String, Object>> found = inTx(() -> {
                n[0] = dao.templateCount(where, p);
                return n[0] <= (long) page * pageSize ? List.<Map<String, Object>>of() : dao.templatePage(where, p);
            });
            List<Item> out = found.stream().map(EngagementReportItemsService::templateItem).toList();
            return new EngagementReportItems(k, day.toString(), zone.getId(), engine, n[0], page, pageSize, out);
        }
        String searchSql = searchSql(k, search, p);
        String items = itemsSql(k).formatted(clause.sql());
        String orderBy = "DEMOS_SCHEDULED".equals(k) ? "i.sort_at ASC, i.item_key" : "i.sort_at DESC, i.item_key";

        long[] total = {0};
        List<ItemRow> rows = inTx(() -> {
            total[0] = dao.count(items, searchSql, p);
            return total[0] <= (long) page * pageSize ? List.<ItemRow>of() : dao.page(items, searchSql, orderBy, p);
        });
        String convertedLabel = "CONVERSIONS".equals(k) && rows.stream().anyMatch(r -> r.toStatus() == null)
                ? inTx(() -> dao.convertedLabel(instituteId)) : null;
        Map<String, String> names = staffNames(rows);
        List<Item> out = rows.stream().map(r -> item(k, r, names, convertedLabel)).toList();
        return new EngagementReportItems(k, day.toString(), zone.getId(), engine, total[0], page, pageSize, out);
    }

    // ── request → SQL ────────────────────────────────────────────────────────

    static String itemsSql(String kind) {
        return switch (kind) {
            case "LEADS_ADDED" -> EngagementReportItemsSql.LEADS_ADDED;
            case "DEMOS_BOOKED" -> EngagementReportItemsSql.DEMOS_BOOKED;
            case "DEMOS_SCHEDULED" -> EngagementReportItemsSql.DEMOS_SCHEDULED;
            case "STATUS_CHANGES" -> EngagementReportItemsSql.STATUS_CHANGES;
            case "CONVERSIONS" -> EngagementReportItemsSql.CONVERSIONS;
            default -> throw new IllegalArgumentException(kind);
        };
    }

    /**
     * The kind's filter, as the report splits its number: LEADS_ADDED new | existing | list:&lt;id&gt;
     * (BATCH / USERS for the batch and named-user rows); DEMOS_SCHEDULED done | no_show |
     * not_marked; STATUS_CHANGES engine | team | automation. Blank = none; anything else is a 400.
     */
    static Clause clause(String kind, String filter) {
        if (filter == null || filter.isBlank()) return Clause.NONE;
        String f = filter.trim();
        String lower = f.toLowerCase(Locale.ROOT);
        switch (kind) {
            case "LEADS_ADDED" -> {
                if ("new".equals(lower)) return new Clause("is_new", null);
                if ("existing".equals(lower)) return new Clause("NOT is_new", null);
                if (lower.startsWith("list:") && f.length() > 5) {
                    String listId = f.substring(5).trim();
                    if ("BATCH".equals(listId) || "USERS".equals(listId)) {
                        return new Clause("list_kind = '" + listId + "'", null);
                    }
                    if (!listId.isEmpty()) return new Clause("list_kind = 'LIST' AND list_id = :listId", listId);
                }
            }
            case "DEMOS_SCHEDULED" -> {
                if ("done".equals(lower)) return new Clause("r.outcome = 'COMPLETED'", null);
                if ("no_show".equals(lower)) return new Clause("r.outcome = 'NO_SHOW'", null);
                if ("not_marked".equals(lower)) {
                    return new Clause("COALESCE(r.outcome, '') NOT IN ('COMPLETED', 'NO_SHOW')", null);
                }
            }
            case "STATUS_CHANGES" -> {
                if ("engine".equals(lower)) return new Clause("h.source = 'ENGAGEMENT_ENGINE'", null);
                if ("team".equals(lower)) {
                    return new Clause("h.source IN (" + EngagementDailyReportSql.HUMAN_STATUS_SOURCES + ")", null);
                }
                if ("automation".equals(lower)) {
                    return new Clause("COALESCE(h.source, '') NOT IN ('ENGAGEMENT_ENGINE', "
                            + EngagementDailyReportSql.HUMAN_STATUS_SOURCES + ")", null);
                }
            }
            case "TEMPLATES_CREATED" -> {
                String sql = TEMPLATE_FILTERS.get(lower);
                if (sql != null) return new Clause(sql, null);
            }
            default -> {
            }
        }
        throw new InvalidRequestException("filter '" + f + "' does not apply to " + kind);
    }

    /** The search condition ("TRUE" for none), binding :q (and :qDigits for a phone-like search). */
    static String searchSql(String kind, String search, MapSqlParameterSource p) {
        if (search == null || search.isBlank()) return "TRUE";
        String s = search.trim();
        p.addValue("q", "%" + escapeLike(s) + "%");
        String digits = s.replaceAll("\\D", "");
        boolean byDigits = digits.length() >= MIN_PHONE_DIGITS;
        if (byDigits) p.addValue("qDigits", "%" + digits + "%");
        return EngagementReportItemsSql.search(kind.startsWith("DEMOS_"), byDigits);
    }

    /** Template search: on the template's name ("TRUE" for none), binding :q. */
    static String templateSearchSql(String search, MapSqlParameterSource p) {
        if (search == null || search.isBlank()) return "TRUE";
        p.addValue("q", "%" + escapeLike(search.trim()) + "%");
        return "p.name ILIKE :q";
    }

    /**
     * A proposed template as an item: no lead, so the lead fields are null. Meta writes the literal
     * "NONE" as the rejection reason of a template it did not reject; that is no reason.
     */
    static Item templateItem(Map<String, Object> r) {
        String reason = (String) r.get("rejection_reason");
        if (reason != null && (reason.isBlank() || "NONE".equalsIgnoreCase(reason.trim()))) reason = null;
        return new Item(null, null, null, null, null, (String) r.get("engine_id"), (String) r.get("engine_name"),
                null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null,
                (String) r.get("name"), (String) r.get("language"), (String) r.get("proposed_category"),
                (String) r.get("meta_category"), (String) r.get("status"), reason,
                EngagementReportDay.iso(ldt(r.get("created_at"))), EngagementReportDay.iso(ldt(r.get("submitted_at"))));
    }

    private static java.time.LocalDateTime ldt(Object v) {
        return v instanceof java.sql.Timestamp t ? t.toLocalDateTime()
                : v instanceof java.time.LocalDateTime l ? l : null;
    }

    /** LIKE wildcards typed by the user match themselves (the default escape is a backslash). */
    static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    // ── rows → items ─────────────────────────────────────────────────────────

    Item item(String kind, ItemRow r, Map<String, String> names, String convertedLabel) {
        String name = first(r.stName(), r.leadName(), r.invName());
        String phone = first(r.stPhone(), r.leadPhone(), r.invPhone());
        String email = first(realEmail(r.stEmail()), realEmail(r.leadEmail()), realEmail(r.invEmail()));
        boolean leads = "LEADS_ADDED".equals(kind);
        boolean demos = kind.startsWith("DEMOS_");
        boolean moves = "STATUS_CHANGES".equals(kind) || "CONVERSIONS".equals(kind);
        String listId = null, listName = null;
        if (leads) {
            boolean list = "LIST".equals(r.listKind());
            listId = list ? r.listId() : r.listKind();
            listName = list ? r.listName() : "BATCH".equals(r.listKind()) ? "Batch members" : "Individual users";
        }
        String toStatus = moves && r.toStatus() == null && "CONVERSIONS".equals(kind) ? convertedLabel : r.toStatus();
        return new Item(name, email, phone, r.audienceResponseId(), r.userId(), r.engineId(), r.engineName(),
                listId, listName, leads ? Boolean.TRUE.equals(r.isNew()) : null,
                leads ? EngagementReportDay.iso(r.leadCreatedAt()) : null,
                leads ? EngagementReportDay.iso(r.joinedAt()) : null,
                demos ? r.bookingId() : null,
                demos ? EngagementReportDay.iso(r.bookedAt()) : null,
                demos ? EngagementReportDay.iso(r.scheduledStart()) : null,
                demos ? r.bookingStatus() : null,
                demos ? r.outcome() : null,
                demos ? names.get(r.hostUserId()) : null,
                moves ? r.fromStatus() : null,
                moves ? toStatus : null,
                moves ? r.actor() : null,
                moves ? r.source() : null,
                moves ? names.get(r.changedByUserId()) : null,
                moves ? EngagementReportDay.iso(r.changedAt()) : null,
                null, null, null, null, null, null, null, null);
    }

    /** Demo hosts and the people who changed a status, by user id; empty when auth_service fails. */
    private Map<String, String> staffNames(List<ItemRow> rows) {
        Set<String> ids = new LinkedHashSet<>();
        for (ItemRow r : rows) {
            if (r.hostUserId() != null) ids.add(r.hostUserId());
            if (r.changedByUserId() != null) ids.add(r.changedByUserId());
        }
        if (ids.isEmpty()) return Map.of();
        Map<String, String> out = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(ids))) {
                if (u != null && u.getId() != null) out.put(u.getId(), u.getFullName());
            }
        } catch (Exception e) {
            log.warn("[EngagementReportItems] staff name lookup failed: {}", e.getMessage());
        }
        return out;
    }

    /** A synthesized placeholder address is no email (ContactResolver's rule). */
    private String realEmail(String email) {
        return email == null || email.isBlank() || placeholderEmailService.isPlaceholder(email) ? null : email;
    }

    private static String first(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v;
        return null;
    }

    private <T> T inTx(Supplier<T> body) {
        return readOnlyTx.execute(status -> {
            jdbc.getJdbcTemplate().execute(STATEMENT_TIMEOUT);
            return body.get();
        });
    }
}
