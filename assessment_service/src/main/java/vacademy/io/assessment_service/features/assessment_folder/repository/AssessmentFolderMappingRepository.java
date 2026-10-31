package vacademy.io.assessment_service.features.assessment_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /** Of the given ids, the ones that belong to the institute (guards moves across institutes). */
    @Query(value = """
            SELECT DISTINCT aim.assessment_id FROM assessment_institute_mapping aim
             WHERE aim.institute_id = :instituteId AND aim.assessment_id IN :assessmentIds
            """, nativeQuery = true)
    List<String> findInstituteAssessmentIds(@Param("instituteId") String instituteId,
                                            @Param("assessmentIds") List<String> assessmentIds);
}
