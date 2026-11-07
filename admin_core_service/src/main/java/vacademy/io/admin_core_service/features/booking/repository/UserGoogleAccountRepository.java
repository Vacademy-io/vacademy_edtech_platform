package vacademy.io.admin_core_service.features.booking.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.booking.entity.UserGoogleAccount;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserGoogleAccountRepository extends JpaRepository<UserGoogleAccount, String> {

    Optional<UserGoogleAccount> findByInstituteIdAndUserId(String instituteId, String userId);

    List<UserGoogleAccount> findByInstituteId(String instituteId);
}
