package vacademy.io.common.auth.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.common.auth.dto.RoleCountProjection;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;

import java.util.List;
import java.util.Optional;

/**
 * WARNING — this repository is only usable from <b>auth_service</b>. It lives in
 * common_service, so any service can inject it and every query here compiles and
 * passes review anywhere. But {@code users}, {@code user_role} and {@code roles}
 * exist only in auth_service's database: called from admin_core (or any other
 * service) these methods fail at RUNTIME with
 * {@code relation "user_role" does not exist}.
 *
 * <p>From another service, resolve users and their roles over HTTP instead —
 * see {@code AuthService.requireUsersByInstituteAndRoles} in admin_core.
 */
@Repository
public interface UserRoleRepository extends CrudRepository<UserRole, String> {

        List<UserRole> findByUser(User user);

        /**
         * Institute ids a user holds any role in. Used to evict exactly the
         * {@code authUserDetails} entries for that user after a username change —
         * the cache key is {@code username + '_' + instituteId}, so without this
         * the only option is an allEntries clear, which on the Redis cache
         * manager means a keyspace scan over every cached user.
         *
         * <p>Deliberately a projection, not {@code user.getRoles()}: the caller
         * runs outside a transaction (it must not hold a DB connection across the
         * fan-out HTTP call), where touching that lazy collection is unsafe.
         */
        @Query("SELECT DISTINCT ur.instituteId FROM UserRole ur WHERE ur.user.id = :userId AND ur.instituteId IS NOT NULL")
        List<String> findDistinctInstituteIdsByUserId(@Param("userId") String userId);

        @Query("""
                            SELECT ur FROM UserRole ur
                            JOIN ur.role r
                            WHERE ur.user.id = :userId
                              AND ur.status IN :statuses
                              AND r.name IN :roleNames
                        """)
        List<UserRole> findUserRolesByUserIdAndStatusesAndRoleNames(
                        @Param("userId") String userId,
                        @Param("statuses") List<String> statuses,
                        @Param("roleNames") List<String> roleNames);

        @Modifying
        @Transactional
        @Query("DELETE FROM UserRole ur WHERE ur.user.id = :userId AND ur.role.name IN :roleNames")
        void deleteUserRolesByUserIdAndRoleNames(@Param("userId") String userId,
                        @Param("roleNames") List<String> roleNames);

        @Query("SELECT r.name AS roleName, COUNT(ur.user.id) AS userCount " +
                        "FROM UserRole ur JOIN ur.role r " +
                        "WHERE ur.instituteId = :instituteId and r.name != 'STUDENT' " +
                        "GROUP BY r.name")
        List<RoleCountProjection> getUserRoleCountsByInstituteId(@Param("instituteId") String instituteId);

        @Transactional
        @Modifying
        @Query("UPDATE UserRole ur SET ur.status = :newStatus WHERE ur.instituteId = :instituteId AND ur.user.id IN (:userIds)")
        int updateUserRoleStatusByInstituteIdAndUserId(@Param("newStatus") String newStatus,
                        @Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds);

        /**
         * Like updateUserRoleStatusByInstituteIdAndUserId, but only moves rows that are
         * currently in one of {@code fromStatuses}. Enable must not resurrect a role an admin
         * deleted, and disable must not rewrite rows that are already gone.
         */
        @Transactional
        @Modifying
        @Query("UPDATE UserRole ur SET ur.status = :newStatus WHERE ur.instituteId = :instituteId "
                        + "AND ur.user.id IN (:userIds) AND ur.status IN (:fromStatuses)")
        int updateUserRoleStatusFromStatuses(@Param("newStatus") String newStatus,
                        @Param("fromStatuses") List<String> fromStatuses,
                        @Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds);

        /**
         * Accepts pending invites on sign-in: INVITED -> ACTIVE for the user in one institute.
         * Disabled or deleted roles are left exactly as the admin set them.
         */
        @Transactional
        @Modifying
        @Query("UPDATE UserRole ur SET ur.status = 'ACTIVE' WHERE ur.instituteId = :instituteId "
                        + "AND ur.user.id IN (:userIds) AND ur.status = 'INVITED'")
        int activateInvitedRolesByInstituteIdAndUserId(@Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds);

        @Query("SELECT ur FROM UserRole ur WHERE ur.user = :user AND ur.status = :status AND ur.role.name = :roleName")
        List<UserRole> findByUserAndStatusAndRoleName(@Param("user") User user,
                        @Param("status") String status,
                        @Param("roleName") String roleName);

