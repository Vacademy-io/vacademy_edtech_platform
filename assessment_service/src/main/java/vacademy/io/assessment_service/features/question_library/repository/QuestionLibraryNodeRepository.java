package vacademy.io.assessment_service.features.question_library.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.question_library.entity.QuestionLibraryNode;

import java.util.List;
import java.util.Optional;

/**
 * Nodes, question placements and question versions of the question library.
 * <p>
 * Multi-value parameters go over as comma-separated strings expanded with
 * string_to_array, the same pattern as QuestionRepository.findQuestionsByFilters, so an
 * empty list never has to be bound into a native IN clause.
 * <p>
 * Keep prose out of the SQL text below. Spring Data scans the raw string for quotes and
 * named parameters and Hibernate splices paging in at the first semicolon, so a comment
 * inside the SQL can crash the bean at boot or break paging at runtime.
 */
public interface QuestionLibraryNodeRepository extends JpaRepository<QuestionLibraryNode, String> {

    List<QuestionLibraryNode> findByInstituteIdAndStatusOrderByDisplayOrderAscCreatedAtAsc(String instituteId, String status);

    Optional<QuestionLibraryNode> findByIdAndInstituteIdAndStatus(String id, String instituteId, String status);

    List<QuestionLibraryNode> findByInstituteIdAndStatusAndIdIn(String instituteId, String status, List<String> ids);

    @Query(value = """
            SELECT COALESCE(MAX(n.display_order), -1) FROM question_library_node n
             WHERE n.institute_id = :instituteId AND n.status = 'ACTIVE'
               AND n.parent_id IS NOT DISTINCT FROM CAST(:parentId AS varchar)
            """, nativeQuery = true)
    Integer findMaxDisplayOrder(@Param("instituteId") String instituteId, @Param("parentId") String parentId);

    /**
     * For every active node: distinct live questions placed on it or on any node below
     * it, split by difficulty. Columns are node_id, total, easy, medium, hard.
     * A live question is ACTIVE and not replaced by a newer version.
     */
    @Query(value = """
            WITH RECURSIVE sub AS (
                SELECT n.id AS root_id, n.id AS node_id
                  FROM question_library_node n
                 WHERE n.institute_id = :instituteId AND n.status = 'ACTIVE'
                UNION ALL
                SELECT s.root_id, c.id
                  FROM sub s
                  JOIN question_library_node c ON c.parent_id = s.node_id AND c.status = 'ACTIVE'
            )
            SELECT s.root_id,
                   COUNT(DISTINCT q.id) AS total,
                   COUNT(DISTINCT q.id) FILTER (WHERE q.difficulty = 'EASY') AS easy,
                   COUNT(DISTINCT q.id) FILTER (WHERE q.difficulty = 'MEDIUM') AS medium,
                   COUNT(DISTINCT q.id) FILTER (WHERE q.difficulty = 'HARD') AS hard
              FROM sub s
              JOIN question_library_mapping m ON m.node_id = s.node_id
              JOIN question q ON q.id = m.question_id AND q.status = 'ACTIVE'
             WHERE NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
             GROUP BY s.root_id
            """, nativeQuery = true)
    List<Object[]> countQuestionsPerNode(@Param("instituteId") String instituteId);

    /** Live questions of the institute grouped by difficulty and type. Columns are difficulty, question_type, count. */
    @Query(value = """
            SELECT q.difficulty, q.question_type, COUNT(*)
              FROM question q
             WHERE q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND q.source_type IS DISTINCT FROM 'LIBRARY_COPY'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
             GROUP BY q.difficulty, q.question_type
            """, nativeQuery = true)
    List<Object[]> countLiveQuestionsByDifficultyAndType(@Param("instituteId") String instituteId);

    /** Live questions that sit in no topic. */
    @Query(value = """
            SELECT COUNT(*)
              FROM question q
             WHERE q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND q.source_type IS DISTINCT FROM 'LIBRARY_COPY'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
               AND NOT EXISTS (SELECT 1 FROM question_library_mapping m WHERE m.question_id = q.id)
            """, nativeQuery = true)
    long countUnsortedQuestions(@Param("instituteId") String instituteId);

