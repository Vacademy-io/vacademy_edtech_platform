package vacademy.io.admin_core_service.features.packages.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.common.institute.entity.PackageInstitute;

import java.util.Optional;

public interface PackageInstituteRepository extends JpaRepository<PackageInstitute, String> {
    @Query("SELECT pi FROM PackageInstitute pi WHERE pi.packageEntity.id = :packageId AND pi.instituteEntity.id = :instituteId")
    Optional<PackageInstitute> findByPackageIdAndInstituteId(@Param("packageId") String packageId, @Param("instituteId") String instituteId);

    Optional<PackageInstitute> findTopByPackageEntity_IdOrderByCreatedAtDesc(String packageId);

    /** Whether the package is linked to the institute. Safe with duplicate link rows (no unique key). */
    @Query("SELECT COUNT(pi) > 0 FROM PackageInstitute pi WHERE pi.packageEntity.id = :packageId AND pi.instituteEntity.id = :instituteId")
    boolean existsLink(@Param("packageId") String packageId, @Param("instituteId") String instituteId);
}
