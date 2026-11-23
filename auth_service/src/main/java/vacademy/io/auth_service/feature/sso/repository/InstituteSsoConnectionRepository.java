package vacademy.io.auth_service.feature.sso.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.auth_service.feature.sso.entity.InstituteSsoConnection;

import java.util.List;
import java.util.Optional;

@Repository
public interface InstituteSsoConnectionRepository extends JpaRepository<InstituteSsoConnection, String> {

    Optional<InstituteSsoConnection> findByInstituteId(String instituteId);

    List<InstituteSsoConnection> findAllByEnabledTrue();
}
