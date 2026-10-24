package vacademy.io.common.auth.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.jpa.repository.EntityGraph;
import vacademy.io.common.auth.entity.User;

import java.util.Date;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends CrudRepository<User, String> {
        @EntityGraph(attributePaths = { "roles", "roles.role", "roles.role.authorities" })
        Optional<User> findByUsername(String username);

        /**
         * Every user holding one of these roles at this institute.
         *
         * Added for scheduled reporting, which needs to expand a recipient rule like
         * "all ADMINs" into actual addresses. Unlike the single-user lookups below
         * there is no LIMIT — the caller wants the whole set.
         *
         * role_name is compared case-insensitively on purpose: production holds both
         * 'ADMIN' (807 rows) and 'Admin' (49), and an exact match silently drops the
         * second group.
         */
        @Query(value = """
                        SELECT DISTINCT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE ur.institute_id = :instituteId
                          AND ur.status IN (:roleStatus)
                          AND UPPER(r.role_name) IN (:roleNames)
                        """, nativeQuery = true)
        List<User> findByInstituteAndRoleNames(
                        @Param("instituteId") String instituteId,
                        @Param("roleNames") List<String> upperCaseRoleNames,
                        @Param("roleStatus") List<String> roleStatus);

        /**
         * (user_id, role_name) for these users AT THIS INSTITUTE only.
         *
         * Necessary because User.roles is a plain @OneToMany with no institute
         * predicate, so UserDTO.roles is every role the person holds ANYWHERE —
         * and it includes INVITED. Deciding "is this person an admin here" from
         * that field lets an admin at institute B read institute A's data.
         */
        @Query(value = """
                        SELECT ur.user_id AS userId, UPPER(r.role_name) AS roleName
                        FROM user_role ur
                        JOIN roles r ON r.id = ur.role_id
                        WHERE ur.institute_id = :instituteId
                          AND ur.status = 'ACTIVE'
                          AND ur.user_id IN (:userIds)
                        """, nativeQuery = true)
        List<Object[]> findInstituteRoleRows(
                        @Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds);

        @Query(value = """
                        SELECT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE LOWER(u.email) = LOWER(:email)
                          AND ur.status IN (:roleStatus)
                          AND r.role_name IN (:roleNames)
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findMostRecentUserByEmailAndRoleStatusAndRoleNames(
                        @Param("email") String email,
                        @Param("roleStatus") List<String> roleStatus,
                        @Param("roleNames") List<String> roleNames);

        // For WhatsApp OTP login - uses correct column name 'mobile_number'.
        //
        // This supersedes findMostRecentUserByMobileAndRoleStatusAndRoleNames, which was
        // removed: it was byte-for-byte identical apart from filtering on a column named
        // "mobile", which does not exist on users (the column is mobile_number). It had no
        // callers and threw 42703 on every execution.
        @Query(value = """
                        SELECT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE u.mobile_number = :mobileNumber
                          AND ur.status IN (:roleStatus)
                          AND r.role_name IN (:roleNames)
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findUserByMobileNumberAndRoleStatusAndRoleNames(
                        @Param("mobileNumber") String mobileNumber,
                        @Param("roleStatus") List<String> roleStatus,
                        @Param("roleNames") List<String> roleNames);

        // For institutes with user_identifier=PHONE: find user by email where phone is
        // also present
        @Query(value = """
                        SELECT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE LOWER(u.email) = LOWER(:email)
                          AND u.mobile_number IS NOT NULL
                          AND ur.status IN (:roleStatus)
                          AND r.role_name IN (:roleNames)
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findUserByEmailWithPhoneNotNull(
                        @Param("email") String email,
                        @Param("roleStatus") List<String> roleStatus,
                        @Param("roleNames") List<String> roleNames);

        // For institutes with user_identifier=EMAIL: find user by phone where email is
        // also present
        @Query(value = """
                        SELECT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE u.mobile_number = :mobileNumber
                          AND u.email IS NOT NULL
                          AND ur.status IN (:roleStatus)
                          AND r.role_name IN (:roleNames)
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findUserByPhoneWithEmailNotNull(
                        @Param("mobileNumber") String mobileNumber,
                        @Param("roleStatus") List<String> roleStatus,
                        @Param("roleNames") List<String> roleNames);

        List<User> findByIdIn(List<String> userIds);

        /**
         * Find all children linked to the given parent IDs.
         * 
         * @param parentIds List of parent user IDs
         * @return List of child users where linked_parent_id is in the provided list
         */
        List<User> findByLinkedParentIdIn(List<String> parentIds);

        @Modifying
        @Transactional
        @Query(value = "INSERT INTO user_role (user_id, role_id) VALUES (:userId, :roleId)", nativeQuery = true)
        void addRoleToUser(@Param("userId") String userId, @Param("roleId") String roleId);

        @Modifying
        @Transactional
        @Query(value = "INSERT INTO user_permission (user_id, permission_id) VALUES (:userId, :permissionId)", nativeQuery = true)
        void addPermissionToUser(@Param("userId") String userId, @Param("permissionId") String permissionId);

        @Query(value = "SELECT u.* " +
                        "FROM users u WHERE u.id = :userId", nativeQuery = true)
        List<User> findUserDetailsById(@Param("userId") String userId);

        @Query(value = "SELECT u.* " +
                        "FROM users u WHERE u.id IN (:userIds)", nativeQuery = true)
        List<User> findUserDetailsByIds(@Param("userIds") List<String> userIds);

        @Query(value = "SELECT u.* " +
                        "FROM users u WHERE u.username = :username", nativeQuery = true)
        List<User> findUserDetailsByUsername(@Param("username") String username);

        @Query(value = "SELECT u.* " +
                        "FROM users u WHERE LOWER(u.email) = LOWER(:email) order by u.created_at desc", nativeQuery = true)
        List<User> findUserDetailsByEmail(@Param("email") String email);

        @Modifying
        @Transactional
        @Query(value = "DELETE FROM user_role WHERE user_id = :userId AND role_id = :roleId", nativeQuery = true)
        void removeRoleFromUser(@Param("userId") String userId, @Param("roleId") String roleId);

        @Modifying
        @Transactional
        @Query(value = "DELETE FROM user_permission WHERE user_id = :userId AND permission_id = :permissionId", nativeQuery = true)
        void removePermissionFromUser(@Param("userId") String userId, @Param("permissionId") String permissionId);

        @Query(value = "SELECT COUNT(*) > 0 FROM users WHERE id = :userId", nativeQuery = true)
        boolean existsByUserId(@Param("userId") String userId);

        @Query(value = "SELECT COUNT(*) > 0 FROM roles WHERE id = :roleId", nativeQuery = true)
        boolean existsByRoleId(@Param("roleId") String roleId);

        @Query(value = "SELECT COUNT(*) > 0 FROM permissions WHERE id = :permissionId", nativeQuery = true)
        boolean existsByPermissionId(@Param("permissionId") String permissionId);

        @Query(value = "SELECT COUNT(*) > 0 FROM users WHERE username = :user", nativeQuery = true)
        boolean existsByUserName(@Param("user") String user);

        @Query(value = "SELECT COUNT(*) > 0 FROM user_role WHERE user_id = :userId AND role_id = :roleId", nativeQuery = true)
        boolean existsByUserIdAndRoleId(@Param("userId") String userId, @Param("roleId") String roleId);

        @Query(value = "SELECT COUNT(*) > 0 FROM user_permission WHERE user_id = :userId AND permission_id = :permissionId", nativeQuery = true)
        boolean existsByUserIdAndPermissionId(@Param("userId") String userId,
                        @Param("permissionId") String permissionId);

        @Modifying
        @Transactional
        @Query(value = "DELETE FROM users WHERE id = :userId", nativeQuery = true)
        void deleteUserById(@Param("userId") String userId);

        @Query("SELECT DISTINCT u FROM User u " +
                        "JOIN  u.roles ur " +
                        "JOIN ur.role r " +
                        "WHERE ur.instituteId = :instituteId")
        List<User> findUsersWithRolesByInstituteId(@Param("instituteId") String instituteId);

        @Query("SELECT DISTINCT u FROM User u " +
                        "JOIN u.roles ur " +
                        "JOIN ur.role r " +
                        "WHERE ur.instituteId = :instituteId " +
                        "AND r.name IN :roles " +
                        "AND ur.status IN :statuses")
        List<User> findUsersWithRolesByInstituteIdAndStatuses(
                        @Param("instituteId") String instituteId,
                        @Param("roles") List<String> roles,
                        @Param("statuses") List<String> statuses);

        @Query("SELECT DISTINCT ur.user FROM UserRole ur WHERE ur.status IN :statuses AND ur.role.name IN :roles AND ur.instituteId = :instituteId")
        List<User> findUsersByStatusAndInstitute(@Param("statuses") List<String> statuses,
                        @Param("roles") List<String> roles, @Param("instituteId") String instituteId);

        @Query(value = "SELECT DISTINCT u.* FROM users u " +
                        "JOIN user_role ur ON u.id = ur.user_id " +
                        "JOIN roles r ON r.id = ur.role_id " +
                        "WHERE (:applyStatusFilter = FALSE OR ur.status IN (:statuses)) " +
                        "AND (:applyRoleFilter = FALSE OR LOWER(r.role_name) IN (:roles)) " +
                        "AND ur.institute_id = :instituteId " +
                        "AND (:name IS NULL OR CAST(u.full_name AS TEXT) ILIKE CONCAT('%', :name, '%')) " +
                        "AND (:email IS NULL OR CAST(u.email AS TEXT) ILIKE CONCAT('%', :email, '%')) " +
                        "AND (:mobile IS NULL OR u.mobile_number LIKE CONCAT('%', :mobile, '%')) " +
                        "ORDER BY u.full_name ASC", nativeQuery = true)
        List<User> findUsersByStatusAndInstitutePaged(@Param("applyStatusFilter") boolean applyStatusFilter,
                        @Param("statuses") List<String> statuses,
                        @Param("applyRoleFilter") boolean applyRoleFilter,
                        @Param("roles") List<String> roles, @Param("instituteId") String instituteId,
                        @Param("name") String name,
                        @Param("email") String email,
                        @Param("mobile") String mobile,
                        org.springframework.data.domain.Pageable pageable);

        @Query(value = "SELECT COUNT(DISTINCT u.id) FROM users u " +
                        "JOIN user_role ur ON u.id = ur.user_id " +
                        "JOIN roles r ON r.id = ur.role_id " +
                        "WHERE (:applyStatusFilter = FALSE OR ur.status IN (:statuses)) " +
                        "AND (:applyRoleFilter = FALSE OR LOWER(r.role_name) IN (:roles)) " +
                        "AND ur.institute_id = :instituteId " +
                        "AND (:name IS NULL OR CAST(u.full_name AS TEXT) ILIKE CONCAT('%', :name, '%')) " +
                        "AND (:email IS NULL OR CAST(u.email AS TEXT) ILIKE CONCAT('%', :email, '%')) " +
                        "AND (:mobile IS NULL OR u.mobile_number LIKE CONCAT('%', :mobile, '%'))", nativeQuery = true)
        long countUsersByStatusAndInstitute(@Param("applyStatusFilter") boolean applyStatusFilter,
                        @Param("statuses") List<String> statuses,
                        @Param("applyRoleFilter") boolean applyRoleFilter,
                        @Param("roles") List<String> roles, @Param("instituteId") String instituteId,
                        @Param("name") String name,
                        @Param("email") String email,
                        @Param("mobile") String mobile);

        // Variants that additionally restrict by a list of user IDs (used by sub-org team listing).
        @Query(value = "SELECT DISTINCT u.* FROM users u " +
                        "JOIN user_role ur ON u.id = ur.user_id " +
                        "JOIN roles r ON r.id = ur.role_id " +
                        "WHERE (:applyStatusFilter = FALSE OR ur.status IN (:statuses)) " +
                        "AND (:applyRoleFilter = FALSE OR LOWER(r.role_name) IN (:roles)) " +
                        "AND ur.institute_id = :instituteId " +
                        "AND u.id IN (:userIds) " +
                        "AND (:name IS NULL OR CAST(u.full_name AS TEXT) ILIKE CONCAT('%', :name, '%')) " +
                        "AND (:email IS NULL OR CAST(u.email AS TEXT) ILIKE CONCAT('%', :email, '%')) " +
                        "AND (:mobile IS NULL OR u.mobile_number LIKE CONCAT('%', :mobile, '%')) " +
                        "ORDER BY u.full_name ASC", nativeQuery = true)
        List<User> findUsersByStatusAndInstituteAndUserIdsPaged(@Param("applyStatusFilter") boolean applyStatusFilter,
                        @Param("statuses") List<String> statuses,
                        @Param("applyRoleFilter") boolean applyRoleFilter,
                        @Param("roles") List<String> roles, @Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds,
                        @Param("name") String name,
                        @Param("email") String email,
                        @Param("mobile") String mobile,
                        org.springframework.data.domain.Pageable pageable);

        @Query(value = "SELECT COUNT(DISTINCT u.id) FROM users u " +
                        "JOIN user_role ur ON u.id = ur.user_id " +
                        "JOIN roles r ON r.id = ur.role_id " +
                        "WHERE (:applyStatusFilter = FALSE OR ur.status IN (:statuses)) " +
                        "AND (:applyRoleFilter = FALSE OR LOWER(r.role_name) IN (:roles)) " +
                        "AND ur.institute_id = :instituteId " +
                        "AND u.id IN (:userIds) " +
                        "AND (:name IS NULL OR CAST(u.full_name AS TEXT) ILIKE CONCAT('%', :name, '%')) " +
                        "AND (:email IS NULL OR CAST(u.email AS TEXT) ILIKE CONCAT('%', :email, '%')) " +
                        "AND (:mobile IS NULL OR u.mobile_number LIKE CONCAT('%', :mobile, '%'))", nativeQuery = true)
        long countUsersByStatusAndInstituteAndUserIds(@Param("applyStatusFilter") boolean applyStatusFilter,
                        @Param("statuses") List<String> statuses,
                        @Param("applyRoleFilter") boolean applyRoleFilter,
                        @Param("roles") List<String> roles, @Param("instituteId") String instituteId,
                        @Param("userIds") List<String> userIds,
                        @Param("name") String name,
                        @Param("email") String email,
                        @Param("mobile") String mobile);

        @Modifying
        @Transactional
        @Query("UPDATE User u SET u.lastTokenUpdateTime = CURRENT_TIMESTAMP WHERE u.id IN :userIds")
        void updateLastTokenUpdateTime(@Param("userIds") List<String> userIds);

        /** Stamps a successful sign-in; one narrow UPDATE, no entity load. */
        @Modifying
        @Transactional
        @Query("UPDATE User u SET u.lastLoginTime = CURRENT_TIMESTAMP WHERE u.id = :userId")
        int updateLastLoginTime(@Param("userId") String userId);

        Optional<User> findFirstByEmailOrderByCreatedAtDesc(String email);

        /**
         * Find user by username and institute ID for trusted login.
         * ⚠️ TEMPORARY: Used for emergency trusted login when email service is down.
         * TODO: Consider removing when email service is restored.
         */
        @Query(value = """
                        SELECT DISTINCT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE u.username = :username
                          AND ur.institute_id = :instituteId
                          AND ur.status IN ('ACTIVE', 'INVITED')
                          AND r.role_name IN ('STUDENT')
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findUserByUsernameAndInstituteId(
                        @Param("username") String username,
                        @Param("instituteId") String instituteId);

        // In your UserRepository.java
        // In your UserRepository.java
        @Query("SELECT DISTINCT u FROM User u " +
                        "JOIN u.roles ur " +
                        "JOIN ur.role r " +
                        "WHERE ur.instituteId = :instituteId " +
                        "AND r.name IN :roles " +
                        "AND ur.status IN :statuses " +
                        "AND ((u.lastLoginTime IS NOT NULL AND FUNCTION('DATE', u.lastLoginTime) = :targetDate) OR (u.lastLoginTime IS NULL AND FUNCTION('DATE', u.createdAt) = :targetDate))")
        List<User> findUsersInactiveOnDate(
                        @Param("instituteId") String instituteId,
                        @Param("roles") List<String> roles,
                        @Param("statuses") List<String> statuses,
                        @Param("targetDate") Date targetDate);

        @Query("SELECT DISTINCT u FROM User u " +
                        "JOIN u.roles ur " +
                        "JOIN ur.role r " +
                        "WHERE ur.instituteId = :instituteId " +
                        "AND r.name IN :roles " +
                        "AND ur.status IN :statuses " +
                        "AND (u.lastLoginTime IS NULL OR u.lastLoginTime <= :targetDate) " +
                        "ORDER BY u.lastLoginTime ASC NULLS FIRST")
        List<User> findUsersInactiveForDaysOrMore(
                        @Param("instituteId") String instituteId,
                        @Param("roles") List<String> roles,
                        @Param("statuses") List<String> statuses,
                        @Param("targetDate") Date targetDate);

        @Query(value = """
                        SELECT DISTINCT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE ur.status = 'ACTIVE'
                        AND ur.institute_id = :instituteId
                        AND (:roleNames IS NULL OR r.role_name IN (:roleNames))
                        AND (
                            (:query IS NULL OR LOWER(u.full_name) LIKE LOWER(CONCAT('%', :query, '%'))) OR
                            (:query IS NULL OR LOWER(u.email) LIKE LOWER(CONCAT('%', :query, '%'))) OR
                            (:query IS NULL OR u.mobile_number LIKE CONCAT('%', :query, '%'))
                        )
                        ORDER BY u.full_name ASC
                        LIMIT 10
                        """, nativeQuery = true)
        List<User> autoSuggestUsers(@Param("instituteId") String instituteId,
                        @Param("roleNames") List<String> roleNames,
                        @Param("query") String query);

        @Query(value = """
                        SELECT DISTINCT u.* FROM users u
                        JOIN user_role ur ON u.id = ur.user_id
                        JOIN roles r ON r.id = ur.role_id
                        WHERE ur.status = 'ACTIVE'
                        AND ur.institute_id = :instituteId
                        AND (
                            (:query IS NULL OR LOWER(u.full_name) LIKE LOWER(CONCAT('%', :query, '%'))) OR
                            (:query IS NULL OR LOWER(u.email) LIKE LOWER(CONCAT('%', :query, '%'))) OR
                            (:query IS NULL OR u.mobile_number LIKE CONCAT('%', :query, '%'))
                        )
                        ORDER BY u.full_name ASC
                        LIMIT 10
                        """, nativeQuery = true)
        List<User> autoSuggestUsersAllRoles(@Param("instituteId") String instituteId,
                        @Param("query") String query);

        @Query(value = """
                        SELECT DISTINCT u.id FROM users u
                        LEFT JOIN user_role ur ON u.id = ur.user_id
                        WHERE (:instituteId IS NULL OR ur.institute_id = :instituteId)
                        AND (
                            LOWER(COALESCE(u.full_name, '')) LIKE LOWER(CONCAT('%', :query, '%'))
                            OR LOWER(COALESCE(u.email, '')) LIKE LOWER(CONCAT('%', :query, '%'))
                            OR COALESCE(u.mobile_number, '') LIKE CONCAT('%', :query, '%')
                        )
                        LIMIT 500
                        """, nativeQuery = true)
        List<String> searchUserIdsByQuery(@Param("query") String query,
                        @Param("instituteId") String instituteId);

        @Query(value = """
                        SELECT u.* FROM users u
                        WHERE u.mobile_number IS NOT NULL AND TRIM(u.mobile_number) != ''
                        AND RIGHT(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g'), 10) = RIGHT(:digitsOnly, 10)
                        AND (
                            REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g') = :digitsOnly
                            OR (
                                LENGTH(:digitsOnly) >= 10
                                AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 10
                                AND RIGHT(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g'), 10) = RIGHT(:digitsOnly, 10)
                            )
                        )
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findLatestUserByMobileNumber(@Param("digitsOnly") String digitsOnly);

        // Both phone lookups carry a leading RIGHT(..., 10) = RIGHT(:digitsOnly, 10). The OR
        // below already implies it (an exact match shares its last 10 digits; the second branch
        // compares them directly), so it changes no result -- it gives idx_users_mobile_last10
        // (auth V25) an indexable predicate. Without it every phone login normalised all 254k
        // users' numbers with REGEXP_REPLACE: ~350 ms, now under 20 ms. Keep the expression
        // byte-for-byte equal to the index definition or the planner will not match it.

        /**
         * Same phone matching as {@link #findLatestUserByMobileNumber}, but only
         * among users who actually hold a role in the given institute.
         *
         * <p>One phone number can front several accounts — a learner who enrolled
         * twice, staff who also test as a learner, a shared family number. Picking
         * the most recently created one regardless of institute can hand back an
         * account with no role in the institute being logged into, which mints a
         * token carrying no authorities: the login "succeeds" and the portal has
         * nowhere to put the user. Scoping to the institute picks an account that
         * can actually sign in there.</p>
         */
        @Query(value = """
                        SELECT u.* FROM users u
                        JOIN user_role ur ON ur.user_id = u.id
                        WHERE u.mobile_number IS NOT NULL AND TRIM(u.mobile_number) != ''
                        AND RIGHT(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g'), 10) = RIGHT(:digitsOnly, 10)
                        AND ur.institute_id = :instituteId
                        AND ur.status IN ('ACTIVE', 'INVITED')
                        AND (
                            REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g') = :digitsOnly
                            OR (
                                LENGTH(:digitsOnly) >= 10
                                AND LENGTH(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g')) >= 10
                                AND RIGHT(REGEXP_REPLACE(u.mobile_number, '[^0-9]', '', 'g'), 10) = RIGHT(:digitsOnly, 10)
                            )
                        )
                        ORDER BY u.created_at DESC
                        LIMIT 1
                        """, nativeQuery = true)
        Optional<User> findLatestUserByMobileNumberAndInstitute(@Param("digitsOnly") String digitsOnly,
                        @Param("instituteId") String instituteId);

}
