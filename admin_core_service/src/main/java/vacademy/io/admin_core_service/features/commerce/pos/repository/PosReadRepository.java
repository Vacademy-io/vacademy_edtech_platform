package vacademy.io.admin_core_service.features.commerce.pos.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The counter's native reads: the catalogue of the till, the approvers, and the facts of a
 * session's day report. Every query names the institute first; the session's facts are read by
 * {@code pos_session_id} (indexed on orders, tenders and refunds). No query reads a cost.
 * The caller provides the transaction.
 */
@Repository
public class PosReadRepository {

    @PersistenceContext
    private EntityManager entityManager;

    // ================================================================== catalogue

    /** A sellable variant's codes. {@code productId} is the product's package id. */
    public record VariantCodes(String packageSessionId, String productId, String labelCode, String barcode,
                               String stockMode) {
    }

    private static final String VARIANT_SELECT = """
            SELECT v.package_session_id, v.package_id, v.label_code, v.barcode, p.stock_mode
            FROM commerce_variant v
            JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id
            WHERE v.institute_id = :instituteId AND v.status = 'ACTIVE' AND p.status = 'ACTIVE'
            """;

    /** ACTIVE variants of ACTIVE products, by SKU, at most {@code limit}. */
    public List<VariantCodes> activeVariants(String instituteId, int limit) {
        return variantCodes(entityManager.createNativeQuery(VARIANT_SELECT + " ORDER BY v.sku LIMIT :limit")
                .setParameter("instituteId", instituteId)
                .setParameter("limit", limit));
    }

    /**
     * ACTIVE variants whose product name (any language) contains {@code text} or whose SKU starts
     * with it, ignoring case. {@code text} is escaped for LIKE here.
     */
    public List<VariantCodes> searchVariants(String instituteId, String text, int limit) {
        String lower = escapeLike(text.toLowerCase(java.util.Locale.ROOT));
        return variantCodes(entityManager.createNativeQuery(VARIANT_SELECT + """
                          AND (LOWER(v.sku) LIKE :prefix ESCAPE '\\'
                               OR EXISTS (SELECT 1 FROM commerce_product_translation t
                                          WHERE t.institute_id = v.institute_id AND t.package_id = v.package_id
                                            AND LOWER(t.name) LIKE :contains ESCAPE '\\'))
                        ORDER BY v.sku LIMIT :limit
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("prefix", lower + "%")
                .setParameter("contains", "%" + lower + "%")
                .setParameter("limit", limit));
    }

    /** The codes of some variants of the institute (any status). */
    public List<VariantCodes> variantCodes(String instituteId, Collection<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return List.of();
        }
        return variantCodes(entityManager.createNativeQuery("""
                        SELECT v.package_session_id, v.package_id, v.label_code, v.barcode, p.stock_mode
                        FROM commerce_variant v
                        JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id
                        WHERE v.institute_id = :instituteId AND v.package_session_id IN (:ids)
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", packageSessionIds));
    }

    private List<VariantCodes> variantCodes(Query query) {
        List<VariantCodes> out = new ArrayList<>();
        for (Object[] r : rows(query)) {
            out.add(new VariantCodes(text(r[0]), text(r[1]), text(r[2]), text(r[3]), text(r[4])));
        }
        return out;
    }

    /** {@code stock_level.on_hand} by variant at one location. */
    public Map<String, Integer> onHandAt(String instituteId, String locationId) {
        Map<String, Integer> out = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT package_session_id, on_hand FROM stock_level
                        WHERE institute_id = :instituteId AND location_id = :locationId
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("locationId", locationId))) {
            out.put(text(r[0]), integer(r[1]));
        }
        return out;
    }

    // ================================================================== approvers, stock holds

    /** Users of the institute who have set an approval PIN. */
    public List<String> pinHolders(String instituteId) {
        List<String> out = new ArrayList<>();
        for (Object value : entityManager.createNativeQuery(
                        "SELECT user_id FROM commerce_staff_pin WHERE institute_id = :instituteId ORDER BY user_id")
                .setParameter("instituteId", instituteId).getResultList()) {
            out.add(text(value));
        }
        return out;
    }

