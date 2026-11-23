package vacademy.io.admin_core_service.features.commerce.order.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;

import java.util.Date;
import java.util.Optional;

public interface CommerceOrderRepository extends JpaRepository<CommerceOrder, String> {

    Optional<CommerceOrder> findByIdAndInstituteId(String id, String instituteId);

    Optional<CommerceOrder> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    Optional<CommerceOrder> findByInstituteIdAndOrderNumber(String instituteId, String orderNumber);

    Optional<CommerceOrder> findByPaymentGroupId(String paymentGroupId);

    /** The order row, locked FOR UPDATE: the first lock of every flow that changes an order. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM CommerceOrder o WHERE o.id = :id")
    Optional<CommerceOrder> lockById(@Param("id") String id);

    Page<CommerceOrder> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);

    Page<CommerceOrder> findByInstituteIdAndStatusOrderByCreatedAtDesc(String instituteId, String status,
                                                                       Pageable pageable);

    @Query("""
            SELECT o FROM CommerceOrder o
            WHERE o.instituteId = :instituteId
              AND (o.orderNumber = :text OR o.customerPhone = :phone)
            ORDER BY o.createdAt DESC
            """)
    Page<CommerceOrder> search(@Param("instituteId") String instituteId, @Param("text") String text,
                               @Param("phone") String phone, Pageable pageable);

    Page<CommerceOrder> findByInstituteIdAndCustomerIdOrderByCreatedAtDesc(String instituteId, String customerId,
                                                                           Pageable pageable);

    /** Unpaid online orders of a phone that still hold stock. */
    @Query(value = """
            SELECT COUNT(*) FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.customer_phone = :phone
              AND o.status = 'PENDING_PAYMENT'
            """, nativeQuery = true)
    long countOpenUnpaidByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    @Query(value = """
            SELECT COUNT(*) FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.customer_email = :email
              AND o.status = 'PENDING_PAYMENT'
            """, nativeQuery = true)
    long countOpenUnpaidByEmail(@Param("instituteId") String instituteId, @Param("email") String email);

    /**
     * Claims the right to create the gateway order. Only one caller gets 1 inside the window,
     * so a double click, a replayed checkout and a retry never talk to the gateway at once.
     * The claim lapses after {@code staleBefore}, for a caller that died in the middle.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_attempt_at = :now, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id
              AND status = 'PENDING_PAYMENT'
              AND gateway_order_id IS NULL
              AND (gateway_attempt_at IS NULL OR gateway_attempt_at < :staleBefore)
            """, nativeQuery = true)
    int claimGatewayAttempt(@Param("id") String id, @Param("now") Date now, @Param("staleBefore") Date staleBefore);

    /** Stores the gateway order once; a second writer changes nothing. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_vendor = :vendor, gateway_order_id = :gatewayOrderId, gateway_key_id = CAST(:keyId AS VARCHAR),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND gateway_order_id IS NULL
            """, nativeQuery = true)
    int storeGatewayOrder(@Param("id") String id, @Param("vendor") String vendor,
                          @Param("gatewayOrderId") String gatewayOrderId, @Param("keyId") String keyId);

    // -- Order desk (WP-30) --

    /**
     * A cash-on-delivery parcel came back: one more refusal on the customer of the order's phone.
     * One conditional UPDATE, so two RTOs of one phone both count.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_customer SET cod_refusals = cod_refusals + 1, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND phone = :phone
            """, nativeQuery = true)
    int incrementCodRefusals(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /** Open orders with a line of the variant at the location, newest first: what a stock shortfall may hit. */
    interface ShortCandidate {
        String getOrderId();
        String getLineId();
    }

    @Query(value = """
            SELECT o.id AS orderId, l.id AS lineId
            FROM commerce_order o
            JOIN commerce_order_line l ON l.order_id = o.id
            WHERE o.institute_id = :instituteId AND o.fulfilment_location_id = :locationId
              AND o.status IN ('COD_PENDING_CONFIRMATION', 'CONFIRMED', 'PACKED')
              AND l.line_type = 'ITEM' AND l.package_session_id = :packageSessionId
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT 200
            """, nativeQuery = true)
    java.util.List<ShortCandidate> findShortCandidates(@Param("instituteId") String instituteId,
                                                       @Param("locationId") String locationId,
                                                       @Param("packageSessionId") String packageSessionId);

