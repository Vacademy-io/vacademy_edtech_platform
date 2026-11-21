package vacademy.io.admin_core_service.features.commerce.security.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffPin;

import java.util.Optional;

public interface CommerceStaffPinRepository extends JpaRepository<CommerceStaffPin, String> {

    Optional<CommerceStaffPin> findByInstituteIdAndUserId(String instituteId, String userId);

    /** Row lock, so two PIN checks for one manager cannot both read the same failure count. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM CommerceStaffPin p WHERE p.instituteId = :instituteId AND p.userId = :userId")
    Optional<CommerceStaffPin> findForUpdate(@Param("instituteId") String instituteId,
                                             @Param("userId") String userId);
}
