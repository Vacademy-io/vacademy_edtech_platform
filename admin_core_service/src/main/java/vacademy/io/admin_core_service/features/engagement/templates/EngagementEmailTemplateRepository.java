package vacademy.io.admin_core_service.features.engagement.templates;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface EngagementEmailTemplateRepository extends JpaRepository<EngagementEmailTemplate, String> {

    List<EngagementEmailTemplate> findByEngineIdAndInstituteIdOrderByNameAscVersionDesc(String engineId, String instituteId);

    List<EngagementEmailTemplate> findByEngineIdAndInstituteIdAndStatusOrderByNameAsc(String engineId, String instituteId,
                                                                                      String status);

    Optional<EngagementEmailTemplate> findFirstByEngineIdAndInstituteIdAndNameAndStatus(String engineId, String instituteId,
                                                                                       String name, String status);

    Optional<EngagementEmailTemplate> findByIdAndInstituteId(String id, String instituteId);

    /** The newest version of a template in the given statuses (e.g. the pending next version). */
    Optional<EngagementEmailTemplate> findFirstByEngineIdAndInstituteIdAndNameAndStatusInOrderByVersionDesc(
            String engineId, String instituteId, String name, List<String> statuses);

    @Query(value = """
            SELECT COALESCE(MAX(version), 0) FROM engagement_email_template
             WHERE engine_id = :engineId AND name = :name
            """, nativeQuery = true)
    int maxVersion(@Param("engineId") String engineId, @Param("name") String name);

    @Query(value = """
            SELECT DISTINCT name FROM engagement_email_template
             WHERE engine_id = :engineId
            """, nativeQuery = true)
    List<String> namesUsed(@Param("engineId") String engineId);

    /** Retire the currently approved version of a template before approving its successor. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_email_template
               SET status = 'SUPERSEDED', updated_at = :now
             WHERE engine_id = :engineId AND name = :name AND status = 'APPROVED' AND id <> :keepId
            """, nativeQuery = true)
    int supersedeApproved(@Param("engineId") String engineId, @Param("name") String name,
                          @Param("keepId") String keepId, @Param("now") Instant now);

    /** Review-state CAS: only a proposal under review can be approved (a stale UI can't skip states). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_email_template
               SET status = 'APPROVED', approved_by = :by, approved_at = :now, updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status IN ('AI_PROPOSED', 'USER_REVIEW')
            """, nativeQuery = true)
    int approve(@Param("id") String id, @Param("instituteId") String instituteId,
                @Param("by") String by, @Param("now") Instant now);

    /**
     * Approved email templates of the institute's OTHER engines this engine could take over: same
     * language, not from an archived or system engine, and no live template of that name here.
     */
    @Query(value = """
            SELECT DISTINCT ON (t.name) t.* FROM engagement_email_template t
              JOIN engagement_engine e ON e.id = t.engine_id
             WHERE t.institute_id = :instituteId AND t.engine_id <> :engineId AND t.status = 'APPROVED'
               AND t.language = :language
               AND e.status <> 'ARCHIVED' AND COALESCE(e.created_by, '') <> 'SYSTEM_AI_CALL'
               AND NOT EXISTS (SELECT 1 FROM engagement_email_template x
                                WHERE x.engine_id = :engineId AND x.name = t.name
                                  AND x.status IN ('AI_PROPOSED', 'USER_REVIEW', 'APPROVED'))
             ORDER BY t.name, t.version DESC
            """, nativeQuery = true)
    List<EngagementEmailTemplate> findReusableFromOtherEngines(@Param("instituteId") String instituteId,
                                                               @Param("engineId") String engineId,
                                                               @Param("language") String language);
}
