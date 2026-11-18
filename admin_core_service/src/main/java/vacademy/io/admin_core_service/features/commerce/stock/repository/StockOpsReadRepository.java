package vacademy.io.admin_core_service.features.commerce.stock.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Native reads of the stock operations (WP-40): item facts, the overview and low-stock reads,
 * the variant picker, the facts of a count, movement enrichment and the movement export. Every
 * query names the institute first. The caller provides the transaction. Cost is read only where
 * a service needs it for an approval decision or a cost viewer; it is never put in an answer here.
 */
@Repository
public class StockOpsReadRepository {

    /** A list parameter cannot be empty in SQL; an unused list carries one value no id has. */
    private static final List<String> NONE = List.of("-");

    @PersistenceContext
    private EntityManager entityManager;

    // ================================================================== item facts

    /**
     * What the stock screens show of a variant. {@code productName} is the English name, else the
     * first other name, else the legacy package name. {@code costPrice} is for approval decisions
     * and cost viewers only.
     */
    public record ItemFacts(String packageSessionId, String packageId, String sku, String productName,
                            Map<String, String> names, String variantName, String stockMode, String stockPolicy,
                            String variantStatus, String productStatus, String unit, int qtyScale, int qtyStep,
                            String labelCode, String barcode, String taxClassId, String hsnCode,
                            BigDecimal costPrice) {

        public boolean piece() {
            return "PIECE".equals(stockMode);
        }

        public boolean tracked() {
            return !"UNTRACKED".equals(stockPolicy);
        }

        public boolean archived() {
            return "ARCHIVED".equals(variantStatus) || "ARCHIVED".equals(productStatus);
        }
    }

    private static final String FACTS = """
            SELECT cv.package_session_id, cv.package_id, cv.sku, p.package_name, ps.name, cp.stock_mode,
                   cv.stock_policy, cv.status, cp.status, cp.unit, cp.qty_scale, cp.qty_step, cv.label_code,
                   cv.barcode, cp.tax_class_id, tc.hsn_code, cv.cost_price
            FROM commerce_variant cv
            JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
            LEFT JOIN package_session ps ON ps.id = cv.package_session_id
            LEFT JOIN package p ON p.id = cv.package_id
            LEFT JOIN commerce_tax_class tc ON tc.id = cp.tax_class_id AND tc.institute_id = cv.institute_id
            WHERE cv.institute_id = :instituteId
            """;

    /** Facts of the variants of this institute among the ids; an id of another institute is absent. */
    public Map<String, ItemFacts> itemFacts(String instituteId, Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        if (ids.isEmpty()) {
            return Map.of();
        }
        return facts(instituteId, entityManager.createNativeQuery(FACTS + " AND cv.package_session_id IN (:ids)")
                .setParameter("instituteId", instituteId).setParameter("ids", ids));
    }

    private Map<String, ItemFacts> facts(String instituteId, Query query) {
        List<Object[]> rows = rows(query);
        if (rows.isEmpty()) {
            return Map.of();
        }
        Set<String> packageIds = new HashSet<>();
        rows.forEach(r -> packageIds.add(text(r[1])));
        Map<String, Map<String, String>> names = names(instituteId, packageIds);
        Map<String, ItemFacts> out = new LinkedHashMap<>();
        for (Object[] r : rows) {
            Map<String, String> productNames = names.getOrDefault(text(r[1]), Map.of());
            out.put(text(r[0]), new ItemFacts(text(r[0]), text(r[1]), text(r[2]),
                    displayName(productNames, text(r[3])), productNames, text(r[4]), text(r[5]), text(r[6]),
                    text(r[7]), text(r[8]), text(r[9]), intOr(r[10], 1), intOr(r[11], 1), text(r[12]),
                    text(r[13]), text(r[14]), text(r[15]), decimal(r[16])));
        }
        return out;
    }