    /** Users assigned to a location. */
    public Set<String> staffAt(String instituteId, String locationId) {
        Set<String> out = new HashSet<>();
        for (Object value : entityManager.createNativeQuery("""
                        SELECT user_id FROM commerce_staff_location
                        WHERE institute_id = :instituteId AND location_id = :locationId
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId).getResultList()) {
            out.add(text(value));
        }
        return out;
    }

    /** Units of a variant held by unpaid online checkouts, and when the last of those holds ends. */
    public record HeldOnline(int quantity, Date until) {
    }

    public HeldOnline heldOnline(String instituteId, String packageSessionId) {
        List<Object[]> found = rows(entityManager.createNativeQuery("""
                        SELECT COALESCE(SUM(quantity), 0), MAX(expires_at) FROM stock_hold
                        WHERE package_session_id = :id AND institute_id = :instituteId AND status = 'HELD'
                        """)
                .setParameter("id", packageSessionId).setParameter("instituteId", instituteId));
        if (found.isEmpty()) {
            return new HeldOnline(0, null);
        }
        return new HeldOnline(integer(found.get(0)[0]), date(found.get(0)[1]));
    }

    /** The units of a variant still unpromised online ({@code available_slots}); null when unknown. */
    public Integer availableOnline(String packageSessionId) {
        List<?> found = entityManager.createNativeQuery("SELECT available_slots FROM package_session WHERE id = :id")
                .setParameter("id", packageSessionId).getResultList();
        return found.isEmpty() || found.get(0) == null ? null : ((Number) found.get(0)).intValue();
    }

    /** The SKU of a variant of the institute, for a sentence. */
    public String skuOf(String instituteId, String packageSessionId) {
        List<?> found = entityManager.createNativeQuery("""
                        SELECT sku FROM commerce_variant WHERE institute_id = :instituteId AND package_session_id = :id
                        """)
                .setParameter("instituteId", instituteId).setParameter("id", packageSessionId).getResultList();
        return found.isEmpty() ? null : text(found.get(0));
    }

    // ================================================================== a session's facts

    public record OrderFact(String id, String orderNumber, String status, BigDecimal total, BigDecimal discount,
                            Date createdAt) {
    }

    public record InvoiceFact(String id, String orderId, String number, String externalNumber, boolean cancelled,
                              Date createdAt) {
    }

    public record TenderFact(String orderId, String mode, BigDecimal amount, String status) {
    }

    public record RefundFact(String method, BigDecimal amount, String status) {
    }

    public record MovementFact(String type, BigDecimal amount) {
    }

    /** The POS orders of a session, oldest first. */
    public List<OrderFact> sessionOrders(String instituteId, String sessionId) {
        List<OrderFact> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT id, order_number, status, total, discount, created_at FROM commerce_order
                        WHERE pos_session_id = :sessionId AND institute_id = :instituteId AND channel = 'POS'
                        ORDER BY created_at, id
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId))) {
            out.add(new OrderFact(text(r[0]), text(r[1]), text(r[2]), money(r[3]), money(r[4]), date(r[5])));
        }
        return out;
    }

    /** The commerce documents (not credit notes) of some orders, oldest first. */
    public List<InvoiceFact> invoicesOf(String instituteId, Collection<String> orderIds) {
        if (orderIds == null || orderIds.isEmpty()) {
            return List.of();
        }
        List<InvoiceFact> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT id, commerce_order_id, invoice_number, external_invoice_number, cancelled_at, created_at
                        FROM invoice
                        WHERE commerce_order_id IN (:orderIds) AND institute_id = :instituteId
                        ORDER BY created_at, invoice_number
                        """)
                .setParameter("orderIds", orderIds).setParameter("instituteId", instituteId))) {
            out.add(new InvoiceFact(text(r[0]), text(r[1]), text(r[2]), text(r[3]), r[4] != null, date(r[5])));
        }
        return out;
    }

    /** Every tender stamped with the session. */
    public List<TenderFact> sessionTenders(String instituteId, String sessionId) {
        List<TenderFact> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT order_id, mode, amount, status FROM commerce_order_tender
                        WHERE pos_session_id = :sessionId AND institute_id = :instituteId
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId))) {
            out.add(new TenderFact(text(r[0]), text(r[1]), money(r[2]), text(r[3])));
        }
        return out;
    }

    /** Every refund stamped with the session. */
    public List<RefundFact> sessionRefunds(String instituteId, String sessionId) {
        List<RefundFact> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT method, amount, status FROM commerce_refund
                        WHERE pos_session_id = :sessionId AND institute_id = :instituteId
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId))) {
            out.add(new RefundFact(text(r[0]), money(r[1]), text(r[2])));
        }
        return out;
    }

    public List<MovementFact> sessionMovements(String instituteId, String sessionId) {
        List<MovementFact> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT type, amount FROM pos_cash_movement
                        WHERE institute_id = :instituteId AND session_id = :sessionId
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId))) {
            out.add(new MovementFact(text(r[0]), money(r[1])));
        }
        return out;
    }

    /** Tax of some documents by rate, from their lines. */
    public List<PosDtos.TaxRow> taxByRate(String instituteId, Collection<String> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) {
            return List.of();
        }
        List<PosDtos.TaxRow> out = new ArrayList<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT li.tax_rate, COALESCE(SUM(li.taxable_value), 0), COALESCE(SUM(li.cgst), 0),
                               COALESCE(SUM(li.sgst), 0), COALESCE(SUM(li.igst), 0), COALESCE(SUM(li.cess), 0)
                        FROM invoice_line_item li
                        JOIN invoice i ON i.id = li.invoice_id
                        WHERE li.invoice_id IN (:invoiceIds) AND i.institute_id = :instituteId
                        GROUP BY li.tax_rate
                        ORDER BY li.tax_rate NULLS FIRST
                        """)
                .setParameter("invoiceIds", invoiceIds).setParameter("instituteId", instituteId))) {
            out.add(new PosDtos.TaxRow(r[0] == null ? null : new BigDecimal(r[0].toString()), money(r[1]),
                    money(r[2]), money(r[3]), money(r[4]), money(r[5])));
        }
        return out;
    }

    /**
     * Returns settled through the session: a refund stamped with it, or their credit used on a
     * bill of the session (an exchange). Count and the sum of their credit.
     */
    public PosDtos.ReturnsTotal sessionReturns(String instituteId, String sessionId) {
        List<Object[]> found = rows(entityManager.createNativeQuery("""
                        SELECT COUNT(*), COALESCE(SUM(r.credit_total), 0) FROM commerce_return r
                        WHERE r.institute_id = :instituteId AND r.id IN (
                            SELECT f.return_id FROM commerce_refund f
                            WHERE f.pos_session_id = :sessionId AND f.return_id IS NOT NULL
                            UNION
                            SELECT f.return_id FROM commerce_refund f
                            WHERE f.method = 'EXCHANGE_CREDIT' AND f.return_id IS NOT NULL
                              AND f.applied_order_id IN (SELECT o.id FROM commerce_order o
                                                         WHERE o.pos_session_id = :sessionId))
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId));
        if (found.isEmpty()) {
            return new PosDtos.ReturnsTotal(0, BigDecimal.ZERO.setScale(2));
        }
        return new PosDtos.ReturnsTotal(integer(found.get(0)[0]), money(found.get(0)[1]));
    }

    // ================================================================== lists

    /** Filters of the session list; null means "any". {@code locationIds} null means every location. */
    public record SessionFilter(String registerId, String locationId, Collection<String> locationIds, String status,
                                String cashierUserId, LocalDateTime openedFrom, LocalDateTime openedBefore) {
    }

    /** One page of sessions, newest first, and the total. */
    public record SessionPage(List<PosDtos.SessionRow> rows, long total) {
    }

    public SessionPage sessions(String instituteId, SessionFilter filter, int page, int pageSize) {
        StringBuilder where = new StringBuilder(" WHERE s.institute_id = :instituteId");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("instituteId", instituteId);
        if (filter.registerId() != null) {
            where.append(" AND s.register_id = :registerId");
            params.put("registerId", filter.registerId());
        }
        if (filter.locationId() != null) {
            where.append(" AND s.location_id = :locationId");
            params.put("locationId", filter.locationId());
        }
        if (filter.locationIds() != null) {
            if (filter.locationIds().isEmpty()) {
                return new SessionPage(List.of(), 0);
            }
            where.append(" AND s.location_id IN (:locationIds)");
            params.put("locationIds", filter.locationIds());
        }
        if (filter.status() != null) {
            where.append(" AND s.status = :status");
            params.put("status", filter.status());
        }
        if (filter.cashierUserId() != null) {
            where.append(" AND s.cashier_user_id = :cashier");
            params.put("cashier", filter.cashierUserId());
        }
        if (filter.openedFrom() != null) {
            where.append(" AND s.opened_at >= :openedFrom");
            params.put("openedFrom", Timestamp.valueOf(filter.openedFrom()));
        }
        if (filter.openedBefore() != null) {
            where.append(" AND s.opened_at < :openedBefore");
            params.put("openedBefore", Timestamp.valueOf(filter.openedBefore()));
        }
        Query count = entityManager.createNativeQuery("SELECT COUNT(*) FROM pos_session s" + where);
        params.forEach(count::setParameter);
        long total = ((Number) count.getSingleResult()).longValue();
        Query list = entityManager.createNativeQuery("""
                SELECT s.id, s.status, r.code, l.name, s.cashier_user_id, s.opened_at, s.closed_at,
                       (SELECT COUNT(*) FROM commerce_order o
                        WHERE o.pos_session_id = s.id AND o.status <> 'CANCELLED'),
                       (SELECT COALESCE(SUM(o.total), 0) FROM commerce_order o
                        WHERE o.pos_session_id = s.id AND o.status <> 'CANCELLED'),
                       s.variance
                FROM pos_session s
                JOIN pos_register r ON r.id = s.register_id
                LEFT JOIN stock_location l ON l.id = s.location_id
                """ + where + " ORDER BY s.opened_at DESC, s.id DESC LIMIT :limit OFFSET :offset");
        params.forEach(list::setParameter);
        list.setParameter("limit", pageSize);
        list.setParameter("offset", (long) page * pageSize);
        List<PosDtos.SessionRow> out = new ArrayList<>();
        for (Object[] r : rows(list)) {
            out.add(new PosDtos.SessionRow(text(r[0]), text(r[1]), text(r[2]), text(r[3]), text(r[4]), date(r[5]),
                    date(r[6]), integer(r[7]), money(r[8]), r[9] == null ? null : money(r[9])));
        }
        return new SessionPage(out, total);
    }

    /** One page of a session's bills, newest first. */
    public record SalePage(List<PosDtos.SaleRow> rows, long total) {
    }

    public SalePage sessionSales(String instituteId, String sessionId, int page, int pageSize) {
        long total = ((Number) entityManager.createNativeQuery("""
                        SELECT COUNT(*) FROM commerce_order
                        WHERE pos_session_id = :sessionId AND institute_id = :instituteId AND channel = 'POS'
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId)
                .getSingleResult()).longValue();
        List<Object[]> found = rows(entityManager.createNativeQuery("""
                        SELECT o.id, o.order_number, o.channel, o.status,
                               (SELECT i.invoice_number FROM invoice i
                                WHERE i.commerce_order_id = o.id AND i.institute_id = o.institute_id
                                ORDER BY i.cancelled_at NULLS FIRST, i.created_at DESC LIMIT 1),
                               o.document_date, l.name, o.total, o.customer_name, o.customer_phone, o.created_at
                        FROM commerce_order o
                        LEFT JOIN stock_location l ON l.id = o.fulfilment_location_id
                        WHERE o.pos_session_id = :sessionId AND o.institute_id = :instituteId AND o.channel = 'POS'
                        ORDER BY o.created_at DESC, o.id DESC
                        LIMIT :limit OFFSET :offset
                        """)
                .setParameter("sessionId", sessionId).setParameter("instituteId", instituteId)
                .setParameter("limit", pageSize).setParameter("offset", (long) page * pageSize));
        Map<String, List<String>> modes = new HashMap<>();
        List<String> ids = found.stream().map(r -> text(r[0])).toList();
        if (!ids.isEmpty()) {
            for (Object[] r : rows(entityManager.createNativeQuery("""
                            SELECT order_id, mode FROM commerce_order_tender
                            WHERE order_id IN (:ids) AND status = 'RECEIVED'
                            ORDER BY created_at
                            """)
                    .setParameter("ids", ids))) {
                List<String> list = modes.computeIfAbsent(text(r[0]), k -> new ArrayList<>());
                if (!list.contains(text(r[1]))) {
                    list.add(text(r[1]));
                }
            }
        }
        List<PosDtos.SaleRow> out = new ArrayList<>();
        for (Object[] r : found) {
            String id = text(r[0]);
            out.add(new PosDtos.SaleRow(id, text(r[1]), text(r[2]), text(r[3]), text(r[4]), localDate(r[5]),
                    text(r[6]), money(r[7]), text(r[8]), last4(text(r[9])), date(r[10]),
                    modes.getOrDefault(id, List.of())));
        }
        return new SalePage(out, total);
    }

    // ================================================================== helpers

    @SuppressWarnings("unchecked")
    private static List<Object[]> rows(Query query) {
        List<Object[]> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            out.add(row instanceof Object[] array ? array : new Object[]{row});
        }
        return out;
    }

    static String escapeLike(String text) {
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    public static String last4(String phone) {
        return phone == null || phone.length() < 4 ? null : phone.substring(phone.length() - 4);
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static int integer(Object value) {
        return value == null ? 0 : ((Number) value).intValue();
    }

    private static BigDecimal money(Object value) {
        if (value == null) {
            return BigDecimal.ZERO.setScale(2);
        }
        BigDecimal number = value instanceof BigDecimal b ? b : new BigDecimal(value.toString());
        return number.setScale(2, java.math.RoundingMode.HALF_UP);
    }

    private static Date date(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Date d) {
            return new Date(d.getTime());
        }
        if (value instanceof LocalDateTime t) {
            return Timestamp.valueOf(t);
        }
        if (value instanceof java.time.Instant i) {
            return Date.from(i);
        }
        if (value instanceof java.time.OffsetDateTime o) {
            return Date.from(o.toInstant());
        }
        return null;
    }

    private static LocalDate localDate(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof java.sql.Date d) {
            return d.toLocalDate();
        }
        if (value instanceof LocalDate d) {
            return d;
        }
        return LocalDate.parse(value.toString().substring(0, 10));
    }
}
