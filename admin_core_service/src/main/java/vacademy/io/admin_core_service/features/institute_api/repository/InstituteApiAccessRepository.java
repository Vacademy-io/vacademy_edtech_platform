package vacademy.io.admin_core_service.features.institute_api.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccess;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiAccessId;

import java.util.List;
import java.util.Optional;

public interface InstituteApiAccessRepository extends JpaRepository<InstituteApiAccess, InstituteApiAccessId> {

    List<InstituteApiAccess> findByInstituteIdOrderByProductAsc(String instituteId);

    Optional<InstituteApiAccess> findByInstituteIdAndProduct(String instituteId, String product);

    /**
     * Row lock on the access row. Key issue takes it so that concurrent issues for one
     * institute are serialised (the 50-active-keys cap) and see the latest enabled flag;
     * access edits take it so two edits do not interleave.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM InstituteApiAccess a WHERE a.instituteId = :instituteId AND a.product = :product")
    Optional<InstituteApiAccess> findForUpdate(@Param("instituteId") String instituteId,
                                               @Param("product") String product);
}
