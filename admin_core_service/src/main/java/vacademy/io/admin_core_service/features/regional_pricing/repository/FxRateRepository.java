package vacademy.io.admin_core_service.features.regional_pricing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.regional_pricing.entity.FxRate;

@Repository
public interface FxRateRepository extends JpaRepository<FxRate, String> {
}
