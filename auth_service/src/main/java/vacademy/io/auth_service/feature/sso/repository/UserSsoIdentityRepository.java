package vacademy.io.auth_service.feature.sso.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.auth_service.feature.sso.entity.UserSsoIdentity;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserSsoIdentityRepository extends JpaRepository<UserSsoIdentity, String> {

    Optional<UserSsoIdentity> findByConnectionIdAndSubject(String connectionId, String subject);

    boolean existsByConnectionIdAndUserId(String connectionId, String userId);

    long countByConnectionId(String connectionId);

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
