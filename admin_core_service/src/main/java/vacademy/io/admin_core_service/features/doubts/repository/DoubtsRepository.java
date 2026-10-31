package vacademy.io.admin_core_service.features.doubts.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;

import java.util.Date;
import java.util.List;

@Repository
public interface DoubtsRepository extends JpaRepository<Doubts, String> {

    /**
     * Assignee predicate: with {@code assigneeUserIds} set, doubts that have an ACTIVE explicit
     * assignee among them; with {@code unassignedOnly}, doubts with no ACTIVE explicit assignee at
     * all; both set ⇒ either. Workflow-status predicate: legacy rows with a NULL workflow_status match
     * through their coarse status (RESOLVED → RESOLVED, anything else → PENDING), mirroring
     * {@code DoubtStatusCatalog#effectiveKey}.
     */
    @Query(value = """
        SELECT d.* FROM doubts d
        WHERE (:contentPositions IS NULL OR d.content_position IN :contentPositions)
          AND (:contentTypes IS NULL OR d.content_type IN :contentTypes)
          AND (:sources IS NULL OR d.source IN :sources)
          AND (:sourceIds IS NULL OR d.source_id IN :sourceIds)
          AND (:types IS NULL OR d.type IN :types)
          AND (:userIds IS NULL OR d.user_id IN :userIds)
          AND (:status IS NULL OR d.status IN :status)
          AND (:instituteId IS NULL OR d.institute_id = :instituteId)
          AND (d.raised_time BETWEEN :startDate AND :endDate)
          AND d.parent_id IS NULL
          AND (CAST(:hasBatchIds AS boolean) = false OR d.package_session_id IN :batchIds)
          AND (
            (CAST(:hasAssigneeUserIds AS boolean) = false AND CAST(:unassignedOnly AS boolean) = false)
            OR (CAST(:hasAssigneeUserIds AS boolean) = true AND EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
                  AND fa.source_id IN :assigneeUserIds
            ))
            OR (CAST(:unassignedOnly AS boolean) = true AND NOT EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
            ))
          )
          AND (CAST(:hasWorkflowStatuses AS boolean) = false
               OR COALESCE(d.workflow_status, CASE WHEN d.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END) IN :workflowStatuses)
        """,
            countQuery = """
        SELECT COUNT(d.*) FROM doubts d
        WHERE (:contentPositions IS NULL OR d.content_position IN :contentPositions)
          AND (:contentTypes IS NULL OR d.content_type IN :contentTypes)
          AND (:sources IS NULL OR d.source IN :sources)
          AND (:sourceIds IS NULL OR d.source_id IN :sourceIds)
          AND (:types IS NULL OR d.type IN :types)
          AND (:userIds IS NULL OR d.user_id IN :userIds)
          AND (:status IS NULL OR d.status IN :status)
          AND (:instituteId IS NULL OR d.institute_id = :instituteId)
          AND (d.raised_time BETWEEN :startDate AND :endDate)
          AND d.parent_id IS NULL
          AND (CAST(:hasBatchIds AS boolean) = false OR d.package_session_id IN :batchIds)
          AND (
            (CAST(:hasAssigneeUserIds AS boolean) = false AND CAST(:unassignedOnly AS boolean) = false)
            OR (CAST(:hasAssigneeUserIds AS boolean) = true AND EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
                  AND fa.source_id IN :assigneeUserIds
            ))
            OR (CAST(:unassignedOnly AS boolean) = true AND NOT EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
            ))
          )
          AND (CAST(:hasWorkflowStatuses AS boolean) = false
               OR COALESCE(d.workflow_status, CASE WHEN d.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END) IN :workflowStatuses)
        """,nativeQuery = true)
    Page<Doubts> findDoubtsWithFilter(@Param("contentPositions") List<String> contentPositions,
                                      @Param("contentTypes") List<String> contentTypes,
                                      @Param("sources") List<String> sources,
                                      @Param("sourceIds") List<String> sourceIds,
                                      @Param("types") List<String> types,
                                      @Param("userIds") List<String> userIds,
                                      @Param("status") List<String> status,
                                      @Param("instituteId") String instituteId,
                                      @Param("batchIds") List<String> batchIds,
                                      @Param("hasBatchIds") boolean hasBatchIds,
                                      @Param("assigneeUserIds") List<String> assigneeUserIds,
                                      @Param("hasAssigneeUserIds") boolean hasAssigneeUserIds,
                                      @Param("unassignedOnly") boolean unassignedOnly,
                                      @Param("workflowStatuses") List<String> workflowStatuses,
                                      @Param("hasWorkflowStatuses") boolean hasWorkflowStatuses,
                                      @Param("startDate") Date startDate,
                                      @Param("endDate") Date endDate,
                                      Pageable pageable);