    /**
     * Orders past their invoice point that never had a commerce document, oldest first: no
     * invoice row of the order that is not cancelled, live or credited. An order whose invoice
     * was credited in full (an unpack before a re-pack, an RTO, a credit note by hand) is never
     * listed: the backlog repairs a missed issue, it never bills again what was reversed. A
     * CONFIRMED order (of a shop that invoices at confirmation) is read whatever its age, since
     * nothing else ever issues its invoice; a PACKED or later order only when changed within the
     * lookback ({@code since}). Orders deferred by an earlier failed try ({@code sweep_retry_after})
     * are left out. Orders that never failed come first ({@code sweep_failures}), so a few orders
     * that always fail cannot take the slots of healthy ones.
     */
    @Query(value = """
            SELECT o.id FROM commerce_order o
            WHERE (o.status IN ('PACKED', 'SHIPPED', 'DELIVERED')
                   OR (o.status = 'CONFIRMED' AND EXISTS (
                        SELECT 1 FROM commerce_tax_setting ts
                        WHERE ts.institute_id = o.institute_id AND ts.invoice_at = 'CONFIRMED')))
              AND o.channel <> 'POS'
              AND o.updated_at < :before
              AND (o.status = 'CONFIRMED' OR o.updated_at >= :since)
              AND (o.sweep_retry_after IS NULL OR o.sweep_retry_after <= :now)
              AND NOT EXISTS (
                  SELECT 1 FROM invoice i
                  WHERE i.commerce_order_id = o.id AND i.cancelled_at IS NULL)
            ORDER BY o.sweep_failures ASC, o.updated_at ASC, o.id ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    java.util.List<String> findOrderIdsMissingInvoice(@Param("before") Date before, @Param("since") Date since,
                                                      @Param("now") Date now, @Param("maxRows") int maxRows);

    /** The order's invoice rows that are not cancelled (live or credited); 0 = it never had one. */
    @Query(value = "SELECT COUNT(*) FROM invoice i WHERE i.commerce_order_id = :orderId AND i.cancelled_at IS NULL",
            nativeQuery = true)
    long countInvoicesEver(@Param("orderId") String orderId);

    /**
     * A background sweep failed on the order: one more failure, and the sweeps leave it alone
     * for 1 h, 4 h, 16 h, then 24 h after each further failure (the right side reads the old
     * count). Runs in its own transaction after the failed one rolled back; never touches
     * {@code updated_at}.
     */
    @Modifying
    @Query(value = """
            UPDATE commerce_order
            SET sweep_failures = sweep_failures + 1,
                sweep_retry_after = CAST(:now AS TIMESTAMP) + make_interval(mins => CASE WHEN sweep_failures >= 3
                    THEN 1440 ELSE 60 * CAST(POWER(4, sweep_failures) AS INTEGER) END)
            WHERE id = :orderId
            """, nativeQuery = true)
    int deferSweep(@Param("orderId") String orderId, @Param("now") Date now);

    /** How often the background sweeps failed on the order. */
    @Query(value = "SELECT sweep_failures FROM commerce_order WHERE id = :orderId", nativeQuery = true)
    Integer sweepFailures(@Param("orderId") String orderId);

    /** A sweep succeeded on the order (or staff moved it on): its failures and deferral are cleared. */
    @Modifying
    @Query(value = """
            UPDATE commerce_order SET sweep_failures = 0, sweep_retry_after = NULL
            WHERE id = :orderId AND (sweep_failures > 0 OR sweep_retry_after IS NOT NULL)
            """, nativeQuery = true)
    int clearSweep(@Param("orderId") String orderId);

    /**
     * The staff order list with its filters. Every filter is optional (null = any). {@code queue}
     * is one of the desk queues (TO_CONFIRM, TO_PACK, TO_SHIP, IN_TRANSIT, COD_TO_COLLECT,
     * RTO_TO_RECEIVE, STOCK_SHORT, DUES, RETURNS, REFUND_DUE). {@code search} matches the order number, the phone,
     * part of the name or a tracking number.
     */
    @Query(value = "SELECT o.* FROM commerce_order o WHERE " + STAFF_FILTER
            + " ORDER BY o.created_at DESC, o.id DESC",
            countQuery = "SELECT COUNT(*) FROM commerce_order o WHERE " + STAFF_FILTER,
            nativeQuery = true)
    Page<CommerceOrder> staffSearch(@Param("instituteId") String instituteId, @Param("status") String status,
                                    @Param("paymentMethod") String paymentMethod,
                                    @Param("paymentStatus") String paymentStatus, @Param("channel") String channel,
                                    @Param("queue") String queue, @Param("text") String text,
                                    @Param("phone") String phone, @Param("namePattern") String namePattern,
                                    @Param("fromTime") Date fromTime, @Param("toTime") Date toTime,
                                    Pageable pageable);

    String STAFF_FILTER = """
            o.institute_id = :instituteId
              AND (CAST(:status AS VARCHAR) IS NULL OR o.status = CAST(:status AS VARCHAR))
              AND (CAST(:paymentMethod AS VARCHAR) IS NULL OR o.payment_method = CAST(:paymentMethod AS VARCHAR))
              AND (CAST(:paymentStatus AS VARCHAR) IS NULL OR o.payment_status = CAST(:paymentStatus AS VARCHAR))
              AND (CAST(:channel AS VARCHAR) IS NULL OR o.channel = CAST(:channel AS VARCHAR))
              AND (CAST(:fromTime AS TIMESTAMP) IS NULL OR o.created_at >= CAST(:fromTime AS TIMESTAMP))
              AND (CAST(:toTime AS TIMESTAMP) IS NULL OR o.created_at < CAST(:toTime AS TIMESTAMP))
              AND (CAST(:queue AS VARCHAR) IS NULL
                   OR (CAST(:queue AS VARCHAR) = 'TO_CONFIRM' AND o.status = 'COD_PENDING_CONFIRMATION')
                   OR (CAST(:queue AS VARCHAR) = 'TO_PACK' AND o.status = 'CONFIRMED')
                   OR (CAST(:queue AS VARCHAR) = 'TO_SHIP' AND o.status = 'PACKED')
                   OR (CAST(:queue AS VARCHAR) = 'IN_TRANSIT' AND o.status = 'SHIPPED')
                   OR (CAST(:queue AS VARCHAR) = 'COD_TO_COLLECT' AND o.payment_method = 'COD'
                       AND o.status = 'DELIVERED' AND o.payment_status = 'UNPAID')
                   OR (CAST(:queue AS VARCHAR) = 'RTO_TO_RECEIVE' AND o.status = 'RTO' AND EXISTS (
                       SELECT 1 FROM commerce_shipment s WHERE s.order_id = o.id AND s.status = 'RTO'))
                   OR (CAST(:queue AS VARCHAR) = 'STOCK_SHORT' AND o.stock_short)
                   OR (CAST(:queue AS VARCHAR) = 'DUES' AND o.channel = 'ADMIN'
                       AND o.payment_status IN ('UNPAID', 'PARTIALLY_PAID')
                       AND o.status NOT IN ('CANCELLED', 'RTO'))
                   OR (CAST(:queue AS VARCHAR) = 'RETURNS' AND EXISTS (
                       SELECT 1 FROM commerce_return r WHERE r.order_id = o.id
                       AND r.status IN ('REQUESTED', 'APPROVED', 'RECEIVED')))
                   OR (CAST(:queue AS VARCHAR) = 'REFUND_DUE' AND o.refund_due > o.refund_committed))
              AND (CAST(:text AS VARCHAR) IS NULL
                   OR o.order_number = CAST(:text AS VARCHAR)
                   OR o.customer_phone = CAST(:phone AS VARCHAR)
                   OR LOWER(o.customer_name) LIKE CAST(:namePattern AS VARCHAR)
                   OR EXISTS (SELECT 1 FROM commerce_shipment s WHERE s.order_id = o.id
                              AND s.institute_id = o.institute_id
                              AND s.tracking_number = CAST(:text AS VARCHAR)))
            """;

    /** When each order entered its current status: the newest status-history row per order. */
    interface StatusSince {
        String getOrderId();
        Date getSince();
    }

    @Query(value = """
            SELECT h.order_id AS orderId, MAX(h.created_at) AS since
            FROM commerce_order_status_history h
            WHERE h.order_id IN (:orderIds)
            GROUP BY h.order_id
            """, nativeQuery = true)
    java.util.List<StatusSince> findStatusSince(@Param("orderIds") java.util.Collection<String> orderIds);

    /** The order's invoice that is neither cancelled nor credited in full, newest first. */
    @Query(value = """
            SELECT i.id FROM invoice i
            WHERE i.institute_id = :instituteId AND i.commerce_order_id = :orderId AND i.cancelled_at IS NULL
              AND i.total_amount > COALESCE((SELECT SUM(cn.total) FROM commerce_credit_note cn
                                             WHERE cn.invoice_id = i.id), 0)
            ORDER BY i.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findLiveInvoiceId(@Param("instituteId") String instituteId, @Param("orderId") String orderId);

    /**
     * Credit given for goods returned on the order that did not become money owed back: per
     * received (or closed) return, {@code credit_total - due_raised}. On a staff order left on
     * credit this lowers what is still due (a return cannot refund money that was never paid).
     */
    @Query(value = """
            SELECT COALESCE(SUM(r.credit_total - r.due_raised), 0) FROM commerce_return r
            WHERE r.order_id = :orderId AND r.status IN ('RECEIVED', 'CLOSED')
            """, nativeQuery = true)
    java.math.BigDecimal sumReturnCreditNotRaised(@Param("orderId") String orderId);

    /** The credit notes of an order, oldest first. */
    @Query(value = """
            SELECT cn.id FROM commerce_credit_note cn
            WHERE cn.institute_id = :instituteId AND cn.commerce_order_id = :orderId
            ORDER BY cn.created_at ASC, cn.id ASC
            """, nativeQuery = true)
    java.util.List<String> findCreditNoteIds(@Param("instituteId") String instituteId,
                                             @Param("orderId") String orderId);

    /** Gives the claim back after a failed gateway call, so the shopper can retry at once. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND gateway_order_id IS NULL
            """, nativeQuery = true)
    int releaseGatewayAttempt(@Param("id") String id);
}
