package vacademy.io.admin_core_service.features.access_pass.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassSubOrg;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AccessPassSubOrgRepository extends JpaRepository<AccessPassSubOrg, String> {

    List<AccessPassSubOrg> findByAccessPassIdAndStatusOrderByAssignedAtDesc(String accessPassId, String status);

    List<AccessPassSubOrg> findByAccessPassIdInAndStatus(Collection<String> accessPassIds, String status);

    Optional<AccessPassSubOrg> findFirstByAccessPassIdAndSubOrgIdAndStatus(String accessPassId, String subOrgId,
                                                                           String status);
}
