package vacademy.io.admin_core_service.features.admission_package.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackageCourse;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AdmissionPackageCourseRepository extends JpaRepository<AdmissionPackageCourse, String> {

    List<AdmissionPackageCourse> findByAdmissionPackageIdOrderByPositionAsc(String admissionPackageId);

    Optional<AdmissionPackageCourse> findByUserPlanId(String userPlanId);

    List<AdmissionPackageCourse> findByUserPlanIdIn(Collection<String> userPlanIds);
}
