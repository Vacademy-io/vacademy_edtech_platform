package vacademy.io.auth_service.feature.institute_oauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.auth_service.feature.institute_oauth.entity.InstituteOAuthClient;

import java.util.Optional;

public interface InstituteOAuthClientRepository extends JpaRepository<InstituteOAuthClient, String> {

    Optional<InstituteOAuthClient> findByInstituteIdAndProvider(String instituteId, String provider);
}
