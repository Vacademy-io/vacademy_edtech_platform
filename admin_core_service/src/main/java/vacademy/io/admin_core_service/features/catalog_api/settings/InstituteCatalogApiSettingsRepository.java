package vacademy.io.admin_core_service.features.catalog_api.settings;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface InstituteCatalogApiSettingsRepository extends JpaRepository<InstituteCatalogApiSettings, String> {
}
