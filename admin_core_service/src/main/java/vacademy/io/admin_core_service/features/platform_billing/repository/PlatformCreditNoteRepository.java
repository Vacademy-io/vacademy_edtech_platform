package vacademy.io.admin_core_service.features.platform_billing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;

import java.util.List;
import java.util.Optional;

public interface PlatformCreditNoteRepository extends JpaRepository<PlatformCreditNote, String> {

    /** Idempotency: the note already issued for a Razorpay refund, if any. */
    Optional<PlatformCreditNote> findByVendorRefundId(String vendorRefundId);

    List<PlatformCreditNote> findByInvoiceIdOrderByIssuedAtAsc(String invoiceId);

    List<PlatformCreditNote> findByPlatformPaymentIdOrderByIssuedAtAsc(String platformPaymentId);

    List<PlatformCreditNote> findByBuyerInstituteIdOrderByIssuedAtDesc(String buyerInstituteId);
}
