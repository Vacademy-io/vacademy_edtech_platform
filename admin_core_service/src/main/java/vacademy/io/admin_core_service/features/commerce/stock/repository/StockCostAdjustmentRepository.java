package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCostAdjustment;

import java.util.Optional;

/** Insert and read only. */
public interface StockCostAdjustmentRepository extends JpaRepository<StockCostAdjustment, String> {

    Optional<StockCostAdjustment> findByInstituteIdAndIdempotencyKey(String instituteId, String idempotencyKey);
}
