package vacademy.io.assessment_service.features.question_paper_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolder;

import java.util.List;
import java.util.Optional;

public interface QuestionPaperFolderRepository extends JpaRepository<QuestionPaperFolder, String> {

    Optional<QuestionPaperFolder> findByIdAndInstituteId(String id, String instituteId);

    List<QuestionPaperFolder> findByInstituteIdAndIdIn(String instituteId, List<String> ids);

    @Query(value = "SELECT COALESCE(MAX(f.display_order), -1) FROM question_paper_folder f WHERE f.institute_id = :instituteId",
            nativeQuery = true)
    Integer findMaxDisplayOrder(@Param("instituteId") String instituteId);

    /**
     * id, name, description, image_url, display_order, status, parent_id, paper_count.
     * paper_count is what the All tab would list inside the folder: papers of this institute
     * that are ACTIVE or FAVOURITE (deleted papers keep their mapping but are not counted).
     */
    @Query(value = """
            SELECT f.id, f.name, f.description, f.image_url, f.display_order, f.status, f.parent_id,
                   COUNT(DISTINCT iq.question_paper_id) AS paper_count
              FROM question_paper_folder f
              LEFT JOIN question_paper_folder_mapping m ON m.folder_id = f.id
              LEFT JOIN institute_question_paper iq ON iq.question_paper_id = m.question_paper_id
                   AND iq.institute_id = f.institute_id
                   AND iq.status IN ('ACTIVE', 'FAVOURITE')
             WHERE f.institute_id = :instituteId
             GROUP BY f.id, f.name, f.description, f.image_url, f.display_order, f.status, f.parent_id, f.created_at
             ORDER BY f.display_order ASC, f.created_at ASC
            """, nativeQuery = true)
    List<Object[]> findAdminFolders(@Param("instituteId") String instituteId);
}
