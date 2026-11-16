package vacademy.io.admin_core_service.features.learner_home.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;

import java.util.List;
import java.util.Optional;

@Repository
public interface LearnerHomeLayoutRepository extends JpaRepository<LearnerHomeLayout, String> {

    Optional<LearnerHomeLayout> findFirstByInstituteIdAndStatus(String instituteId, String status);

    Optional<LearnerHomeLayout> findFirstByInstituteIdAndVersionAndStatusIn(String instituteId, int version,
                                                                            List<String> statuses);

    /**
     * Locks the draft row until the transaction ends and reads its current revision straight from
     * the database (a managed entity in the persistence context could hold an older one).
     * Rows of (revision, updated_by_user_id, updated_at); empty when the row is gone.
     */
    @Query(value = "SELECT revision, updated_by_user_id, updated_at FROM learner_home_layout "
            + "WHERE id = :id AND status = 'DRAFT' FOR UPDATE", nativeQuery = true)
    List<Object[]> lockDraftState(@Param("id") String id);

    /** Same row state without the lock (for a 409 answer). */
    @Query(value = "SELECT revision, updated_by_user_id, updated_at FROM learner_home_layout "
            + "WHERE id = :id", nativeQuery = true)
    List<Object[]> draftState(@Param("id") String id);

    /**
     * Optimistic draft save: bumps the revision only when the caller saw the current one.
     * Zero rows = someone saved in between (409 STALE_DRAFT).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "UPDATE learner_home_layout SET revision = revision + 1, updated_at = now(), "
            + "updated_by_user_id = :userId, settings_json = CAST(:settings AS jsonb) "
            + "WHERE id = :id AND revision = :revision AND status = 'DRAFT'", nativeQuery = true)
    int bumpDraftRevision(@Param("id") String id, @Param("revision") int revision, @Param("userId") String userId,
                          @Param("settings") String settingsJson);

    @Query(value = "SELECT COALESCE(MAX(version), 0) FROM learner_home_layout WHERE institute_id = :instituteId",
            nativeQuery = true)
    int maxVersion(@Param("instituteId") String instituteId);

    /** PUBLISHED and ARCHIVED versions, newest first. */
    @Query(value = "SELECT * FROM learner_home_layout WHERE institute_id = :instituteId "
            + "AND status IN ('PUBLISHED', 'ARCHIVED') ORDER BY version DESC LIMIT :lim", nativeQuery = true)
    List<LearnerHomeLayout> findVersions(@Param("instituteId") String instituteId, @Param("lim") int limit);

    /** Keeps the newest {@code keep} ARCHIVED versions; their blocks go with them (ON DELETE CASCADE). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "DELETE FROM learner_home_layout WHERE institute_id = :instituteId AND status = 'ARCHIVED' "
            + "AND id NOT IN (SELECT id FROM learner_home_layout WHERE institute_id = :instituteId "
            + "AND status = 'ARCHIVED' ORDER BY version DESC LIMIT :keep)", nativeQuery = true)
    int pruneArchived(@Param("instituteId") String instituteId, @Param("keep") int keep);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "DELETE FROM learner_home_layout WHERE id = :id", nativeQuery = true)
    int deleteLayout(@Param("id") String id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "UPDATE learner_home_layout SET status = 'ARCHIVED', updated_at = now() "
            + "WHERE institute_id = :instituteId AND status = 'PUBLISHED'", nativeQuery = true)
    int archivePublished(@Param("instituteId") String instituteId);
}
