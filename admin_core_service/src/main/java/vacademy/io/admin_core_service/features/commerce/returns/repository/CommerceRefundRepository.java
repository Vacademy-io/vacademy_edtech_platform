package vacademy.io.admin_core_service.features.commerce.returns.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceRefund;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Refund rows. Every status change is a compare-and-set UPDATE: the row moves only from the
 * status the caller expects, and the caller learns from the row count whether it won.
 */
public interface CommerceRefundRepository extends JpaRepository<CommerceRefund, String> {

    Optional<CommerceRefund> findByIdAndInstituteId(String id, String instituteId);

    Optional<CommerceRefund> findByInstituteIdAndIdempotencyKey(String instituteId, String idempotencyKey);

    Optional<CommerceRefund> findByGatewayVendorAndGatewayRefundId(String vendor, String gatewayRefundId);

    List<CommerceRefund> findByOrderIdOrderByCreatedAtAsc(String orderId);

    List<CommerceRefund> findByOrderIdInOrderByCreatedAtAsc(Collection<String> orderIds);

    List<CommerceRefund> findByReturnIdOrderByCreatedAtAsc(String returnId);

    /** Refunds naming a return that did not fail (the return's cap). */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE return_id = :returnId "
            + "AND status <> 'FAILED'", nativeQuery = true)
    BigDecimal sumLiveOfReturn(@Param("returnId") String returnId);

    /** Refunds naming a return that were paid out. */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE return_id = :returnId "
            + "AND status = 'PROCESSED'", nativeQuery = true)
    BigDecimal sumProcessedOfReturn(@Param("returnId") String returnId);

    /** Gateway refunds of one payment that did not fail, any kind (the payment's cap). */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE gateway_vendor = :vendor "
            + "AND gateway_payment_id = :paymentId AND method = 'GATEWAY' AND status <> 'FAILED'", nativeQuery = true)
    BigDecimal sumLiveGatewayOfPayment(@Param("vendor") String vendor, @Param("paymentId") String paymentId);

    /** Our gateway refunds of one payment that were paid out or are under way. */
    @Query(value = "SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE gateway_vendor = :vendor "
            + "AND gateway_payment_id = :paymentId AND method = 'GATEWAY' "
            + "AND status IN ('PROCESSED', 'IN_PROGRESS')", nativeQuery = true)
    BigDecimal sumOursOfPayment(@Param("vendor") String vendor, @Param("paymentId") String paymentId);

    /** The executor's claim: one caller moves a due PENDING gateway refund to IN_PROGRESS. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET status = 'IN_PROGRESS', claimed_at = :now, attempt_count = attempt_count + 1,
                next_poll_at = :nextPoll, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND method = 'GATEWAY' AND status = 'PENDING'
              AND (next_poll_at IS NULL OR next_poll_at <= :now)
            """, nativeQuery = true)
    int claim(@Param("id") String id, @Param("now") Date now, @Param("nextPoll") Date nextPoll);

    /** No create was sent (the gateway did not answer the check): back to PENDING, tried again later. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET status = 'PENDING', next_poll_at = :nextPoll, last_error = CAST(:error AS VARCHAR),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'IN_PROGRESS' AND gateway_refund_id IS NULL
            """, nativeQuery = true)
    int release(@Param("id") String id, @Param("nextPoll") Date nextPoll, @Param("error") String error);

    /** The gateway's refund id, stored once. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET gateway_refund_id = :refundId, gateway_status = CAST(:gatewayStatus AS VARCHAR),
                reference = COALESCE(CAST(:reference AS VARCHAR), reference), updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND gateway_refund_id IS NULL
            """, nativeQuery = true)
    int storeGatewayRefund(@Param("id") String id, @Param("refundId") String refundId,
                           @Param("gatewayStatus") String gatewayStatus, @Param("reference") String reference);

    /** A create that may or may not have reached the gateway: noted, the poll decides. */
    @Modifying
    @Query(value = "UPDATE commerce_refund SET last_error = CAST(:error AS VARCHAR), updated_at = CURRENT_TIMESTAMP "
            + "WHERE id = :id", nativeQuery = true)
    int noteError(@Param("id") String id, @Param("error") String error);

    /** The poll asks again later. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET next_poll_at = :nextPoll, last_polled_at = :now, poll_count = poll_count + 1,
                gateway_status = COALESCE(CAST(:gatewayStatus AS VARCHAR), gateway_status),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'IN_PROGRESS'
            """, nativeQuery = true)
    int reschedule(@Param("id") String id, @Param("now") Date now, @Param("nextPoll") Date nextPoll,
                   @Param("gatewayStatus") String gatewayStatus);

    /** {@code POST /refunds/{id}/check}: the row is due now. */
    @Modifying
    @Query(value = "UPDATE commerce_refund SET next_poll_at = :now, updated_at = CURRENT_TIMESTAMP "
            + "WHERE id = :id AND status = 'IN_PROGRESS'", nativeQuery = true)
    int dueNow(@Param("id") String id, @Param("now") Date now);

    @Modifying
    @Query(value = "UPDATE commerce_refund SET stuck_alerted_at = :now WHERE id = :id", nativeQuery = true)
    int markStuckAlerted(@Param("id") String id, @Param("now") Date now);

    /** PENDING or IN_PROGRESS to PROCESSED, once. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET status = 'PROCESSED', processed_at = :now, processed_by = CAST(:actor AS VARCHAR),
                reference = COALESCE(CAST(:reference AS VARCHAR), reference),
                paid_on = COALESCE(CAST(:paidOn AS DATE), paid_on),
                gateway_status = COALESCE(CAST(:gatewayStatus AS VARCHAR), gateway_status),
                next_poll_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status IN ('PENDING', 'IN_PROGRESS')
            """, nativeQuery = true)
    int markProcessed(@Param("id") String id, @Param("now") Date now, @Param("actor") String actor,
                      @Param("reference") String reference, @Param("paidOn") LocalDate paidOn,
                      @Param("gatewayStatus") String gatewayStatus);

    /** PENDING or IN_PROGRESS to FAILED, once. */
    @Modifying
    @Query(value = """
            UPDATE commerce_refund
            SET status = 'FAILED', failed_at = :now, failure_code = :code,
                failure_reason = CAST(:reason AS VARCHAR), processed_by = CAST(:actor AS VARCHAR),
                gateway_status = COALESCE(CAST(:gatewayStatus AS VARCHAR), gateway_status),
                next_poll_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status IN ('PENDING', 'IN_PROGRESS')
            """, nativeQuery = true)
    int markFailed(@Param("id") String id, @Param("now") Date now, @Param("code") String code,
                   @Param("reason") String reason, @Param("actor") String actor,
                   @Param("gatewayStatus") String gatewayStatus);

    /** The poll job's rows: gateway refunds waiting for their call (PENDING) or outcome (IN_PROGRESS). */
    interface DueRefund {
        String getId();
        String getInstituteId();
        String getStatus();
    }

    @Query(value = """
            SELECT r.id AS id, r.institute_id AS instituteId, r.status AS status FROM commerce_refund r
            WHERE r.method = 'GATEWAY' AND r.status = 'PENDING'
              AND (r.next_poll_at IS NULL OR r.next_poll_at <= :now) AND r.created_at <= :createdBefore
            ORDER BY r.next_poll_at ASC NULLS FIRST, r.id ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<DueRefund> findDuePending(@Param("now") Date now, @Param("createdBefore") Date createdBefore,
                                   @Param("maxRows") int maxRows);

    @Query(value = """
            SELECT r.id AS id, r.institute_id AS instituteId, r.status AS status FROM commerce_refund r
            WHERE r.method = 'GATEWAY' AND r.status = 'IN_PROGRESS' AND r.next_poll_at <= :now
            ORDER BY r.next_poll_at ASC, r.id ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<DueRefund> findDueInProgress(@Param("now") Date now, @Param("maxRows") int maxRows);

    /** IN_PROGRESS for a long time and not alerted today. */
    @Query(value = """
            SELECT r.id AS id, r.institute_id AS instituteId, r.status AS status FROM commerce_refund r
            WHERE r.method = 'GATEWAY' AND r.status = 'IN_PROGRESS' AND r.claimed_at <= :claimedBefore
              AND (r.stuck_alerted_at IS NULL OR r.stuck_alerted_at <= :alertedBefore)
            ORDER BY r.claimed_at ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<DueRefund> findStuck(@Param("claimedBefore") Date claimedBefore, @Param("alertedBefore") Date alertedBefore,
                              @Param("maxRows") int maxRows);

    @Query(value = "SELECT r.* FROM commerce_refund r WHERE " + FILTER + " ORDER BY r.created_at DESC, r.id DESC",
            countQuery = "SELECT COUNT(*) FROM commerce_refund r WHERE " + FILTER,
            nativeQuery = true)
    Page<CommerceRefund> search(@Param("instituteId") String instituteId, @Param("status") String status,
                                @Param("method") String method, @Param("orderId") String orderId,
                                @Param("fromTime") Date fromTime, @Param("toTime") Date toTime, Pageable pageable);

    String FILTER = """
            r.institute_id = :instituteId
              AND (CAST(:status AS VARCHAR) IS NULL OR r.status = CAST(:status AS VARCHAR))
              AND (CAST(:method AS VARCHAR) IS NULL OR r.method = CAST(:method AS VARCHAR))
              AND (CAST(:orderId AS VARCHAR) IS NULL OR r.order_id = CAST(:orderId AS VARCHAR))
              AND (CAST(:fromTime AS TIMESTAMP) IS NULL OR r.created_at >= CAST(:fromTime AS TIMESTAMP))
              AND (CAST(:toTime AS TIMESTAMP) IS NULL OR r.created_at < CAST(:toTime AS TIMESTAMP))
            """;
}
