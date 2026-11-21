package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface SocialAccountRepository extends JpaRepository<SocialAccount, String> {

    List<SocialAccount> findByInstituteIdAndStatusNot(String instituteId, String status);

    List<SocialAccount> findByInstituteIdAndStatus(String instituteId, String status);

    List<SocialAccount> findByInstituteIdAndPlatform(String instituteId, String platform);

    List<SocialAccount> findByConnectionId(String connectionId);

    List<SocialAccount> findByIdIn(Collection<String> ids);

    Optional<SocialAccount> findByIdAndInstituteId(String id, String instituteId);

    Optional<SocialAccount> findByInstituteIdAndPlatformAndExternalId(
            String instituteId, String platform, String externalId);
}
