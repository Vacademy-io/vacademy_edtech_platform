package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;

import java.util.Optional;

/**
 * Finds one person's lead inside one list by email, for lists the platform keeps up to date
 * itself (an open assessment's marks arrive after the lead was created). Rides the
 * lower(parent_email) and audience_id indexes and stops at the first row, so a list with
 * thousands of leads is never loaded to find one. Deliberately not by phone: siblings share
 * a parent's number, and a phone match would put one child's marks on the other's lead.
 */
public interface AutoListLeadLookupRepository extends Repository<AudienceResponse, String> {

    @Query(value = """
            SELECT * FROM audience_response
            WHERE audience_id = :audienceId
              AND lower(parent_email) = lower(:email)
              AND coalesce(audience_status, 'ACTIVE') <> 'DELETED'
            ORDER BY created_at ASC
            LIMIT 1
            """, nativeQuery = true)
    Optional<AudienceResponse> findFirstInListByEmail(@Param("audienceId") String audienceId,
                                                      @Param("email") String email);

    /** Any lead in the list with this email, deleted ones included. */
    @Query(value = """
            SELECT EXISTS (
                SELECT 1 FROM audience_response
                WHERE audience_id = :audienceId
                  AND lower(parent_email) = lower(:email))
            """, nativeQuery = true)
    boolean existsInListByEmailAnyStatus(@Param("audienceId") String audienceId,
                                         @Param("email") String email);
}
