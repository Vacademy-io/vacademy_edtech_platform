package vacademy.io.assessment_service.features.assessment_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolderMapping;

import java.util.List;

public interface AssessmentFolderMappingRepository extends JpaRepository<AssessmentFolderMapping, String> {

    List<AssessmentFolderMapping> findByInstituteIdAndAssessmentIdIn(String instituteId, List<String> assessmentIds);

    @Modifying
    @Query(value = "DELETE FROM assessment_folder_mapping WHERE assessment_id IN :assessmentIds", nativeQuery = true)
    int deleteByAssessmentIds(@Param("assessmentIds") List<String> assessmentIds);

    @Modifying
    @Query(value = "DELETE FROM assessment_folder_mapping WHERE folder_id = :folderId", nativeQuery = true)
    int deleteByFolderId(@Param("folderId") String folderId);

    @Query(value = "SELECT COALESCE(MAX(m.display_order), -1) FROM assessment_folder_mapping m WHERE m.folder_id = :folderId",
            nativeQuery = true)
    Integer findMaxDisplayOrder(@Param("folderId") String folderId);

    List<AssessmentFolderMapping> findByFolderId(String folderId);

    /**
     * The folder's draft and published tests in the order students see them: display_order
     * (all 0 = by name, 1..N = arranged by an admin), then the name, then the id.
     * Columns: assessment id, name, status, display_order.
     */
    @Query(value = "SELECT a.id, a.name, a.status, m.display_order FROM assessment_folder_mapping m " +
            "JOIN assessment a ON a.id = m.assessment_id " +
            "WHERE m.folder_id = :folderId AND a.status IN ('PUBLISHED', 'DRAFT') " +
            "ORDER BY m.display_order ASC, " + AssessmentRepository.NATURAL_NAME_SORT_KEY + " ASC, a.id ASC",
            nativeQuery = true)
    List<Object[]> findFolderTestsInOrder(@Param("folderId") String folderId);

    /** Back to name order: every test of the folder at 0. */
    @Modifying
    @Query(value = "UPDATE assessment_folder_mapping SET display_order = 0, updated_at = CURRENT_TIMESTAMP " +
            "WHERE folder_id = :folderId", nativeQuery = true)
    int resetDisplayOrder(@Param("folderId") String folderId);

    /** Of the given ids, the ones that belong to the institute (guards moves across institutes). */
    @Query(value = """
            SELECT DISTINCT aim.assessment_id FROM assessment_institute_mapping aim
             WHERE aim.institute_id = :instituteId AND aim.assessment_id IN :assessmentIds
            """, nativeQuery = true)
    List<String> findInstituteAssessmentIds(@Param("instituteId") String instituteId,
                                            @Param("assessmentIds") List<String> assessmentIds);
}
