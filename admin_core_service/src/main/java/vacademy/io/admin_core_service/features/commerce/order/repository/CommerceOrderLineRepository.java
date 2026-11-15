package vacademy.io.admin_core_service.features.commerce.order.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceOrderLineRepository extends JpaRepository<CommerceOrderLine, String> {

    List<CommerceOrderLine> findByOrderIdOrderByLineNoAsc(String orderId);

    List<CommerceOrderLine> findByOrderIdInOrderByOrderIdAscLineNoAsc(Collection<String> orderIds);

    Optional<CommerceOrderLine> findFirstByUserPlanId(String userPlanId);

    Optional<CommerceOrderLine> findFirstByPaymentLogId(String paymentLogId);
}
