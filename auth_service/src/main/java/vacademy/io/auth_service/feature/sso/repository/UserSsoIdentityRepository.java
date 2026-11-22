package vacademy.io.auth_service.feature.sso.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.auth_service.feature.sso.entity.UserSsoIdentity;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserSsoIdentityRepository extends JpaRepository<UserSsoIdentity, String> {

    Optional<UserSsoIdentity> findByConnectionIdAndIssuerAndSubject(String connectionId, String issuer, String subject);

    boolean existsByConnectionIdAndUserId(String connectionId, String userId);

    long countByConnectionId(String connectionId);

    /**
     * Re-attaches identities left by a removed connection of the same institute and provider,
     * so people keep their accounts when single sign-on is set up again.
     */
    @Modifying
    @Transactional
    @Query(value = "UPDATE user_sso_identity SET connection_id = :connectionId "
            + "WHERE institute_id = :instituteId AND issuer = :issuer AND connection_id <> :connectionId "
            + "AND connection_id NOT IN (SELECT id FROM institute_sso_connection)", nativeQuery = true)
    int reattachOrphans(@Param("connectionId") String connectionId, @Param("instituteId") String instituteId,
                        @Param("issuer") String issuer);

    /** Users with this email (any case), newest first. */
    @Query(value = "SELECT u.id FROM users u WHERE lower(u.email) = :email ORDER BY u.created_at DESC",
            nativeQuery = true)
    List<String> findUserIdsByEmail(@Param("email") String email);

    /** Every role row the user holds, in any institute and status: {institute_id, role_name, status}. */
    @Query(value = "SELECT ur.institute_id, r.role_name, ur.status FROM user_role ur "
            + "LEFT JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = :userId",
            nativeQuery = true)
    List<Object[]> findRoleRowsOfUser(@Param("userId") String userId);
}