    /** Live questions created in the last 7 days. */
    @Query(value = """
            SELECT COUNT(*)
              FROM question q
             WHERE q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND q.source_type IS DISTINCT FROM 'LIBRARY_COPY'
               AND q.created_at >= NOW() - INTERVAL '7 days'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
            """, nativeQuery = true)
    long countQuestionsAddedLastWeek(@Param("instituteId") String instituteId);

    /** What other institutes see: live questions placed on an active topic. Columns are difficulty, question_type, count. */
    @Query(value = """
            SELECT q.difficulty, q.question_type, COUNT(*)
              FROM question q
             WHERE q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
               AND EXISTS (SELECT 1 FROM question_library_mapping m
                             JOIN question_library_node n ON n.id = m.node_id AND n.status = 'ACTIVE'
                            WHERE m.question_id = q.id)
             GROUP BY q.difficulty, q.question_type
            """, nativeQuery = true)
    List<Object[]> countPlacedQuestionsByDifficultyAndType(@Param("instituteId") String instituteId);

    /** Live questions placed on an active topic and created in the last 7 days. */
    @Query(value = """
            SELECT COUNT(*)
              FROM question q
             WHERE q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND q.created_at >= NOW() - INTERVAL '7 days'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
               AND EXISTS (SELECT 1 FROM question_library_mapping m
                             JOIN question_library_node n ON n.id = m.node_id AND n.status = 'ACTIVE'
                            WHERE m.question_id = q.id)
            """, nativeQuery = true)
    long countPlacedQuestionsAddedLastWeek(@Param("instituteId") String instituteId);

    /** Those of the given questions that the library offers: live, and placed on an active topic. */
    @Query(value = """
            SELECT q.id
              FROM question q
             WHERE q.id = ANY(string_to_array(:questionIdsCsv, ','))
               AND q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
               AND EXISTS (SELECT 1 FROM question_library_mapping m
                             JOIN question_library_node n ON n.id = m.node_id AND n.status = 'ACTIVE'
                            WHERE m.question_id = q.id)
            """, nativeQuery = true)
    List<String> findPlacedLiveQuestionIds(@Param("instituteId") String instituteId,
                                           @Param("questionIdsCsv") String questionIdsCsv);

    /** The library questions the given copies were made from. */
    @Query(value = """
            SELECT q.source_meta ->> 'library_question_id'
              FROM question q
             WHERE q.id = ANY(string_to_array(:questionIdsCsv, ','))
               AND q.source_type = 'LIBRARY_COPY'
               AND q.source_meta ->> 'library_question_id' IS NOT NULL
            """, nativeQuery = true)
    List<String> findLibrarySourcesOfCopies(@Param("questionIdsCsv") String questionIdsCsv);

    /** One step along the version chain. Columns are old_question_id, new_question_id. */
    @Query(value = """
            SELECT v.old_question_id, v.new_question_id
              FROM question_library_version v
             WHERE v.institute_id = :instituteId
               AND v.old_question_id = ANY(string_to_array(:questionIdsCsv, ','))
            """, nativeQuery = true)
    List<Object[]> findNewerVersions(@Param("instituteId") String instituteId,
                                     @Param("questionIdsCsv") String questionIdsCsv);

