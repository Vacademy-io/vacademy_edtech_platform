package vacademy.io.admin_core_service.features.packages.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.packages.entity.PackagePageContent;

@Repository
public interface PackagePageContentRepository extends JpaRepository<PackagePageContent, String> {
}
