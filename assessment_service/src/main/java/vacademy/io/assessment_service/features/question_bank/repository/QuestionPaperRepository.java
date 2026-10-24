package vacademy.io.assessment_service.features.question_bank.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.question_bank.entity.QuestionPaper;

import java.util.List;

public interface QuestionPaperRepository extends JpaRepository<QuestionPaper, String>, QuestionPaperCustomRepository {

    @Query(value = "SELECT qp.* FROM institute_question_paper iq INNER JOIN question_paper qp ON iq.question_paper_id = qp.id WHERE iq.institute_id = :instituteId",
            countQuery = "SELECT COUNT(qp.id) FROM institute_question_paper iq INNER JOIN question_paper qp ON iq.question_paper_id = qp.id WHERE iq.institute_id = :instituteId",
            nativeQuery = true)
    Page<QuestionPaper> findByInstituteId(@Param("instituteId") String instituteId, Pageable pageable);

    @Modifying
    @Transactional
    @Query(value = "INSERT INTO institute_question_paper (id, question_paper_id, institute_id, status, level_id, subject_id) VALUES (:id, :questionPaperId, :instituteId, :status, :levelId, :subjectId)", nativeQuery = true)
    void linkInstituteToQuestionPaper(@Param("id") String id, @Param("questionPaperId") String questionPaperId, @Param("instituteId") String instituteId, @Param("status") String status, @Param("levelId") String levelId, @Param("subjectId") String subjectId);

    @Query(
            value = "SELECT qp.id AS id, qp.title AS title, iq.status AS status, " +
                    "iq.level_id AS levelId, iq.subject_id AS subjectId, " +
                    "qp.created_on AS createdOn, " +
                    "qp.updated_on AS updatedOn, qp.created_by_user_id AS createdByUserId " +
                    "FROM question_paper qp " +
                    "LEFT JOIN institute_question_paper iq ON qp.id = iq.question_paper_id " +
                    "WHERE (:title IS NULL OR qp.title ILIKE CONCAT('%', :title, '%')) " +
                    "AND (:status IS NULL OR iq.status IN (:status)) " +
                    "AND (:levelIds IS NULL OR iq.level_id IN (:levelIds)) " +
                    "AND (:subjectIds IS NULL OR iq.subject_id IN (:subjectIds)) " +
                    "AND (:instituteIds IS NULL OR iq.institute_id IN (:instituteIds)) " +
                    "AND (:tagIdsCsv IS NULL OR EXISTS (" +
                    "    SELECT 1 FROM question_question_paper_mapping qqpm " +
                    "    JOIN entity_tags et ON et.entity_id = qqpm.question_id " +
                    "        AND et.entity_name = 'QUESTION' AND et.tag_source = 'SUBJECT' " +
                    "    WHERE qqpm.question_paper_id = qp.id " +
                    "        AND et.tag_id = ANY(string_to_array(:tagIdsCsv, ',')))) " +
                    "AND (:createdByUserId IS NULL OR qp.created_by_user_id = :createdByUserId)",
            countQuery = "SELECT COUNT(qp) FROM question_paper qp " +
                    "LEFT JOIN institute_question_paper iq ON qp.id = iq.question_paper_id " +
                    "WHERE (:title IS NULL OR qp.title ILIKE CONCAT('%', :title, '%')) " +
                    "AND (:status IS NULL OR iq.status IN (:status)) " +
                    "AND (:levelIds IS NULL OR iq.level_id IN (:levelIds)) " +
                    "AND (:subjectIds IS NULL OR iq.subject_id IN (:subjectIds)) " +
                    "AND (:instituteIds IS NULL OR iq.institute_id IN (:instituteIds)) " +
                    "AND (:tagIdsCsv IS NULL OR EXISTS (" +
                    "    SELECT 1 FROM question_question_paper_mapping qqpm " +
                    "    JOIN entity_tags et ON et.entity_id = qqpm.question_id " +
                    "        AND et.entity_name = 'QUESTION' AND et.tag_source = 'SUBJECT' " +
                    "    WHERE qqpm.question_paper_id = qp.id " +
                    "        AND et.tag_id = ANY(string_to_array(:tagIdsCsv, ',')))) " +
                    "AND (:createdByUserId IS NULL OR qp.created_by_user_id = :createdByUserId)",
            nativeQuery = true
    )
    Page<Object[]> findQuestionPapersByFilters(
            @Param("title") String title,
            @Param("status") List<String> status,
            @Param("levelIds") List<String> levelIds,
            @Param("subjectIds") List<String> subjectIds,
            @Param("createdByUserId") String createdByUserId,
            @Param("instituteIds") List<String> instituteIds,
            @Param("tagIdsCsv") String tagIdsCsv,
            Pageable pageable
    );


    @Query(
            value = "SELECT qp.id AS id, qp.title AS title, " +
                    "qp.created_on AS createdOn, " +
                    "qp.updated_on AS updatedOn " +
                    "FROM question_paper qp " +
                    "WHERE (:title IS NULL OR qp.title ILIKE CONCAT('%', :title, '%')) " +
                    "AND qp.access ILIKE 'PUBLIC' ",
            countQuery = "SELECT COUNT(qp) FROM question_paper qp " +
                    "WHERE (:title IS NULL OR qp.title ILIKE CONCAT('%', :title, '%')) " +
                    "AND qp.access ILIKE 'PUBLIC' ",
            nativeQuery = true
    )
    Page<Object[]> findPublicQuestionPapersByFilters(
            @Param("title") String title,
            Pageable pageable
    );

    @Modifying
    @Transactional
    @Query(value = "UPDATE question_paper SET access = 'PRIVATE' WHERE id = :id AND access = 'PUBLIC' ", nativeQuery = true)
    void deletePublicQuestionPaperById(String id);

    @Modifying
    @Transactional
    @Query(value = "UPDATE institute_question_paper SET status = :status, updated_on = CURRENT_TIMESTAMP WHERE institute_id = :instituteId AND question_paper_id = :questionPaperId", nativeQuery = true)
    void updateStatusForInstituteQuestionPaper(String instituteId, String questionPaperId, String status);

    /**
     * Does this paper already belong to this institute?
     * <p>
     * linkInstituteToQuestionPaper is a bare INSERT with a fresh UUID, so calling it on
     * every update piled up duplicate institute_question_paper rows for the same pair —
     * which the paper-listing query then multiplies through its LEFT JOIN.
     */
    @Query(value = "SELECT COUNT(*) FROM institute_question_paper WHERE question_paper_id = :questionPaperId AND institute_id = :instituteId", nativeQuery = true)
    long countInstituteQuestionPaperLink(@Param("questionPaperId") String questionPaperId, @Param("instituteId") String instituteId);

    @Modifying
    @Transactional
    @Query(value = "UPDATE institute_question_paper SET status = :status, level_id = :levelId, subject_id = :subjectId, updated_on = CURRENT_TIMESTAMP WHERE question_paper_id = :questionPaperId AND institute_id = :instituteId", nativeQuery = true)
    void updateInstituteQuestionPaperLink(@Param("questionPaperId") String questionPaperId, @Param("instituteId") String instituteId, @Param("status") String status, @Param("levelId") String levelId, @Param("subjectId") String subjectId);

}
