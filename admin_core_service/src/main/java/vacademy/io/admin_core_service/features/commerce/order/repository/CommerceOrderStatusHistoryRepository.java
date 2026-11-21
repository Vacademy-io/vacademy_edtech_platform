package vacademy.io.admin_core_service.features.commerce.order.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderStatusHistory;

import java.util.List;

public interface CommerceOrderStatusHistoryRepository extends JpaRepository<CommerceOrderStatusHistory, String> {

    List<CommerceOrderStatusHistory> findByOrderIdOrderByCreatedAtAscIdAsc(String orderId);
}
