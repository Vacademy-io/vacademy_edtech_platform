package vacademy.io.assessment_service.features.question_paper_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.question_paper_folder.entity.QuestionPaperFolderMapping;

import java.util.List;

public interface QuestionPaperFolderMappingRepository extends JpaRepository<QuestionPaperFolderMapping, String> {

    List<QuestionPaperFolderMapping> findByInstituteIdAndQuestionPaperIdIn(String instituteId, List<String> questionPaperIds);

    @Modifying
    @Query(value = "DELETE FROM question_paper_folder_mapping WHERE institute_id = :instituteId "
            + "AND question_paper_id IN :questionPaperIds", nativeQuery = true)
    int deleteByInstituteAndPaperIds(@Param("instituteId") String instituteId,
                                     @Param("questionPaperIds") List<String> questionPaperIds);

    @Modifying
    @Query(value = "DELETE FROM question_paper_folder_mapping WHERE folder_id = :folderId", nativeQuery = true)
    int deleteByFolderId(@Param("folderId") String folderId);

    /** Of the given ids, the papers that belong to the institute (guards moves across institutes). */
    @Query(value = """
            SELECT DISTINCT iq.question_paper_id FROM institute_question_paper iq
             WHERE iq.institute_id = :instituteId AND iq.question_paper_id IN :questionPaperIds
            """, nativeQuery = true)
    List<String> findInstitutePaperIds(@Param("instituteId") String instituteId,
                                       @Param("questionPaperIds") List<String> questionPaperIds);
}
