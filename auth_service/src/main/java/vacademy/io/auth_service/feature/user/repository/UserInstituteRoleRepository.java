package vacademy.io.auth_service.feature.user.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.common.auth.entity.UserRole;

import java.util.Collection;
import java.util.List;

/**
 * Read-only view of a user's role rows as (institute, role name, status) triples, without
 * loading the eager User / Role / permission graph a UserRole entity drags in.
 */
@org.springframework.stereotype.Repository
public interface UserInstituteRoleRepository extends Repository<UserRole, String> {

    interface InstituteRoleRow {
        String getInstituteId();

        String getRoleName();

        String getStatus();
    }

    @Query("""
                SELECT ur.instituteId AS instituteId, r.name AS roleName, ur.status AS status
                FROM UserRole ur
                JOIN ur.role r
                WHERE ur.user.id = :userId
                  AND ur.instituteId IS NOT NULL
            """)
    List<InstituteRoleRow> findInstituteRolesByUserId(@Param("userId") String userId);

    /** One user_role row, with whose it is: for batch lookups and for validating row ids from a request. */
    interface UserRoleRow extends InstituteRoleRow {
        String getId();

        String getUserId();
    }

    /** Same rows as {@link #findInstituteRolesByUserId} for many users in one query. */
    @Query("""
                SELECT ur.id AS id, ur.user.id AS userId, ur.instituteId AS instituteId,
                       r.name AS roleName, ur.status AS status
                FROM UserRole ur
                JOIN ur.role r
                WHERE ur.user.id IN :userIds
                  AND ur.instituteId IS NOT NULL
            """)
    List<UserRoleRow> findInstituteRolesByUserIds(@Param("userIds") Collection<String> userIds);

    /** The user_role rows with these ids (institute may be null for a legacy global row). */
    @Query("""
                SELECT ur.id AS id, ur.user.id AS userId, ur.instituteId AS instituteId,
                       r.name AS roleName, ur.status AS status
                FROM UserRole ur
                JOIN ur.role r
                WHERE ur.id IN :ids
            """)
    List<UserRoleRow> findRowsByIds(@Param("ids") Collection<String> ids);
}
