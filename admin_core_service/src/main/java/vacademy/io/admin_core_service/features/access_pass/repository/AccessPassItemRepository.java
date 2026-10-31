package vacademy.io.admin_core_service.features.access_pass.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassItem;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AccessPassItemRepository extends JpaRepository<AccessPassItem, String> {

    List<AccessPassItem> findByAccessPassIdAndStatusOrderByDisplayOrderAscAddedAtAsc(String accessPassId,
                                                                                      String status);

    List<AccessPassItem> findByAccessPassIdInAndStatus(Collection<String> accessPassIds, String status);

    Optional<AccessPassItem> findFirstByAccessPassIdAndPackageSessionIdAndStatus(String accessPassId,
                                                                                 String packageSessionId,
                                                                                 String status);

    /** Which passes include these courses (the "In N passes" badge on the admin course list). */
    List<AccessPassItem> findByInstituteIdAndPackageSessionIdInAndStatus(String instituteId,
                                                                         Collection<String> packageSessionIds,
                                                                         String status);
}
