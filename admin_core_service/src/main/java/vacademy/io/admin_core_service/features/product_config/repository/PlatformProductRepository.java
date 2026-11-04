package vacademy.io.admin_core_service.features.product_config.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.product_config.entity.PlatformProduct;

public interface PlatformProductRepository extends JpaRepository<PlatformProduct, String> {
}
