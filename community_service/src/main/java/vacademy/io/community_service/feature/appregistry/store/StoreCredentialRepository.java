package vacademy.io.community_service.feature.appregistry.store;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StoreCredentialRepository extends JpaRepository<StoreCredential, String> {

    Optional<StoreCredential> findFirstByInstituteIdAndPlatformAndProvider(
            String instituteId, String platform, String provider);

    Optional<StoreCredential> findFirstByInstituteIdIsNullAndPlatformAndProvider(
            String platform, String provider);

    List<StoreCredential> findAllByOrderByInstituteIdAscPlatformAsc();
}
