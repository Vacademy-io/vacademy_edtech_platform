package vacademy.io.auth_service.feature.auth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.common.auth.entity.User;

import java.util.List;
import java.util.Optional;

/**
 * Account lookups that need to know which institute's portal the caller is signing into.
 * Kept out of the shared {@code UserRepository} so adding it does not force a common-library
 * release alongside the auth-service one.
 */
public interface PortalUserLookupRepository extends JpaRepository<User, String> {

    /**
     * The newest account with this email that holds one of the given roles, in one of the given
     * statuses, <b>in the given institute</b>. An email can front several accounts (one per
     * institute); the plain "most recent by email" lookup may land on another institute's account,
     * which a portal-scoped login must not reject the real learner because of.
     */
    @Query(value = """
            SELECT u.* FROM users u
            JOIN user_role ur ON u.id = ur.user_id
            JOIN roles r ON r.id = ur.role_id
            WHERE LOWER(u.email) = LOWER(:email)
              AND ur.institute_id = :instituteId
              AND ur.status IN (:statuses)
              AND r.role_name IN (:roleNames)
            ORDER BY u.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<User> findMostRecentByEmailInInstitute(@Param("email") String email,
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses,
            @Param("roleNames") List<String> roleNames);
}
