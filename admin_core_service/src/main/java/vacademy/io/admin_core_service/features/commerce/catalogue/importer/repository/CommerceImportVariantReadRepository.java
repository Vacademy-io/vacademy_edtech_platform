package vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository;

import org.springframework.data.repository.Repository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;

import java.util.List;

/** Read-only: every variant of one institute, for planning an import and for the export. */
public interface CommerceImportVariantReadRepository extends Repository<CommerceVariant, String> {

    List<CommerceVariant> findByInstituteId(String instituteId);
}
