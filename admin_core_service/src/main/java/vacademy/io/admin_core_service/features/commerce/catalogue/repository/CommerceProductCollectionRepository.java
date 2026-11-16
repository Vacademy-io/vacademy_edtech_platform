package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductCollection;

import java.util.List;

public interface CommerceProductCollectionRepository extends JpaRepository<CommerceProductCollection, String> {

    List<CommerceProductCollection> findByInstituteIdAndPackageId(String instituteId, String packageId);

    List<CommerceProductCollection> findByInstituteIdAndCollectionIdOrderByPositionAsc(String instituteId,
                                                                                       String collectionId);
}