        @Query(value = """
                        SELECT ur.* FROM user_role ur
                        JOIN roles r ON r.id = ur.role_id
                        WHERE ur.user_id = :userId
                          AND ur.institute_id = :instituteId
                          AND r.role_name IN (:roleNames)
                          AND ur.status IN (:statuses)
                        ORDER BY ur.created_at
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<UserRole> findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                        @Param("userId") String userId,
                        @Param("instituteId") String instituteId,
                        @Param("roleNames") List<String> roleNames,
                        @Param("statuses") List<String> statuses);

        /**
         * ACTIVE role UUIDs a user holds in one institute.
         *
         * <p>Needed because role-keyed institute settings (e.g. ROLE_DISPLAY_SETTINGS) are
         * keyed by role UUID, while the JWT only carries role NAMES — so a request-time
         * lookup of "which role config applies to this caller" has to resolve ids here.
         */
        @Query("""
                            SELECT ur.role.id FROM UserRole ur
                            WHERE ur.user.id = :userId
                              AND ur.instituteId = :instituteId
                              AND ur.status = 'ACTIVE'
                              AND ur.role.id IS NOT NULL
                        """)
        List<String> findActiveRoleIdsByUserIdAndInstituteId(
                        @Param("userId") String userId,
                        @Param("instituteId") String instituteId);

        @Query("""
                            SELECT CASE WHEN COUNT(u) > 0 THEN TRUE ELSE FALSE END
                            FROM User u
                            JOIN u.roles ur
                            JOIN ur.role r
                            WHERE u.email = :email
                              AND ur.instituteId = :instituteId
                              AND ur.status IN :statuses
                              AND r.name IN :roleNames
                        """)
        boolean existsUserByEmailAndInstituteIdAndStatusesAndRoleNames(
                        @Param("email") String email,
                        @Param("instituteId") String instituteId,
                        @Param("statuses") List<String> statuses,
                        @Param("roleNames") List<String> roleNames);

        /**
         * Get users by institute and role name - for notification service user
         * resolution
         */
        @Query("""
                            SELECT ur.user
                            FROM UserRole ur
                            JOIN ur.role r
                            WHERE ur.instituteId = :instituteId
                              AND r.name = :roleName
                              AND ur.status = 'ACTIVE'
                        """)
        List<User> findUsersByInstituteIdAndRoleName(
                        @Param("instituteId") String instituteId,
                        @Param("roleName") String roleName);

        @Query("SELECT CASE WHEN COUNT(ur) > 0 THEN TRUE ELSE FALSE END " +
                        "FROM UserRole ur JOIN ur.role r " +
                        "WHERE ur.user.id = :userId " +
                        "AND ur.instituteId = :instituteId " +
                        "AND ur.status = 'ACTIVE' " +
                        "AND r.name = :roleName")
        boolean existsByUserIdAndInstituteIdAndRoleName(@Param("userId") String userId,
                        @Param("instituteId") String instituteId,
                        @Param("roleName") String roleName);

        // ==================== Super Admin Queries ====================

        @Query(value = """
                        SELECT u.id, u.full_name, u.email, u.mobile_number,
                               STRING_AGG(DISTINCT r.role_name, ',') AS roles,
                               ur.status, u.last_login_time, u.created_at
                        FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON ur.role_id = r.id
                        WHERE ur.institute_id = :instituteId
                          AND ur.status IN ('ACTIVE','INVITED')
                          AND (:role IS NULL OR :role = '' OR r.role_name = :role)
                          AND (:search IS NULL OR :search = ''
                               OR LOWER(u.full_name) LIKE LOWER(CONCAT('%', :search, '%'))
                               OR LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')))
                        GROUP BY u.id, u.full_name, u.email, u.mobile_number, ur.status, u.last_login_time, u.created_at
                        ORDER BY u.created_at DESC
                        LIMIT :size OFFSET :offset
                        """, nativeQuery = true)
        List<Object[]> findUsersByInstitutePaginated(@Param("instituteId") String instituteId,
                        @Param("role") String role, @Param("search") String search,
                        @Param("size") int size, @Param("offset") int offset);

        @Query(value = """
                        SELECT COUNT(DISTINCT u.id)
                        FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON ur.role_id = r.id
                        WHERE ur.institute_id = :instituteId
                          AND ur.status IN ('ACTIVE','INVITED')
                          AND (:role IS NULL OR :role = '' OR r.role_name = :role)
                          AND (:search IS NULL OR :search = ''
                               OR LOWER(u.full_name) LIKE LOWER(CONCAT('%', :search, '%'))
                               OR LOWER(u.email) LIKE LOWER(CONCAT('%', :search, '%')))
                        """, nativeQuery = true)
        Long countUsersByInstitute(@Param("instituteId") String instituteId,
                        @Param("role") String role, @Param("search") String search);

}