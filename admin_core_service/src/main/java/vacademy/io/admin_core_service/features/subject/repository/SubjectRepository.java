package vacademy.io.admin_core_service.features.subject.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.common.institute.entity.student.Subject;

import java.util.List;

public interface SubjectRepository extends JpaRepository<Subject, String> {


    @Query(nativeQuery = true, value = """
                SELECT DISTINCT ON (s.subject_name) s.*
                FROM public.subject s
                JOIN public.subject_session ss ON s.id = ss.subject_id
                JOIN public.package_session ps ON ss.session_id = ps.id
                JOIN public.package_institute pi ON ps.package_id = pi.package_id
                WHERE pi.institute_id = :instituteId
                AND s.status = 'ACTIVE'
                AND ps.status != 'DELETED'
                ORDER BY s.subject_name ASC, ss.subject_order ASC NULLS LAST
            """)
    List<Subject> findDistinctSubjectsByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Names for a specific set of subject ids, with no institute/session filtering.
     *
     * {@link #findDistinctSubjectsByInstituteId} collapses same-named subjects with
     * DISTINCT ON and drops anything whose package session was deleted, so it can only
     * ever resolve a fraction of the subject ids stored elsewhere (an assessment keeps a
     * raw subject id). Callers that just need to render a stored id as a label use this
     * instead, otherwise the label falls back to "N/A" even though the subject exists.
     */
    @Query(nativeQuery = true, value = """
                SELECT s.* FROM public.subject s WHERE s.id IN (:subjectIds)
            """)
    List<Subject> findAllByIdIn(@Param("subjectIds") List<String> subjectIds);


    @Query(value = "SELECT DISTINCT s.*, ss.subject_order " +
            "FROM subject s " +
            "INNER JOIN subject_session ss ON s.id = ss.subject_id " +
            "INNER JOIN package_session ps ON ss.session_id = ps.id " +
            "WHERE ps.level_id = :levelId " +
            "AND ps.package_id = :packageId " +
            "AND ps.session_id = :sessionId " +
            "AND s.status = 'ACTIVE' " +
            "ORDER BY ss.subject_order ASC NULLS LAST", nativeQuery = true)
    List<Subject> findDistinctSubjectsPackageSession(
            @Param("levelId") String levelId,
            @Param("packageId") String packageId,
            @Param("sessionId") String sessionId
    );

    /** One (level, package, session) -> subject edge from {@link #findDistinctSubjectIdsPackageSessions}. */
    interface PackageSessionSubjectProjection {
        String getLevelId();

        String getPackageId();

        String getSessionId();

        String getSubjectId();
    }

    /**
     * Batched form of {@link #findDistinctSubjectsPackageSession}: same joins and status filter,
     * three equality checks widened to IN lists, and the triple carried back for regrouping.
     *
     * <p>subject_order ASC NULLS LAST stays the final sort key, so the sequence within any one
     * triple is identical to what the single-key query returned. Sorting by the triple first
     * only groups the rows, it does not reorder them inside a group.
     */
    @Query(value = """
            SELECT DISTINCT
                ps.level_id   AS "levelId",
                ps.package_id AS "packageId",
                ps.session_id AS "sessionId",
                s.id          AS "subjectId",
                ss.subject_order
            FROM subject s
            INNER JOIN subject_session ss ON s.id = ss.subject_id
            INNER JOIN package_session ps ON ss.session_id = ps.id
            WHERE ps.level_id IN (:levelIds)
              AND ps.package_id IN (:packageIds)
              AND ps.session_id IN (:sessionIds)
              AND s.status = 'ACTIVE'
            ORDER BY ps.level_id, ps.package_id, ps.session_id, ss.subject_order ASC NULLS LAST
            """, nativeQuery = true)
    List<PackageSessionSubjectProjection> findDistinctSubjectIdsPackageSessions(
            @Param("levelIds") List<String> levelIds,
            @Param("packageIds") List<String> packageIds,
            @Param("sessionIds") List<String> sessionIds
    );

    @Query(value = "SELECT DISTINCT s.* " +
            "FROM subject s " +
            "INNER JOIN subject_session ss ON s.id = ss.subject_id " +
            "WHERE ss.session_id IN (:packageSessionIds) AND s.status = 'ACTIVE' ", nativeQuery = true)
    List<Subject> findDistinctSubjectsOfPackageSessions(@Param("packageSessionIds") List<String> packageSessionIds);

    @Query(value = "SELECT DISTINCT s.* " +
            "FROM subject s " +
            "INNER JOIN subject_session ss ON s.id = ss.subject_id " +
            "WHERE ss.session_id = :packageSessionId " +
            "AND s.status = 'ACTIVE' ", nativeQuery = true)
    List<Subject> findDistinctSubjectsByPackageSessionId(@Param("packageSessionId") String packageSessionId);

    @Query(value = """
            SELECT DISTINCT s.* FROM subject s
            JOIN faculty_subject_package_session_mapping fm ON fm.subject_id = s.id
            WHERE fm.user_id = :userId
            AND fm.package_session_id = :packageSessionId
            AND fm.status = 'ACTIVE'
            """, nativeQuery = true)
    List<Subject> findSubjectForFaculty(@Param("userId") String userId,
                                        @Param("packageSessionId") String packageSessionId);

}