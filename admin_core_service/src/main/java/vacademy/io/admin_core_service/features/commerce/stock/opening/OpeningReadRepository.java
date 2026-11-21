package vacademy.io.admin_core_service.features.commerce.stock.opening;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Items;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.LaterCount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Receipts;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Recount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.UncostedReceipt;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

/**
 * Native, read-only reads of the opening-stock readiness (WP-53). Every query names the
 * institute first; the caller provides the (read-only) transaction.
 *
 * <p>A receipt line is costed when its cost, above zero, was typed, is the standard cost or came
 * from a bill; a running-average stand-in (PROVISIONAL), no cost or a cost of zero is not. An
 * item counts as costed when its standard cost is above zero. Count times are compared with the
 * receipt's {@code created_at}: both are database time.
 */
@Repository
public class OpeningReadRepository {

    static final int WITHOUT_COST_LIMIT = 50;
    static final int UNCOSTED_RECEIPT_LIMIT = 20;
    static final int LATER_COUNT_LIMIT = 50;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String ARCHIVED = "(cv.status = 'ARCHIVED' OR cp.status = 'ARCHIVED')";
    private static final String COSTED =
            "(l.unit_cost IS NOT NULL AND l.unit_cost > 0 AND l.cost_source IN ('TYPED', 'STANDARD', 'BILL'))";
    private static final String HAS_COST = "(cv.standard_cost IS NOT NULL AND cv.standard_cost > 0)";
    private static final String OPENING_AT = """
            r.institute_id = :instituteId AND r.location_id = :locationId
              AND r.source_kind = 'OPENING' AND r.status = 'POSTED'
            """;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * The location's goods: tracked, not archived, with stock at the location or on a posted
     * opening receipt there. Untracked items and the tracked items without a cost are also
     * counted institute-wide, as information.
     */
    public Items items(String instituteId, String locationId) {
        Object[] row = (Object[]) entityManager.createNativeQuery("""
                        WITH goods AS (
                            SELECT sl.package_session_id FROM stock_level sl
                            WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId AND sl.on_hand > 0
                            UNION
                            SELECT l.package_session_id FROM stock_receipt_line l
                            JOIN stock_receipt r ON r.id = l.receipt_id AND r.institute_id = l.institute_id
                            WHERE %3$s
                        )
                        SELECT COUNT(*) FILTER (WHERE cv.stock_policy = 'TRACKED' AND NOT %1$s
                                                AND g.package_session_id IS NOT NULL),
                               COUNT(*) FILTER (WHERE cv.stock_policy = 'TRACKED' AND NOT %1$s
                                                AND g.package_session_id IS NOT NULL AND %2$s),
                               COUNT(*) FILTER (WHERE cv.stock_policy = 'UNTRACKED' AND NOT %1$s),
                               COUNT(*) FILTER (WHERE cv.stock_policy = 'TRACKED' AND NOT %1$s AND NOT %2$s)
                        FROM commerce_variant cv
                        JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
                        LEFT JOIN goods g ON g.package_session_id = cv.package_session_id
                        WHERE cv.institute_id = :instituteId
                        """.formatted(ARCHIVED, HAS_COST, OPENING_AT))
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .getSingleResult();
        @SuppressWarnings("unchecked")
        List<Object> skus = entityManager.createNativeQuery("""
                        WITH goods AS (
                            SELECT sl.package_session_id FROM stock_level sl
                            WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId AND sl.on_hand > 0
                            UNION
                            SELECT l.package_session_id FROM stock_receipt_line l
                            JOIN stock_receipt r ON r.id = l.receipt_id AND r.institute_id = l.institute_id
                            WHERE %3$s
                        )
                        SELECT COALESCE(cv.sku, cv.package_session_id)
                        FROM commerce_variant cv
                        JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
                        JOIN goods g ON g.package_session_id = cv.package_session_id
                        WHERE cv.institute_id = :instituteId AND cv.stock_policy = 'TRACKED' AND NOT %1$s
                          AND NOT %2$s
                        ORDER BY cv.sku NULLS LAST, cv.package_session_id
                        LIMIT %4$d
                        """.formatted(ARCHIVED, HAS_COST, OPENING_AT, WITHOUT_COST_LIMIT))
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .getResultList();
        List<String> withoutCost = new ArrayList<>(skus.size());
        skus.forEach(sku -> withoutCost.add(String.valueOf(sku)));
        return new Items(num(row[0]), num(row[1]), withoutCost, num(row[2]), num(row[3]));
    }

