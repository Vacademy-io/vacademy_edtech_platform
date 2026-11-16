package vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportImageQueue;

import java.util.List;

public interface CommerceImportImageQueueRepository extends JpaRepository<CommerceImportImageQueue, String> {

    List<CommerceImportImageQueue> findByInstituteIdAndPackageId(String instituteId, String packageId);
}
