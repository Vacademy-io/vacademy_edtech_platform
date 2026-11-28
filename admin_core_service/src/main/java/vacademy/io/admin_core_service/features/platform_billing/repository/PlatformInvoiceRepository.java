package vacademy.io.admin_core_service.features.platform_billing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;

import java.util.List;
import java.util.Optional;

public interface PlatformInvoiceRepository extends JpaRepository<PlatformInvoice, String> {

    /** Returns existing invoice for a payment if one was already issued (idempotency). */
    Optional<PlatformInvoice> findByPlatformPaymentId(String platformPaymentId);

    List<PlatformInvoice> findByBuyerInstituteIdOrderByIssuedAtDesc(String buyerInstituteId);
}
