package vacademy.io.admin_core_service.features.access_pass.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassGrant;

import java.util.List;

@Repository
public interface AccessPassGrantRepository extends JpaRepository<AccessPassGrant, String> {

    /** Every ledger row of one holder plan, ACTIVE and REVOKED (one per course, by the unique index). */
    List<AccessPassGrant> findByUserPlanId(String userPlanId);

    List<AccessPassGrant> findByUserPlanIdIn(List<String> userPlanIds);
}