    @Modifying
    @Query(value = """
            INSERT INTO question_library_paper (node_id, question_paper_id, institute_id)
            VALUES (:nodeId, :questionPaperId, :instituteId)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int addPaperToNode(@Param("instituteId") String instituteId,
                       @Param("nodeId") String nodeId,
                       @Param("questionPaperId") String questionPaperId);

    @Modifying
    @Query(value = """
            DELETE FROM question_library_paper
             WHERE institute_id = :instituteId AND node_id = :nodeId AND question_paper_id = :questionPaperId
            """, nativeQuery = true)
    int removePaperFromNode(@Param("instituteId") String instituteId,
                            @Param("nodeId") String nodeId,
                            @Param("questionPaperId") String questionPaperId);

    /**
     * Papers on the given topics, or on every active topic when nodeIdsCsv is null, newest
     * first. Columns are node_id, question_paper_id, title, live_question_count.
     */
    @Query(value = """
            SELECT lp.node_id, qp.id, qp.title, COUNT(DISTINCT q.id)
              FROM question_library_paper lp
              JOIN question_library_node n ON n.id = lp.node_id AND n.status = 'ACTIVE'
              JOIN question_paper qp ON qp.id = lp.question_paper_id
              LEFT JOIN question_question_paper_mapping m ON m.question_paper_id = qp.id
              LEFT JOIN question q ON q.id = m.question_id AND q.status = 'ACTIVE'
             WHERE lp.institute_id = :instituteId
               AND (CAST(:nodeIdsCsv AS text) IS NULL OR lp.node_id = ANY(string_to_array(CAST(:nodeIdsCsv AS text), ',')))
             GROUP BY lp.node_id, qp.id, qp.title, lp.created_at
             ORDER BY lp.created_at DESC, qp.title
            """, nativeQuery = true)
    List<Object[]> findPapersOnNodes(@Param("instituteId") String instituteId,
                                     @Param("nodeIdsCsv") String nodeIdsCsv);

    /** Whether a paper sits on an active topic of the library. */
    @Query(value = """
            SELECT COUNT(*)
              FROM question_library_paper lp
              JOIN question_library_node n ON n.id = lp.node_id AND n.status = 'ACTIVE'
             WHERE lp.institute_id = :instituteId AND lp.question_paper_id = :questionPaperId
            """, nativeQuery = true)
    long countPaperInLibrary(@Param("instituteId") String instituteId,
                             @Param("questionPaperId") String questionPaperId);

    /** Puts the given questions on a node. Only ACTIVE questions of this institute are written. */
    @Modifying
    @Query(value = """
            INSERT INTO question_library_mapping (node_id, question_id, institute_id)
            SELECT CAST(:nodeId AS varchar), q.id, q.institute_id
              FROM question q
             WHERE q.id = ANY(string_to_array(:questionIdsCsv, ','))
               AND q.institute_id = :instituteId AND q.status = 'ACTIVE'
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int addQuestionsToNode(@Param("instituteId") String instituteId,
                           @Param("nodeId") String nodeId,
                           @Param("questionIdsCsv") String questionIdsCsv);

    /** Takes the given questions off the given nodes, or off every node when nodeIdsCsv is null. */
    @Modifying
    @Query(value = """
            DELETE FROM question_library_mapping
             WHERE institute_id = :instituteId
               AND question_id = ANY(string_to_array(:questionIdsCsv, ','))
               AND (CAST(:nodeIdsCsv AS text) IS NULL OR node_id = ANY(string_to_array(CAST(:nodeIdsCsv AS text), ',')))
            """, nativeQuery = true)
    int removeQuestionsFromNodes(@Param("instituteId") String instituteId,
                                 @Param("questionIdsCsv") String questionIdsCsv,
                                 @Param("nodeIdsCsv") String nodeIdsCsv);

    @Modifying
    @Query(value = """
            DELETE FROM question_library_mapping
             WHERE institute_id = :instituteId
               AND node_id = ANY(string_to_array(:nodeIdsCsv, ','))
            """, nativeQuery = true)
    int removeAllQuestionsFromNodes(@Param("instituteId") String instituteId, @Param("nodeIdsCsv") String nodeIdsCsv);

    @Modifying
    @Query(value = """
            UPDATE question_library_node SET status = 'DELETED', updated_at = CURRENT_TIMESTAMP
             WHERE institute_id = :instituteId AND id = ANY(string_to_array(:nodeIdsCsv, ','))
            """, nativeQuery = true)
    int markNodesDeleted(@Param("instituteId") String instituteId, @Param("nodeIdsCsv") String nodeIdsCsv);

    /** Puts every live question of a paper on a node. The caller checks the paper belongs to the institute. */
    @Modifying
    @Query(value = """
            INSERT INTO question_library_mapping (node_id, question_id, institute_id)
            SELECT DISTINCT CAST(:nodeId AS varchar), q.id, q.institute_id
              FROM question_question_paper_mapping qp
              JOIN question q ON q.id = qp.question_id
             WHERE qp.question_paper_id = :questionPaperId
               AND q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int addPaperQuestionsToNode(@Param("instituteId") String instituteId,
                                @Param("nodeId") String nodeId,
                                @Param("questionPaperId") String questionPaperId);

    /** SUBJECT tags used on this institute questions. Columns are tag_id, tag_name, question_count. */
    @Query(value = """
            SELECT t.tag_id, t.tag_name, COUNT(DISTINCT q.id)
              FROM entity_tags et
              JOIN tags t ON t.tag_id = et.tag_id
              JOIN question q ON q.id = et.entity_id
             WHERE et.entity_name = 'QUESTION' AND et.tag_source = 'SUBJECT'
               AND q.institute_id = :instituteId AND q.status = 'ACTIVE'
             GROUP BY t.tag_id, t.tag_name
             ORDER BY t.tag_name
            """, nativeQuery = true)
    List<Object[]> findSubjectTagsWithCounts(@Param("instituteId") String instituteId);

    @Modifying
    @Query(value = """
            INSERT INTO question_library_mapping (node_id, question_id, institute_id)
            SELECT DISTINCT CAST(:nodeId AS varchar), q.id, q.institute_id
              FROM entity_tags et
              JOIN question q ON q.id = et.entity_id
             WHERE et.entity_name = 'QUESTION' AND et.tag_source = 'SUBJECT' AND et.tag_id = :tagId
               AND q.institute_id = :instituteId AND q.status = 'ACTIVE'
               AND NOT EXISTS (SELECT 1 FROM question_library_version v WHERE v.old_question_id = q.id)
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int addTaggedQuestionsToNode(@Param("instituteId") String instituteId,
                                 @Param("nodeId") String nodeId,
                                 @Param("tagId") String tagId);

    /** Topic placements of the given questions. Columns are question_id, node_id. */
    @Query(value = """
            SELECT m.question_id, m.node_id
              FROM question_library_mapping m
              JOIN question_library_node n ON n.id = m.node_id AND n.status = 'ACTIVE'
             WHERE m.institute_id = :instituteId
               AND m.question_id = ANY(string_to_array(:questionIdsCsv, ','))
            """, nativeQuery = true)
    List<Object[]> findNodesOfQuestions(@Param("instituteId") String instituteId,
                                        @Param("questionIdsCsv") String questionIdsCsv);

    /** How many assessments use each of the given questions. Columns are question_id, assessment_count. */
    @Query(value = """
            SELECT qasm.question_id, COUNT(DISTINCT s.assessment_id)
              FROM question_assessment_section_mapping qasm
              JOIN section s ON s.id = qasm.section_id
             WHERE qasm.question_id = ANY(string_to_array(:questionIdsCsv, ','))
             GROUP BY qasm.question_id
            """, nativeQuery = true)
    List<Object[]> countAssessmentsUsingQuestions(@Param("questionIdsCsv") String questionIdsCsv);

    @Query(value = "SELECT COUNT(*) FROM question_library_version v WHERE v.old_question_id = :questionId", nativeQuery = true)
    long countReplacedVersions(@Param("questionId") String questionId);

    @Modifying
    @Query(value = """
            INSERT INTO question_library_version (old_question_id, new_question_id, institute_id, created_by)
            VALUES (:oldQuestionId, :newQuestionId, :instituteId, :createdBy)
            ON CONFLICT (old_question_id) DO NOTHING
            """, nativeQuery = true)
    int recordVersion(@Param("oldQuestionId") String oldQuestionId,
                      @Param("newQuestionId") String newQuestionId,
                      @Param("instituteId") String instituteId,
                      @Param("createdBy") String createdBy);

    @Modifying
    @Query(value = """
            INSERT INTO question_library_mapping (node_id, question_id, institute_id)
            SELECT m.node_id, CAST(:newQuestionId AS varchar), m.institute_id
              FROM question_library_mapping m
             WHERE m.question_id = :oldQuestionId AND m.institute_id = :instituteId
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int copyPlacements(@Param("instituteId") String instituteId,
                       @Param("oldQuestionId") String oldQuestionId,
                       @Param("newQuestionId") String newQuestionId);

    /** Copies the AI tag and topic links of a question. SUBJECT tags are written from the edit itself. */
    @Modifying
    @Query(value = """
            INSERT INTO entity_tags (entity_id, entity_name, tag_id, tag_source)
            SELECT CAST(:newQuestionId AS varchar), et.entity_name, et.tag_id, et.tag_source
              FROM entity_tags et
             WHERE et.entity_name = 'QUESTION' AND et.entity_id = :oldQuestionId
               AND (et.tag_source IS NULL OR et.tag_source <> 'SUBJECT')
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int copyNonSubjectTags(@Param("oldQuestionId") String oldQuestionId,
                           @Param("newQuestionId") String newQuestionId);
}