    public Receipts receipts(String instituteId, String locationId) {
        Object[] row = (Object[]) entityManager.createNativeQuery("""
                        SELECT COUNT(DISTINCT r.id), COUNT(l.id), COALESCE(SUM(l.qty_received), 0),
                               COALESCE(SUM(l.qty_received) FILTER (WHERE %1$s), 0),
                               ROUND(SUM(l.qty_received * l.unit_cost) FILTER (WHERE %1$s), 2),
                               MAX(r.created_at)
                        FROM stock_receipt r
                        LEFT JOIN stock_receipt_line l ON l.receipt_id = r.id AND l.institute_id = r.institute_id
                        WHERE %2$s
                        """.formatted(COSTED, OPENING_AT))
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .getSingleResult();
        @SuppressWarnings("unchecked")
        List<Object[]> uncostedRows = entityManager.createNativeQuery("""
                        SELECT r.id, r.receipt_number, CAST(r.received_date AS VARCHAR),
                               COUNT(l.id) FILTER (WHERE NOT %1$s),
                               COALESCE(SUM(l.qty_received) FILTER (WHERE NOT %1$s), 0)
                        FROM stock_receipt r
                        JOIN stock_receipt_line l ON l.receipt_id = r.id AND l.institute_id = r.institute_id
                        WHERE %2$s
                        GROUP BY r.id, r.receipt_number, r.received_date
                        HAVING COUNT(l.id) FILTER (WHERE NOT %1$s) > 0
                        ORDER BY r.received_date, r.receipt_number
                        LIMIT %3$d
                        """.formatted(COSTED, OPENING_AT, UNCOSTED_RECEIPT_LIMIT))
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .getResultList();
        List<UncostedReceipt> uncosted = new ArrayList<>(uncostedRows.size());
        for (Object[] r : uncostedRows) {
            uncosted.add(new UncostedReceipt(str(r[0]), str(r[1]), str(r[2]), num(r[3]), num(r[4])));
        }
        return new Receipts(num(row[0]), num(row[1]), num(row[2]), num(row[3]), decimal(row[4]), time(row[5]),
                uncosted);
    }

    /** Counts and recounts at the location (not cancelled) that started after {@code after}, newest first. */
    public List<LaterCount> countsAfter(String instituteId, String locationId, LocalDateTime after) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT c.id, c.kind, c.status, c.started_at
                        FROM stock_count c
                        WHERE c.institute_id = :instituteId AND c.location_id = :locationId
                          AND c.started_at > :after AND c.status <> 'CANCELLED'
                        ORDER BY c.started_at DESC
                        LIMIT %d
                        """.formatted(LATER_COUNT_LIMIT))
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .setParameter("after", after)
                .getResultList();
        List<LaterCount> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(new LaterCount(str(r[0]), str(r[1]), str(r[2]), time(r[3])));
        }
        return out;
    }

    /**
     * The latest POSTED recount of the latest main count (not cancelled) that started after
     * {@code after}, with that count's status; null when that count has no posted recount.
     */
    public Recount latestRecount(String instituteId, String locationId, LocalDateTime after) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT rc.id, rc.count_number, CAST(rc.summary_json AS TEXT), m.id, m.count_number,
                               (SELECT COUNT(*) FROM stock_count_line cl
                                WHERE cl.institute_id = m.institute_id AND cl.count_id = m.id),
                               m.status
                        FROM stock_count rc
                        JOIN stock_count m ON m.id = rc.recount_of_count_id AND m.institute_id = rc.institute_id
                        WHERE rc.institute_id = :instituteId AND rc.location_id = :locationId
                          AND rc.kind = 'RECOUNT' AND rc.status = 'POSTED'
                          AND m.status <> 'CANCELLED' AND m.started_at > :after
                          AND m.id = (SELECT c.id FROM stock_count c
                                      WHERE c.institute_id = :instituteId AND c.location_id = :locationId
                                        AND c.kind = 'COUNT' AND c.status <> 'CANCELLED' AND c.started_at > :after
                                      ORDER BY c.started_at DESC, c.id DESC
                                      LIMIT 1)
                        ORDER BY rc.started_at DESC, rc.id DESC
                        LIMIT 1
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId)
                .setParameter("after", after)
                .getResultList();
        if (rows.isEmpty()) {
            return null;
        }
        Object[] r = rows.get(0);
        JsonNode agreement = agreementOf(str(r[2]));
        return new Recount(str(r[0]), str(r[1]), str(r[3]), str(r[4]), num(r[5]),
                agreement.path("compared").asInt(0), agreement.path("agreeing").asInt(0),
                percentOf(agreement),
                agreement.hasNonNull("passes") ? agreement.get("passes").asBoolean() : null, str(r[6]));
    }

    /** The {@code agreement} object of a finished recount's summary; empty when it cannot be read. */
    static JsonNode agreementOf(String summaryJson) {
        if (summaryJson == null || summaryJson.isBlank()) {
            return MAPPER.createObjectNode();
        }
        try {
            return MAPPER.readTree(summaryJson).path("agreement");
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }

    /** The stored percent, one decimal; 0.0 when absent or unreadable. */
    static BigDecimal percentOf(JsonNode agreement) {
        JsonNode percent = agreement.path("percent");
        try {
            return percent.isMissingNode() || percent.isNull() ? BigDecimal.ZERO.setScale(1)
                    : new BigDecimal(percent.asText()).setScale(1, RoundingMode.HALF_UP);
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO.setScale(1);
        }
    }

    private static long num(Object value) {
        return value instanceof Number n ? n.longValue() : 0L;
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof BigDecimal b ? b : new BigDecimal(value.toString());
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }

    private static LocalDateTime time(Object value) {
        if (value instanceof LocalDateTime t) {
            return t;
        }
        if (value instanceof Timestamp t) {
            return t.toLocalDateTime();
        }
        if (value instanceof OffsetDateTime t) {
            return t.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
        }
        if (value instanceof Instant t) {
            return LocalDateTime.ofInstant(t, ZoneOffset.UTC);
        }
        return null;
    }
}