    /**
     * Same filter set as {@link #findDoubtsWithFilter}, additionally restricted to doubts
     * that are visible to the given viewer (teacher / student / non-admin staff). A doubt is
     * visible if any of:
     *   - the viewer raised the doubt themselves (d.user_id = :viewerUserId), so students still
     *     see their own questions and can follow replies
     *   - the viewer is assigned via doubt_assignee (source='USER', status='ACTIVE') — this is the
     *     setting-driven path (DOUBT_MANAGEMENT_SETTING routes new doubts to subject/batch teachers,
     *     a role, or specific staff), and it ALWAYS applies regardless of the scope flags below
     *   - {@code scopeBatch} is on AND the viewer has an ACTIVE FSPSSM mapping (any subject) to the
     *     doubt's package_session — i.e. "batch teacher sees the whole batch"
     *   - {@code scopeSubject} is on AND either the viewer has an ACTIVE batch-level FSPSSM
     *     (subject_id IS NULL) for the doubt's package_session, or an ACTIVE subject-level FSPSSM
     *     whose subject maps (via subject_module_mapping/module_chapter_mapping/chapter_to_slides)
     *     back to the doubt's slide — i.e. "subject teacher sees their subject's doubts"
     *
     * {@code scopeBatch}/{@code scopeSubject} are derived by {@code DoubtsManager#getAllDoubts} from
     * the institute's DOUBT_MANAGEMENT_SETTING default_assignee_source so live FSPSSM visibility
     * MIRRORS what the admin configured: BATCH_TEACHER/BOTH (and the no-setting default) → scopeBatch;
     * SUBJECT_TEACHER → scopeSubject; NONE/ROLE/SPECIFIC_USERS → neither (assignment-only). The
     * doubt_assignee path above still covers role/specific-user routing and any manual assignment.
     */
    @Query(value = """
        SELECT d.* FROM doubts d
        WHERE (:contentPositions IS NULL OR d.content_position IN :contentPositions)
          AND (:contentTypes IS NULL OR d.content_type IN :contentTypes)
          AND (:sources IS NULL OR d.source IN :sources)
          AND (:sourceIds IS NULL OR d.source_id IN :sourceIds)
          AND (:types IS NULL OR d.type IN :types)
          AND (:userIds IS NULL OR d.user_id IN :userIds)
          AND (:status IS NULL OR d.status IN :status)
          AND (:instituteId IS NULL OR d.institute_id = :instituteId)
          AND (d.raised_time BETWEEN :startDate AND :endDate)
          AND d.parent_id IS NULL
          AND (CAST(:hasBatchIds AS boolean) = false OR d.package_session_id IN :batchIds)
          AND (
            (CAST(:hasAssigneeUserIds AS boolean) = false AND CAST(:unassignedOnly AS boolean) = false)
            OR (CAST(:hasAssigneeUserIds AS boolean) = true AND EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
                  AND fa.source_id IN :assigneeUserIds
            ))
            OR (CAST(:unassignedOnly AS boolean) = true AND NOT EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
            ))
          )
          AND (CAST(:hasWorkflowStatuses AS boolean) = false
               OR COALESCE(d.workflow_status, CASE WHEN d.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END) IN :workflowStatuses)
          AND (
            d.user_id = :viewerUserId
            OR EXISTS (
                SELECT 1 FROM doubt_assignee da
                WHERE da.doubt_id = d.id
                  AND da.source = 'USER'
                  AND da.source_id = :viewerUserId
                  AND da.status = 'ACTIVE'
            )
            OR (
                CAST(:scopeBatch AS boolean) = true
                AND EXISTS (
                    SELECT 1 FROM faculty_subject_package_session_mapping fm
                    WHERE fm.user_id = :viewerUserId
                      AND fm.status = 'ACTIVE'
                      AND (
                          fm.package_session_id = d.package_session_id
                          OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                      )
                )
            )
            OR (
                CAST(:scopeSubject AS boolean) = true
                AND (
                    EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping fm
                        WHERE fm.user_id = :viewerUserId
                          AND fm.status = 'ACTIVE'
                          AND fm.subject_id IS NULL
                          AND (
                              fm.package_session_id = d.package_session_id
                              OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                          )
                    )
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping fm
                        JOIN subject_module_mapping smm ON smm.subject_id = fm.subject_id
                        JOIN module_chapter_mapping mcm ON mcm.module_id = smm.module_id
                        JOIN chapter_to_slides cs ON cs.chapter_id = mcm.chapter_id
                        WHERE fm.user_id = :viewerUserId
                          AND fm.status = 'ACTIVE'
                          AND fm.subject_id IS NOT NULL
                          AND (
                              fm.package_session_id = d.package_session_id
                              OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                          )
                          AND cs.slide_id = d.source_id
                          AND d.source = 'SLIDE'
                    )
                )
            )
          )
        """,
            countQuery = """
        SELECT COUNT(d.*) FROM doubts d
        WHERE (:contentPositions IS NULL OR d.content_position IN :contentPositions)
          AND (:contentTypes IS NULL OR d.content_type IN :contentTypes)
          AND (:sources IS NULL OR d.source IN :sources)
          AND (:sourceIds IS NULL OR d.source_id IN :sourceIds)
          AND (:types IS NULL OR d.type IN :types)
          AND (:userIds IS NULL OR d.user_id IN :userIds)
          AND (:status IS NULL OR d.status IN :status)
          AND (:instituteId IS NULL OR d.institute_id = :instituteId)
          AND (d.raised_time BETWEEN :startDate AND :endDate)
          AND d.parent_id IS NULL
          AND (CAST(:hasBatchIds AS boolean) = false OR d.package_session_id IN :batchIds)
          AND (
            (CAST(:hasAssigneeUserIds AS boolean) = false AND CAST(:unassignedOnly AS boolean) = false)
            OR (CAST(:hasAssigneeUserIds AS boolean) = true AND EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
                  AND fa.source_id IN :assigneeUserIds
            ))
            OR (CAST(:unassignedOnly AS boolean) = true AND NOT EXISTS (
                SELECT 1 FROM doubt_assignee fa
                WHERE fa.doubt_id = d.id AND fa.source = 'USER' AND fa.status = 'ACTIVE'
            ))
          )
          AND (CAST(:hasWorkflowStatuses AS boolean) = false
               OR COALESCE(d.workflow_status, CASE WHEN d.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END) IN :workflowStatuses)
          AND (
            d.user_id = :viewerUserId
            OR EXISTS (
                SELECT 1 FROM doubt_assignee da
                WHERE da.doubt_id = d.id
                  AND da.source = 'USER'
                  AND da.source_id = :viewerUserId
                  AND da.status = 'ACTIVE'
            )
            OR (
                CAST(:scopeBatch AS boolean) = true
                AND EXISTS (
                    SELECT 1 FROM faculty_subject_package_session_mapping fm
                    WHERE fm.user_id = :viewerUserId
                      AND fm.status = 'ACTIVE'
                      AND (
                          fm.package_session_id = d.package_session_id
                          OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                      )
                )
            )
            OR (
                CAST(:scopeSubject AS boolean) = true
                AND (
                    EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping fm
                        WHERE fm.user_id = :viewerUserId
                          AND fm.status = 'ACTIVE'
                          AND fm.subject_id IS NULL
                          AND (
                              fm.package_session_id = d.package_session_id
                              OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                          )
                    )
                    OR EXISTS (
                        SELECT 1 FROM faculty_subject_package_session_mapping fm
                        JOIN subject_module_mapping smm ON smm.subject_id = fm.subject_id
                        JOIN module_chapter_mapping mcm ON mcm.module_id = smm.module_id
                        JOIN chapter_to_slides cs ON cs.chapter_id = mcm.chapter_id
                        WHERE fm.user_id = :viewerUserId
                          AND fm.status = 'ACTIVE'
                          AND fm.subject_id IS NOT NULL
                          AND (
                              fm.package_session_id = d.package_session_id
                              OR (fm.access_type = 'PACKAGE_SESSION' AND fm.access_id = d.package_session_id)
                          )
                          AND cs.slide_id = d.source_id
                          AND d.source = 'SLIDE'
                    )
                )
            )
          )
        """, nativeQuery = true)
    Page<Doubts> findDoubtsWithFilterForViewer(@Param("contentPositions") List<String> contentPositions,
                                               @Param("contentTypes") List<String> contentTypes,
                                               @Param("sources") List<String> sources,
                                               @Param("sourceIds") List<String> sourceIds,
                                               @Param("types") List<String> types,
                                               @Param("userIds") List<String> userIds,
                                               @Param("status") List<String> status,
                                               @Param("instituteId") String instituteId,
                                               @Param("batchIds") List<String> batchIds,
                                               @Param("hasBatchIds") boolean hasBatchIds,
                                               @Param("assigneeUserIds") List<String> assigneeUserIds,
                                               @Param("hasAssigneeUserIds") boolean hasAssigneeUserIds,
                                               @Param("unassignedOnly") boolean unassignedOnly,
                                               @Param("workflowStatuses") List<String> workflowStatuses,
                                               @Param("hasWorkflowStatuses") boolean hasWorkflowStatuses,
                                               @Param("startDate") Date startDate,
                                               @Param("endDate") Date endDate,
                                               @Param("viewerUserId") String viewerUserId,
                                               @Param("scopeBatch") boolean scopeBatch,
                                               @Param("scopeSubject") boolean scopeSubject,
                                               Pageable pageable);

    List<Doubts> findByParentIdAndStatusNotIn(String doubtId, List<String> name);
}
