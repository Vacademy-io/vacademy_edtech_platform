package vacademy.io.admin_core_service.features.platform_billing.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PlatformPaymentRepository extends JpaRepository<PlatformPayment, String> {

    Optional<PlatformPayment> findByVendorOrderId(String vendorOrderId);

    Optional<PlatformPayment> findByVendorPaymentId(String vendorPaymentId);

    List<PlatformPayment> findByInstituteIdAndPaymentStatusInOrderByCreatedAtDesc(
            String instituteId, Collection<PlatformPaymentResult> paymentStatuses);

    /**
     * {@code SELECT ... FOR UPDATE} on one payment row (critique #8: payment.captured and
     * order.paid must not fulfil the same payment twice). Transaction-scoped row lock, so it is
     * safe under pgbouncer transaction pooling; call inside a write transaction.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM PlatformPayment p WHERE p.id = :id")
    Optional<PlatformPayment> findByIdForUpdate(@Param("id") String id);

    /** As {@link #findByIdForUpdate}, looked up by the Razorpay order id. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM PlatformPayment p WHERE p.vendorOrderId = :vendorOrderId")
    Optional<PlatformPayment> findByVendorOrderIdForUpdate(@Param("vendorOrderId") String vendorOrderId);

    /** As {@link #findByIdForUpdate}, looked up by the Razorpay payment id (refund events). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM PlatformPayment p WHERE p.vendorPaymentId = :vendorPaymentId")
    Optional<PlatformPayment> findByVendorPaymentIdForUpdate(@Param("vendorPaymentId") String vendorPaymentId);
}
