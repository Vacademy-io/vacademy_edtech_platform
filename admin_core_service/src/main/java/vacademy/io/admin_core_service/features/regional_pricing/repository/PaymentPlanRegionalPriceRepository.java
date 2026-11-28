package vacademy.io.admin_core_service.features.regional_pricing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;

import java.util.Collection;
import java.util.List;

/** Derived queries only: no hand-written SQL or JPQL strings. */
@Repository
public interface PaymentPlanRegionalPriceRepository extends JpaRepository<PaymentPlanRegionalPrice, String> {

    List<PaymentPlanRegionalPrice> findByPaymentPlanIdInAndStatus(Collection<String> paymentPlanIds, String status);

    List<PaymentPlanRegionalPrice> findByPaymentPlanIdAndStatus(String paymentPlanId, String status);

    /** The daily refresh set: rows of one source and status on the given plans. */
    List<PaymentPlanRegionalPrice> findByPaymentPlanIdInAndStatusAndPriceSource(Collection<String> paymentPlanIds,
                                                                               String status, String priceSource);
}
