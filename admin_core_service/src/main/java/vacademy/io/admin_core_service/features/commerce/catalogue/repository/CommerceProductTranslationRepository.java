package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductTranslation;

import java.util.Collection;
import java.util.List;

public interface CommerceProductTranslationRepository extends JpaRepository<CommerceProductTranslation, String> {

    List<CommerceProductTranslation> findByInstituteIdAndPackageId(String instituteId, String packageId);

    List<CommerceProductTranslation> findByInstituteIdAndPackageIdIn(String instituteId, Collection<String> packageIds);
}
