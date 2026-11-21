package vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository;

import org.springframework.data.repository.Repository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;

import java.util.List;

/** Read-only: every product of one institute, for planning an import and for the export. */
public interface CommerceImportProductReadRepository extends Repository<CommerceProduct, String> {

    List<CommerceProduct> findByInstituteId(String instituteId);
}