    /** Product names by package id, then locale. */
    public Map<String, Map<String, String>> names(String instituteId, Collection<String> packageIds) {
        List<String> ids = clean(packageIds);
        Map<String, Map<String, String>> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT t.package_id, t.locale, t.name FROM commerce_product_translation t
                        WHERE t.institute_id = :instituteId AND t.package_id IN (:ids)
                        ORDER BY t.package_id, t.locale
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids))) {
            out.computeIfAbsent(text(r[0]), k -> new LinkedHashMap<>()).put(text(r[1]), text(r[2]));
        }
        return out;
    }

    /** The English name, else the first other one, else the legacy name. */
    public static String displayName(Map<String, String> names, String legacy) {
        if (names != null) {
            String en = names.get("en");
            if (en != null && !en.isBlank()) {
                return en;
            }
            for (String name : names.values()) {
                if (name != null && !name.isBlank()) {
                    return name;
                }
            }
        }
        return legacy;
    }

    /** Piece codes by piece id. */
    public Map<String, String> pieceCodes(String instituteId, Collection<String> pieceIds) {
        List<String> ids = clean(pieceIds);
        Map<String, String> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT cp.id, cp.code FROM commerce_piece cp
                        WHERE cp.institute_id = :instituteId AND cp.id IN (:ids)
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids))) {
            out.put(text(r[0]), text(r[1]));
        }
        return out;
    }

    /** Collection names (English, else Hindi, else the slug) by id, of this institute. */
    public Map<String, String> collectionNames(String instituteId, Collection<String> collectionIds) {
        List<String> ids = clean(collectionIds);
        Map<String, String> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT c.id, COALESCE(c.name_i18n ->> 'en', c.name_i18n ->> 'hi', c.slug)
                        FROM commerce_collection c
                        WHERE c.institute_id = :instituteId AND c.id IN (:ids)
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids))) {
            out.put(text(r[0]), text(r[1]));
        }
        return out;
    }

    /** Whether the product (package id) is in the collection. */
    public boolean inCollection(String instituteId, String collectionId, String packageId) {
        return !entityManager.createNativeQuery("""
                        SELECT 1 FROM commerce_product_collection pc
                        WHERE pc.institute_id = :instituteId AND pc.collection_id = :collectionId
                          AND pc.package_id = :packageId
                        """)
                .setParameter("instituteId", instituteId).setParameter("collectionId", collectionId)
                .setParameter("packageId", packageId).getResultList().isEmpty();
    }

    // ================================================================== levels, online counters

    /** On hand by package session at one location (no row: absent). */
    public Map<String, Integer> onHandAt(String instituteId, String locationId, Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, Integer> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sl.package_session_id, sl.on_hand FROM stock_level sl
                        WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId
                          AND sl.package_session_id IN (:ids)
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("ids", ids))) {
            out.put(text(r[0]), intOr(r[1], 0));
        }
        return out;
    }

    public record LevelAt(String locationId, String packageSessionId, int onHand, Integer reorderLevel) {
    }

    /** Level rows of the variants at the locations (null locations: every location). */
    public List<LevelAt> levels(String instituteId, Collection<String> locationIds,
                                Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        if (ids.isEmpty() || (locationIds != null && locationIds.isEmpty())) {
            return List.of();
        }
        boolean all = locationIds == null;
        List<LevelAt> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sl.location_id, sl.package_session_id, sl.on_hand, sl.reorder_level FROM stock_level sl
                        WHERE sl.institute_id = :instituteId AND sl.package_session_id IN (:ids)
                          AND (:all = TRUE OR sl.location_id IN (:locationIds))
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids).setParameter("all", all)
                .setParameter("locationIds", all ? NONE : clean(locationIds)))) {
            out.add(new LevelAt(text(r[0]), text(r[1]), intOr(r[2], 0), integerOrNull(r[3])));
        }
        return out;
    }

    /** Units held by unpaid online checkouts, by package session. */
    public Map<String, Integer> heldOnline(String instituteId, Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, Integer> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sh.package_session_id, COALESCE(SUM(sh.quantity), 0) FROM stock_hold sh
                        WHERE sh.institute_id = :instituteId AND sh.package_session_id IN (:ids) AND sh.status = 'HELD'
                        GROUP BY sh.package_session_id
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids))) {
            out.put(text(r[0]), intOr(r[1], 0));
        }
        return out;
    }

    /** {@code available_slots - sellable_deficit} by package session (the website's sellable units). */
    public Map<String, Integer> sellableOnline(String instituteId, Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, Integer> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT cv.package_session_id, COALESCE(ps.available_slots, 0) - COALESCE(cv.sellable_deficit, 0)
                        FROM commerce_variant cv
                        JOIN package_session ps ON ps.id = cv.package_session_id
                        WHERE cv.institute_id = :instituteId AND cv.package_session_id IN (:ids)
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids))) {
            out.put(text(r[0]), intOr(r[1], 0));
        }
        return out;
    }

    /** The location that sells online (at most one in Phase 1), or null. */
    public String onlineLocationId(String instituteId) {
        List<?> found = entityManager.createNativeQuery("""
                        SELECT l.id FROM stock_location l WHERE l.institute_id = :instituteId AND l.sells_online
                        ORDER BY l.code LIMIT 1
                        """)
                .setParameter("instituteId", instituteId).getResultList();
        return found.isEmpty() ? null : text(found.get(0));
    }

    /**
     * Units on DISPATCHED transfers of each variant from or to one of the locations (null: any),
     * by package session.
     */
    public Map<String, Integer> inTransit(String instituteId, Collection<String> locationIds,
                                          Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, Integer> out = new HashMap<>();
        if (ids.isEmpty() || (locationIds != null && locationIds.isEmpty())) {
            return out;
        }
        boolean all = locationIds == null;
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT l.package_session_id, COALESCE(SUM(l.qty_sent), 0)
                        FROM stock_transfer t
                        JOIN stock_transfer_line l ON l.transfer_id = t.id AND l.institute_id = t.institute_id
                        WHERE t.institute_id = :instituteId AND t.status = 'DISPATCHED'
                          AND l.package_session_id IN (:ids)
                          AND (:all = TRUE OR t.from_location_id IN (:locationIds) OR t.to_location_id IN (:locationIds))
                        GROUP BY l.package_session_id
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids).setParameter("all", all)
                .setParameter("locationIds", all ? NONE : clean(locationIds)))) {
            out.put(text(r[0]), intOr(r[1], 0));
        }
        return out;
    }

    // ================================================================== overview

    /**
     * The variants of the Stock tab, a page and the total. Without {@code q}: TRACKED variants
     * with a level row at a listed location; with {@code q}: TRACKED variants that match it (SKU,
     * package or variant name, any product name). {@code filter} ALL, LOW (a listed level at or
     * below its reorder level) or OUT (nothing on hand at the listed locations).
     */
    public record OverviewPage(List<String> packageSessionIds, long total) {
    }

    public OverviewPage overview(String instituteId, Collection<String> locationIds, String likeQ, String filter,
                                 String collectionId, int page, int size) {
        String where = """
                FROM commerce_variant cv
                JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
                LEFT JOIN package_session ps ON ps.id = cv.package_session_id
                LEFT JOIN package p ON p.id = cv.package_id
                WHERE cv.institute_id = :instituteId AND cv.stock_policy = 'TRACKED'
                  AND ((CAST(:q AS varchar) IS NULL AND EXISTS (
                          SELECT 1 FROM stock_level sl WHERE sl.institute_id = cv.institute_id
                            AND sl.package_session_id = cv.package_session_id AND sl.location_id IN (:locationIds)))
                       OR (CAST(:q AS varchar) IS NOT NULL AND (lower(cv.sku) LIKE CAST(:q AS varchar)
                            OR lower(p.package_name) LIKE CAST(:q AS varchar)
                            OR lower(ps.name) LIKE CAST(:q AS varchar)
                            OR EXISTS (SELECT 1 FROM commerce_product_translation t
                                       WHERE t.institute_id = cv.institute_id AND t.package_id = cv.package_id
                                         AND lower(t.name) LIKE CAST(:q AS varchar)))))
                  AND (CAST(:collectionId AS varchar) IS NULL OR EXISTS (
                          SELECT 1 FROM commerce_product_collection pc WHERE pc.institute_id = cv.institute_id
                            AND pc.collection_id = CAST(:collectionId AS varchar) AND pc.package_id = cv.package_id))
                  AND (:filter = 'ALL'
                       OR (:filter = 'LOW' AND EXISTS (
                          SELECT 1 FROM stock_level sl WHERE sl.institute_id = cv.institute_id
                            AND sl.package_session_id = cv.package_session_id AND sl.location_id IN (:locationIds)
                            AND sl.reorder_level IS NOT NULL AND sl.on_hand <= sl.reorder_level))
                       OR (:filter = 'OUT' AND COALESCE((
                          SELECT SUM(sl.on_hand) FROM stock_level sl WHERE sl.institute_id = cv.institute_id
                            AND sl.package_session_id = cv.package_session_id
                            AND sl.location_id IN (:locationIds)), 0) = 0))
                """;
        List<String> ids = new ArrayList<>();
        for (Object value : bind(entityManager.createNativeQuery("SELECT cv.package_session_id " + where
                        + " ORDER BY cv.sku, cv.package_session_id LIMIT :limit OFFSET :offset"),
                instituteId, locationIds, likeQ, filter, collectionId)
                .setParameter("limit", size).setParameter("offset", (long) page * size).getResultList()) {
            ids.add(text(value));
        }
        Object total = bind(entityManager.createNativeQuery("SELECT COUNT(*) " + where), instituteId, locationIds,
                likeQ, filter, collectionId).getSingleResult();
        return new OverviewPage(ids, ((Number) total).longValue());
    }

    private static Query bind(Query query, String instituteId, Collection<String> locationIds, String likeQ,
                              String filter, String collectionId) {
        return query.setParameter("instituteId", instituteId)
                .setParameter("locationIds", clean(locationIds).isEmpty() ? NONE : clean(locationIds))
                .setParameter("q", likeQ).setParameter("filter", filter).setParameter("collectionId", collectionId);
    }

    // ================================================================== low stock

    public record ReorderRow(String packageSessionId, int onHand, int reorderLevel) {
    }

    /** Level rows at the location at or below their reorder level, most short first, then SKU. */
    public List<ReorderRow> reorderRows(String instituteId, String locationId, int page, int size) {
        List<ReorderRow> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sl.package_session_id, sl.on_hand, sl.reorder_level FROM stock_level sl
                        JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                                AND cv.institute_id = sl.institute_id
                        WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId
                          AND cv.stock_policy = 'TRACKED'
                          AND sl.reorder_level IS NOT NULL AND sl.on_hand <= sl.reorder_level
                        ORDER BY (sl.reorder_level - sl.on_hand) DESC, cv.sku, sl.package_session_id
                        LIMIT :limit OFFSET :offset
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("limit", size).setParameter("offset", (long) page * size))) {
            out.add(new ReorderRow(text(r[0]), intOr(r[1], 0), intOr(r[2], 0)));
        }
        return out;
    }

    public long countReorderRows(String instituteId, String locationId) {
        return ((Number) entityManager.createNativeQuery("""
                        SELECT COUNT(*) FROM stock_level sl
                        JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                                AND cv.institute_id = sl.institute_id
                        WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId
                          AND cv.stock_policy = 'TRACKED'
                          AND sl.reorder_level IS NOT NULL AND sl.on_hand <= sl.reorder_level
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .getSingleResult()).longValue();
    }

    private static final String OUT_ONLINE = """
            FROM commerce_variant cv
            JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
            JOIN package_session ps ON ps.id = cv.package_session_id
            WHERE cv.institute_id = :instituteId AND cv.stock_policy = 'TRACKED'
              AND cv.status = 'ACTIVE' AND cp.status = 'ACTIVE'
              AND COALESCE(ps.available_slots, 0) - COALESCE(cv.sellable_deficit, 0) <= 0
            """;

    /** ACTIVE TRACKED variants with nothing left to sell online, by SKU. */
    public List<String> outOnline(String instituteId, int page, int size) {
        List<String> out = new ArrayList<>();
        for (Object value : entityManager.createNativeQuery("SELECT cv.package_session_id " + OUT_ONLINE
                        + " ORDER BY cv.sku, cv.package_session_id LIMIT :limit OFFSET :offset")
                .setParameter("instituteId", instituteId).setParameter("limit", size)
                .setParameter("offset", (long) page * size).getResultList()) {
            out.add(text(value));
        }
        return out;
    }

    public long countOutOnline(String instituteId) {
        return ((Number) entityManager.createNativeQuery("SELECT COUNT(*) " + OUT_ONLINE)
                .setParameter("instituteId", instituteId).getSingleResult()).longValue();
    }

    /** The time of the latest SALE or POS_SALE movement of each variant at the location. */
    public Map<String, LocalDateTime> lastSaleAt(String instituteId, String locationId,
                                                 Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, LocalDateTime> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT m.package_session_id, MAX(m.created_at) FROM stock_movement m
                        WHERE m.institute_id = :instituteId AND m.package_session_id IN (:ids)
                          AND m.location_id = :locationId AND m.type IN ('SALE', 'POS_SALE')
                        GROUP BY m.package_session_id
                        """)
                .setParameter("instituteId", instituteId).setParameter("ids", ids)
                .setParameter("locationId", locationId))) {
            out.put(text(r[0]), time(r[1]));
        }
        return out;
    }

    // ================================================================== variant picker

    /**
     * At most {@code limit} variants, DRAFT or ACTIVE (never ARCHIVED): SKU prefix, label code or
     * barcode exactly, or a name that contains the text. A blank text lists the first by SKU.
     */
    public List<String> pickVariants(String instituteId, String text, boolean includeUntracked, int limit) {
        String q = text == null || text.isBlank() ? null : text.trim();
        String prefix = q == null ? null : escapeLike(q.toLowerCase()) + "%";
        String contains = q == null ? null : "%" + escapeLike(q.toLowerCase()) + "%";
        List<String> out = new ArrayList<>();
        for (Object value : entityManager.createNativeQuery("""
                        SELECT cv.package_session_id
                        FROM commerce_variant cv
                        JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
                        LEFT JOIN package_session ps ON ps.id = cv.package_session_id
                        LEFT JOIN package p ON p.id = cv.package_id
                        WHERE cv.institute_id = :instituteId
                          AND cv.status <> 'ARCHIVED' AND cp.status <> 'ARCHIVED'
                          AND (:untracked = TRUE OR cv.stock_policy = 'TRACKED')
                          AND (CAST(:prefix AS varchar) IS NULL
                               OR lower(cv.sku) LIKE CAST(:prefix AS varchar)
                               OR cv.label_code = upper(CAST(:exact AS varchar))
                               OR cv.barcode = CAST(:exact AS varchar)
                               OR lower(p.package_name) LIKE CAST(:contains AS varchar)
                               OR lower(ps.name) LIKE CAST(:contains AS varchar)
                               OR EXISTS (SELECT 1 FROM commerce_product_translation t
                                          WHERE t.institute_id = cv.institute_id AND t.package_id = cv.package_id
                                            AND lower(t.name) LIKE CAST(:contains AS varchar)))
                        ORDER BY CASE WHEN cv.label_code = upper(CAST(:exact AS varchar))
                                        OR cv.barcode = CAST(:exact AS varchar) THEN 0 ELSE 1 END,
                                 cv.sku, cv.package_session_id
                        LIMIT :limit
                        """)
                .setParameter("instituteId", instituteId).setParameter("untracked", includeUntracked)
                .setParameter("prefix", prefix).setParameter("exact", q).setParameter("contains", contains)
                .setParameter("limit", limit).getResultList()) {
            out.add(text(value));
        }
        return out;
    }

    // ================================================================== counts

    /**
     * The level rows of a count's scope at its location, locked FOR UPDATE in package-session
     * order: TRACKED variants of the scope with stock there, and every counted one whether or not
     * it is still in the scope (whose rows the caller inserted first): a counted item that left the
     * collection is read at its real on hand, never as 0. The caller holds the location's shared
     * lock already.
     */
    public Map<String, Integer> lockScopeLevels(String instituteId, String locationId, String collectionId,
                                                Collection<String> countedPackageSessionIds) {
        return scopeLevels(instituteId, locationId, collectionId, countedPackageSessionIds, true);
    }

    /** As {@link #lockScopeLevels}, without locks (a review while the count is open). */
    public Map<String, Integer> scopeLevels(String instituteId, String locationId, String collectionId,
                                            Collection<String> countedPackageSessionIds) {
        return scopeLevels(instituteId, locationId, collectionId, countedPackageSessionIds, false);
    }

    private Map<String, Integer> scopeLevels(String instituteId, String locationId, String collectionId,
                                             Collection<String> counted, boolean lock) {
        List<String> ids = clean(counted);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sl.package_session_id, sl.on_hand FROM stock_level sl
                        JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                                AND cv.institute_id = sl.institute_id
                        WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId
                          AND cv.stock_policy = 'TRACKED'
                          AND (sl.package_session_id IN (:counted)
                               OR (sl.on_hand > 0 AND (CAST(:collectionId AS varchar) IS NULL OR EXISTS (
                                   SELECT 1 FROM commerce_product_collection pc
                                   WHERE pc.institute_id = sl.institute_id
                                     AND pc.collection_id = CAST(:collectionId AS varchar)
                                     AND pc.package_id = cv.package_id))))
                        ORDER BY sl.package_session_id
                        """ + (lock ? " FOR UPDATE OF sl" : ""))
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("counted", ids.isEmpty() ? NONE : ids).setParameter("collectionId", collectionId))) {
            out.put(text(r[0]), intOr(r[1], 0));
        }
        return out;
    }

    /**
     * Movements of a variant at a location in {@code (from, to]} (database time): how many, and
     * how many units in or out in all. A line whose stock moved while it was being scanned.
     */
    public int[] movementsBetween(String instituteId, String locationId, String packageSessionId,
                                  LocalDateTime from, LocalDateTime to) {
        Object[] r = (Object[]) entityManager.createNativeQuery("""
                        SELECT COUNT(*), COALESCE(SUM(ABS(m.quantity_delta)), 0) FROM stock_movement m
                        WHERE m.institute_id = :instituteId AND m.location_id = :locationId
                          AND m.package_session_id = :packageSessionId
                          AND m.created_at > :fromTime AND m.created_at <= :toTime
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("packageSessionId", packageSessionId).setParameter("fromTime", from)
                .setParameter("toTime", to).getSingleResult();
        return new int[]{intOr(r[0], 0), intOr(r[1], 0)};
    }

    /**
     * Packed parcel lines at the location that may have been packed at some moment since
     * {@code since}: PACKED now, unpacked after it, or with a SALE movement (ship or undo) after
     * it. Quantity units by variant (a one-of-a-kind piece is RESERVED and counted as a piece). The
     * pack time is the shipment row's database time and the ship times are the SALE movements', so
     * they compare with {@code counted_at}. ARCHITECTURE 4.8: units in a packed parcel are not on
     * the shelf.
     */
    public List<StockCountParcel> parcelsSince(String instituteId, String locationId, LocalDateTime since) {
        Map<String, StockCountParcel> lines = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT sl.id, ol.package_session_id, sl.quantity, s.created_at, s.status, s.cancelled_at
                        FROM commerce_shipment s
                        JOIN commerce_shipment_line sl ON sl.shipment_id = s.id AND sl.institute_id = s.institute_id
                        JOIN commerce_order_line ol ON ol.id = sl.order_line_id AND ol.institute_id = s.institute_id
                        WHERE s.institute_id = :instituteId AND s.location_id = :locationId
                          AND ol.package_session_id IS NOT NULL
                          AND (s.status = 'PACKED'
                               OR (s.status = 'CANCELLED' AND s.cancelled_at > :since)
                               OR EXISTS (SELECT 1 FROM stock_movement m
                                          WHERE m.institute_id = s.institute_id AND m.location_id = s.location_id
                                            AND m.package_session_id = ol.package_session_id
                                            AND m.reference_type = 'SHIPMENT_LINE' AND m.reference_id = sl.id
                                            AND m.type = 'SALE' AND m.created_at > :since))
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("since", since))) {
            lines.put(text(r[0]), new StockCountParcel(text(r[1]), intOr(r[2], 0), time(r[3]), text(r[4]), time(r[5]),
                    new ArrayList<>()));
        }
        if (lines.isEmpty()) {
            return List.of();
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT m.reference_id, m.quantity_delta, m.created_at FROM stock_movement m
                        WHERE m.institute_id = :instituteId AND m.location_id = :locationId
                          AND m.reference_type = 'SHIPMENT_LINE' AND m.type = 'SALE' AND m.reference_id IN (:lineIds)
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("lineIds", new ArrayList<>(lines.keySet())))) {
            StockCountParcel parcel = lines.get(text(r[0]));
            if (parcel != null) {
                parcel.sales().add(new ParcelSale(time(r[2]), intOr(r[1], 0)));
            }
        }
        return new ArrayList<>(lines.values());
    }

    /** A parcel line as {@code StockCountMath.Parcel} reads it. */
    public record StockCountParcel(String packageSessionId, int units, LocalDateTime packedAt, String status,
                                   LocalDateTime cancelledAt, List<ParcelSale> sales) {
    }

    /** A SALE movement of a parcel line: its database time and delta. */
    public record ParcelSale(LocalDateTime at, int delta) {
    }

    /** Whether the location is one of this institute's. */
    public boolean locationOfInstitute(String instituteId, String locationId) {
        if (locationId == null) {
            return false;
        }
        return !entityManager.createNativeQuery(
                        "SELECT 1 FROM stock_location WHERE institute_id = :instituteId AND id = :locationId")
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setMaxResults(1).getResultList().isEmpty();
    }

    /** Pieces IN_STOCK or RESERVED at the location, by variant, in code order (labels for a price change). */
    public Map<String, List<String>> piecesOnShelf(String instituteId, String locationId,
                                                   Collection<String> packageSessionIds) {
        List<String> ids = clean(packageSessionIds);
        Map<String, List<String>> out = new LinkedHashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT pc.package_session_id, pc.id FROM commerce_piece pc
                        WHERE pc.institute_id = :instituteId AND pc.location_id = :locationId
                          AND pc.status IN ('IN_STOCK', 'RESERVED') AND pc.package_session_id IN (:ids)
                        ORDER BY pc.package_session_id, pc.code
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("ids", ids))) {
            out.computeIfAbsent(text(r[0]), k -> new ArrayList<>()).add(text(r[1]));
        }
        return out;
    }

    /** A piece as the count review sees it. */
    public record PieceState(String pieceId, String code, String packageSessionId, String status,
                             String locationId, BigDecimal unitCost, boolean movedHereSince) {
    }

    /**
     * Pieces IN_STOCK or RESERVED at the location, of PIECE variants of the scope, each with
     * whether it had a movement at this location after {@code since} (it arrived during the count).
     */
    public List<PieceState> piecesAt(String instituteId, String locationId, String collectionId,
                                     LocalDateTime since) {
        List<PieceState> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT pc.id, pc.code, pc.package_session_id, pc.status, pc.location_id, pc.unit_cost,
                               EXISTS (SELECT 1 FROM stock_movement m
                                       WHERE m.institute_id = pc.institute_id
                                         AND m.package_session_id = pc.package_session_id
                                         AND m.created_at > :since AND m.piece_id = pc.id
                                         AND m.location_id = :locationId)
                        FROM commerce_piece pc
                        JOIN commerce_variant cv ON cv.package_session_id = pc.package_session_id
                                                AND cv.institute_id = pc.institute_id
                        WHERE pc.institute_id = :instituteId AND pc.location_id = :locationId
                          AND pc.status IN ('IN_STOCK', 'RESERVED') AND cv.stock_policy = 'TRACKED'
                          AND (CAST(:collectionId AS varchar) IS NULL OR EXISTS (
                               SELECT 1 FROM commerce_product_collection c WHERE c.institute_id = pc.institute_id
                                 AND c.collection_id = CAST(:collectionId AS varchar)
                                 AND c.package_id = cv.package_id))
                        ORDER BY pc.package_session_id, pc.code
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId)
                .setParameter("collectionId", collectionId).setParameter("since", since))) {
            out.add(new PieceState(text(r[0]), text(r[1]), text(r[2]), text(r[3]), text(r[4]), decimal(r[5]),
                    Boolean.TRUE.equals(r[6])));
        }
        return out;
    }

    /** The current state of the pieces scanned on a count, by piece id. */
    public Map<String, PieceState> scannedPieces(String instituteId, String countId) {
        Map<String, PieceState> out = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT pc.id, pc.code, pc.package_session_id, pc.status, pc.location_id, pc.unit_cost
                        FROM stock_count_line l
                        JOIN commerce_piece pc ON pc.id = l.piece_id AND pc.institute_id = l.institute_id
                        WHERE l.institute_id = :instituteId AND l.count_id = :countId AND l.piece_id IS NOT NULL
                        ORDER BY pc.code
                        """)
                .setParameter("instituteId", instituteId).setParameter("countId", countId))) {
            out.put(text(r[0]), new PieceState(text(r[0]), text(r[1]), text(r[2]), text(r[3]), text(r[4]),
                    decimal(r[5]), false));
        }
        return out;
    }

    // ================================================================== movement enrichment, export

    /** What a movement's reference reads as: a number, and the order it belongs to (if any). */
    public record ReferenceLabel(String label, String orderId) {
    }

    /**
     * Labels of movement references, keyed {@code TYPE:id}: receipts, transfers, counts, order
     * lines, shipment lines and return lines; and piece codes keyed {@code PIECE:id}. One statement.
     */
    public Map<String, ReferenceLabel> referenceLabels(String instituteId, Map<String, Set<String>> idsByType,
                                                       Collection<String> pieceIds) {
        Map<String, ReferenceLabel> out = new HashMap<>();
        Map<String, List<String>> ids = new HashMap<>();
        for (String type : List.of("STOCK_RECEIPT", "STOCK_TRANSFER", "STOCK_COUNT", "ORDER_LINE", "SHIPMENT_LINE",
                "RETURN_LINE")) {
            ids.put(type, clean(idsByType == null ? null : idsByType.get(type)));
        }
        List<String> pieces = clean(pieceIds);
        boolean any = !pieces.isEmpty() || ids.values().stream().anyMatch(list -> !list.isEmpty());
        if (!any) {
            return out;
        }
        Query query = entityManager.createNativeQuery("""
                SELECT 'STOCK_RECEIPT', r.id, r.receipt_number, CAST(NULL AS varchar) FROM stock_receipt r
                WHERE r.institute_id = :instituteId AND r.id IN (:receipts)
                UNION ALL
                SELECT 'STOCK_TRANSFER', t.id, t.transfer_number, CAST(NULL AS varchar) FROM stock_transfer t
                WHERE t.institute_id = :instituteId AND t.id IN (:transfers)
                UNION ALL
                SELECT 'STOCK_COUNT', c.id, c.count_number, CAST(NULL AS varchar) FROM stock_count c
                WHERE c.institute_id = :instituteId AND c.id IN (:counts)
                UNION ALL
                SELECT 'ORDER_LINE', ol.id, o.order_number, o.id FROM commerce_order_line ol
                JOIN commerce_order o ON o.id = ol.order_id
                WHERE ol.institute_id = :instituteId AND ol.id IN (:orderLines)
                UNION ALL
                SELECT 'SHIPMENT_LINE', sl.id, o.order_number, o.id FROM commerce_shipment_line sl
                JOIN commerce_order_line ol ON ol.id = sl.order_line_id
                JOIN commerce_order o ON o.id = ol.order_id
                WHERE sl.institute_id = :instituteId AND sl.id IN (:shipmentLines)
                UNION ALL
                SELECT 'RETURN_LINE', rl.id, cr.return_number, cr.order_id FROM commerce_return_line rl
                JOIN commerce_return cr ON cr.id = rl.return_id
                WHERE rl.institute_id = :instituteId AND rl.id IN (:returnLines)
                UNION ALL
                SELECT 'PIECE', pc.id, pc.code, CAST(NULL AS varchar) FROM commerce_piece pc
                WHERE pc.institute_id = :instituteId AND pc.id IN (:pieces)
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("receipts", orNone(ids.get("STOCK_RECEIPT")))
                .setParameter("transfers", orNone(ids.get("STOCK_TRANSFER")))
                .setParameter("counts", orNone(ids.get("STOCK_COUNT")))
                .setParameter("orderLines", orNone(ids.get("ORDER_LINE")))
                .setParameter("shipmentLines", orNone(ids.get("SHIPMENT_LINE")))
                .setParameter("returnLines", orNone(ids.get("RETURN_LINE")))
                .setParameter("pieces", orNone(pieces));
        for (Object[] r : rows(query)) {
            out.put(text(r[0]) + ":" + text(r[1]), new ReferenceLabel(text(r[2]), text(r[3])));
        }
        return out;
    }

    /** One row of the movement export, in ledger order. */
    public record ExportRow(LocalDateTime createdAt, String locationCode, String packageSessionId, String pieceId,
                            String type, int quantityDelta, int balanceAfter, String referenceType,
                            String referenceId, String reason, String note, String actorUserId, BigDecimal unitCost) {
    }

    /**
     * Movements for the export, oldest first, at most {@code limit} rows (the caller asks for one
     * more than it allows, to tell that the range is too large).
     */
    public List<ExportRow> exportRows(String instituteId, Collection<String> locationIds, String packageSessionId,
                                      String type, LocalDateTime from, LocalDateTime to, int limit) {
        boolean all = locationIds == null;
        List<ExportRow> out = new ArrayList<>();
        if (!all && locationIds.isEmpty()) {
            return out;
        }
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT m.created_at, l.code, m.package_session_id, m.piece_id, m.type, m.quantity_delta,
                               m.balance_after, m.reference_type, m.reference_id, m.reason, m.note, m.actor_user_id,
                               m.unit_cost
                        FROM stock_movement m
                        JOIN stock_location l ON l.id = m.location_id
                        WHERE m.institute_id = :instituteId
                          AND (:all = TRUE OR m.location_id IN (:locationIds))
                          AND (CAST(:packageSessionId AS varchar) IS NULL
                               OR m.package_session_id = CAST(:packageSessionId AS varchar))
                          AND (CAST(:type AS varchar) IS NULL OR m.type = CAST(:type AS varchar))
                          AND m.created_at >= :fromTime AND m.created_at < :toTime
                        ORDER BY m.created_at, m.id
                        LIMIT :limit
                        """)
                .setParameter("instituteId", instituteId).setParameter("all", all)
                .setParameter("locationIds", all ? NONE : clean(locationIds))
                .setParameter("packageSessionId", packageSessionId).setParameter("type", type)
                .setParameter("fromTime", from).setParameter("toTime", to).setParameter("limit", limit))) {
            out.add(new ExportRow(time(r[0]), text(r[1]), text(r[2]), text(r[3]), text(r[4]), intOr(r[5], 0),
                    intOr(r[6], 0), text(r[7]), text(r[8]), text(r[9]), text(r[10]), text(r[11]), decimal(r[12])));
        }
        return out;
    }

    // ================================================================== helpers

    /** Escapes {@code \ % _} for a LIKE pattern (the default escape character). */
    public static String escapeLike(String text) {
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    @SuppressWarnings("unchecked")
    private static List<Object[]> rows(Query query) {
        List<Object[]> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            out.add(row instanceof Object[] array ? array : new Object[]{row});
        }
        return out;
    }

    private static List<String> clean(Collection<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream().filter(v -> v != null && !v.isBlank()).map(String::trim).distinct().toList();
    }

    private static List<String> orNone(List<String> values) {
        return values == null || values.isEmpty() ? NONE : values;
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static int intOr(Object value, int fallback) {
        return value == null ? fallback : ((Number) value).intValue();
    }

    private static Integer integerOrNull(Object value) {
        return value == null ? null : ((Number) value).intValue();
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof BigDecimal b ? b : new BigDecimal(value.toString());
    }

    /** A timestamp column as the JVM-local date-time it was stored as. */
    public static LocalDateTime time(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalDateTime t) {
            return t;
        }
        if (value instanceof Timestamp t) {
            return t.toLocalDateTime();
        }
        if (value instanceof OffsetDateTime t) {
            return t.atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        }
        if (value instanceof Instant t) {
            return LocalDateTime.ofInstant(t, ZoneId.systemDefault());
        }
        if (value instanceof java.util.Date d) {
            return new Timestamp(d.getTime()).toLocalDateTime();
        }
        return LocalDateTime.parse(value.toString().replace(' ', 'T'));
    }
}
