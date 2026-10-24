package vacademy.io.assessment_service.features.question_core.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.List;

public interface QuestionRepository extends JpaRepository<Question, String> {

    // In the order the paper was saved with: each bulkInsertQuestionsToQuestionPaper
    // batch shares one created_at and numbers its rows 1..n in question_order, and a
    // later edit appends a new batch (numbered from 1 again) after the old one. The
    // AI preview pairs these rows positionally with the rows it sent.
    @Query(value = "SELECT q.* FROM question q " +
            "JOIN question_question_paper_mapping qp ON q.id = qp.question_id " +
            "WHERE qp.question_paper_id = :questionPaperId and q.status != 'DELETED' " +
            "ORDER BY qp.created_at, qp.question_order NULLS LAST, q.id", nativeQuery = true)
    List<Question> findQuestionsByQuestionPaperId(@Param("questionPaperId") String questionPaperId);

    /** Shared by the row query and its count query so the two can never drift apart. */
    String QUESTION_FILTER_WHERE =
            "WHERE q.institute_id = :instituteId "
                    + "AND (:statusesCsv IS NULL OR q.status = ANY(string_to_array(:statusesCsv, ','))) "
                    + "AND (:questionTypesCsv IS NULL OR q.question_type = ANY(string_to_array(:questionTypesCsv, ','))) "
                    + "AND (:difficultiesCsv IS NULL OR q.difficulty = ANY(string_to_array(:difficultiesCsv, ','))) "
                    + "AND (:sourceTypesCsv IS NULL OR q.source_type = ANY(string_to_array(:sourceTypesCsv, ','))) "
                    + "AND (:excludeQuestionIdsCsv IS NULL OR NOT (q.id = ANY(string_to_array(:excludeQuestionIdsCsv, ',')))) "
                    + "AND (:kbIdsCsv IS NULL OR EXISTS ("
                    + "    SELECT 1 FROM unnest(string_to_array(:kbIdsCsv, ',')) AS kb(id) "
                    + "    WHERE q.source_meta @> jsonb_build_object('kb_id', kb.id))) "
                    + "AND (:kbNodeIdsCsv IS NULL OR EXISTS ("
                    + "    SELECT 1 FROM unnest(string_to_array(:kbNodeIdsCsv, ',')) AS node(id) "
                    + "    WHERE q.source_meta @> jsonb_build_object('node_ids', jsonb_build_array(node.id)))) "
                    + "AND (:tagIdsCsv IS NULL OR EXISTS ("
                    + "    SELECT 1 FROM entity_tags et "
                    + "    WHERE et.entity_id = q.id AND et.entity_name = 'QUESTION' "
                    + "        AND et.tag_id = ANY(string_to_array(:tagIdsCsv, ',')))) "
                    + "AND (:name IS NULL OR EXISTS ("
                    + "    SELECT 1 FROM assessment_rich_text_data t "
                    + "    WHERE t.id = q.text_id AND t.content ILIKE CONCAT('%', :name, '%')))";

    /**
     * Browse an institute's questions directly, rather than through their papers.
     *
     * Every filter is optional and NULL means "no constraint".
     *
     * All multi-value filters are passed as a comma-separated string and expanded with
     * string_to_array, NOT as a bound List with `IN (:param)`. That is deliberate:
     * binding an empty or null collection into a native IN clause behaves differently
     * across Hibernate versions, and the one place this codebase already needed to be
     * sure of it (tagIdsCsv in findQuestionPapersByFilters) uses exactly this pattern.
     * A plain string binds unambiguously.
     *
     * Other notes:
     *   - institute_id is the denormalised column added in V42. Questions predating the
     *     backfill, or belonging to no institute-linked paper, are NULL and simply do not
     *     appear -- which is correct for an institute's own bank.
     *   - kb ids and node ids are matched with the jsonb containment operator so the GIN
     *     index on source_meta is used. node_ids is an array inside the document, hence
     *     the array-wrapped right-hand side.
     *   - The tag and text filters are SEPARATE EXISTS clauses rather than one EXISTS
     *     with an OR across columns -- the latter degenerates into a per-row seq scan.
     *
     * No semicolons anywhere, including in comments: Hibernate splices its fetch clause
     * in at the first one it finds and the column indexes then come out wrong.
     */
    @Query(
            value = "SELECT q.* FROM question q " + QUESTION_FILTER_WHERE,
            countQuery = "SELECT COUNT(q.id) FROM question q " + QUESTION_FILTER_WHERE,
            nativeQuery = true
    )
    Page<Question> findQuestionsByFilters(
            @Param("instituteId") String instituteId,
            @Param("name") String name,
            @Param("statusesCsv") String statusesCsv,
            @Param("questionTypesCsv") String questionTypesCsv,
            @Param("difficultiesCsv") String difficultiesCsv,
            @Param("sourceTypesCsv") String sourceTypesCsv,
            @Param("excludeQuestionIdsCsv") String excludeQuestionIdsCsv,
            @Param("kbIdsCsv") String kbIdsCsv,
            @Param("kbNodeIdsCsv") String kbNodeIdsCsv,
            @Param("tagIdsCsv") String tagIdsCsv,
            Pageable pageable
    );
}
