package vacademy.io.admin_core_service.features.admission_package.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackage;

import java.util.List;

@Repository
public interface AdmissionPackageRepository extends JpaRepository<AdmissionPackage, String> {

    List<AdmissionPackage> findByUserIdAndInstituteIdOrderByCreatedAtDesc(String userId, String instituteId);
}
