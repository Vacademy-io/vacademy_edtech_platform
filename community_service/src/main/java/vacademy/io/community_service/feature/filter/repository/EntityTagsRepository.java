package vacademy.io.community_service.feature.filter.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.community_service.feature.filter.entity.EntityTags;
import vacademy.io.community_service.feature.filter.entity.QuestionPaper;
import vacademy.io.community_service.feature.question_bank.dto.TagsByIdResponseDto;

import java.util.List;

@Repository
public interface EntityTagsRepository extends JpaRepository<EntityTags, String>, JpaSpecificationExecutor<EntityTags> {
    @Modifying
    @Query(value = "INSERT INTO entity_tags (entity_id, entity_name, tag_id, tag_source) " +
            "VALUES (:entityId, :entityName, :tagId, :tagSource) " +
            "ON CONFLICT (entity_id, entity_name, tag_id) DO NOTHING",
            nativeQuery = true)
    void insertIgnoreConflict(
            @Param("entityId") String entityId,
            @Param("entityName") String entityName,
            @Param("tagId") String tagId,
            @Param("tagSource") String tagSource
    );

    @Query(value = """
                SELECT DISTINCT tag_data.entity_id , tag_data.entity_name
                FROM (
                    SELECT
                        et.entity_id,
                        et.entity_name,
                        et.tag_id,
                        et.tag_source,
                        CASE
                            WHEN et.tag_source = 'LEVEL' THEN l.level_name
                            WHEN et.tag_source = 'SUBJECT' THEN s.subject_name
                            WHEN et.tag_source = 'STREAM' THEN st.stream_name
                            WHEN et.tag_source = 'TAGS' THEN t.tag_name
                            WHEN et.tag_source = 'DIFFICULTY' THEN et.tag_id
                            ELSE NULL
                        END AS tag_display_name
                    FROM
                        entity_tags et
                    LEFT JOIN levels l ON et.tag_id = l.level_id AND et.tag_source = 'LEVEL'
                    LEFT JOIN subjects s ON et.tag_id = s.subject_id AND et.tag_source = 'SUBJECT'
                    LEFT JOIN streams st ON et.tag_id = st.stream_id AND et.tag_source = 'STREAM'
                    LEFT JOIN tags t ON et.tag_id = t.tag_id AND et.tag_source = 'TAGS'
                ) AS tag_data
                WHERE (:entityName IS NULL OR tag_data.entity_name = :entityName)
                AND (:tagIds IS NULL OR tag_data.tag_id IN (:tagIds))
            """,
            countQuery = """
                    SELECT count(DISTINCT tag_data.entity_id)
                FROM (
                    SELECT
                        et.entity_id,
                        et.entity_name,
                        et.tag_id,
                        et.tag_source,
                        CASE
                            WHEN et.tag_source = 'LEVEL' THEN l.level_name
                            WHEN et.tag_source = 'SUBJECT' THEN s.subject_name
                            WHEN et.tag_source = 'STREAM' THEN st.stream_name
                            WHEN et.tag_source = 'TAGS' THEN t.tag_name
                            WHEN et.tag_source = 'DIFFICULTY' THEN et.tag_id
                            ELSE NULL
                        END AS tag_display_name
                    FROM
                        entity_tags et
                    LEFT JOIN levels l ON et.tag_id = l.level_id AND et.tag_source = 'LEVEL'
                    LEFT JOIN subjects s ON et.tag_id = s.subject_id AND et.tag_source = 'SUBJECT'
                    LEFT JOIN streams st ON et.tag_id = st.stream_id AND et.tag_source = 'STREAM'
                    LEFT JOIN tags t ON et.tag_id = t.tag_id AND et.tag_source = 'TAGS'
                ) AS tag_data
                WHERE (:entityName IS NULL OR tag_data.entity_name = :entityName)
                AND (:tagIds IS NULL OR tag_data.tag_id IN (:tagIds))
                """, nativeQuery = true)
    Page<Object[]> findDistinctEntities(
            @Param("entityName") String entityName,
            @Param("tagIds") List<String> tagIds,
            Pageable pageable
    );

    @Query(value = """
                SELECT DISTINCT tag_data.entity_id , tag_data.entity_name
                FROM (
                    SELECT
                        et.entity_id,
                        et.entity_name,
                        et.tag_id,
                        et.tag_source,
                        CASE
                            WHEN et.tag_source = 'LEVEL' THEN l.level_name
                            WHEN et.tag_source = 'SUBJECT' THEN s.subject_name
                            WHEN et.tag_source = 'STREAM' THEN st.stream_name
                            WHEN et.tag_source = 'TAGS' THEN t.tag_name
                            WHEN et.tag_source = 'DIFFICULTY' THEN et.tag_id
                            ELSE NULL
                        END AS tag_display_name
                    FROM
                        entity_tags et
                    LEFT JOIN levels l ON et.tag_id = l.level_id AND et.tag_source = 'LEVEL'
                    LEFT JOIN subjects s ON et.tag_id = s.subject_id AND et.tag_source = 'SUBJECT'
                    LEFT JOIN streams st ON et.tag_id = st.stream_id AND et.tag_source = 'STREAM'
                    LEFT JOIN tags t ON et.tag_id = t.tag_id AND et.tag_source = 'TAGS'
                ) AS tag_data
                WHERE (:entityName IS NULL OR tag_data.entity_name = :entityName)
                AND (:tagIds IS NULL OR tag_data.tag_id IN (:tagIds))
                AND (CAST(:search AS text) IS NULL OR LOWER(tag_data.tag_display_name) LIKE LOWER(CONCAT('%', CAST(:search AS text), '%')))
            """, nativeQuery = true)
    Page<Object[]> findDistinctEntitiesbysearch(
            @Param("entityName") String entityName,
            @Param("tagIds") List<String> tagIds,
            @Param("search") String search,
            Pageable pageable
    );


    @Query("""
                SELECT new vacademy.io.community_service.feature.question_bank.dto.TagsByIdResponseDto(
                    e.id.tagId,
                    e.tagSource,
                    CASE
                        WHEN e.tagSource = 'LEVEL' THEN l.levelName
                        WHEN e.tagSource = 'STREAM' THEN s.streamName
                        WHEN e.tagSource = 'SUBJECT' THEN sub.subjectName
                        WHEN e.tagSource = 'DIFFICULTY' THEN e.id.tagId
                        WHEN e.tagSource = 'TAGS' THEN t.tagName
                        ELSE NULL
                    END
                )
                FROM EntityTags e
                LEFT JOIN Levels l ON e.id.tagId = l.levelId AND e.tagSource = 'LEVEL'
                LEFT JOIN Streams s ON e.id.tagId = s.streamId AND e.tagSource = 'STREAM'
                LEFT JOIN Subjects sub ON e.id.tagId = sub.subjectId AND e.tagSource = 'SUBJECT'
                LEFT JOIN Tags t ON e.id.tagId = t.tagId AND e.tagSource = 'TAGS'
                WHERE e.id.entityId = :entityId
            """)
    List<TagsByIdResponseDto> findTagsByEntityId(@Param("entityId") String entityId);

    @Query("""
                SELECT qp
                FROM QuestionPaper qp
                WHERE qp.id = :entityId
            """)
    QuestionPaper findQuestionPaperByEntityId(@Param("entityId") String entityId);


    @Query("""
                SELECT new vacademy.io.community_service.feature.question_bank.dto.TagsByIdResponseDto(
                    e.id.tagId,
                    e.tagSource,
                    CASE
                        WHEN e.tagSource = 'LEVEL' THEN l.levelName
                        WHEN e.tagSource = 'STREAM' THEN s.streamName
                        WHEN e.tagSource = 'SUBJECT' THEN sub.subjectName
                        WHEN e.tagSource = 'TAGS' THEN t.tagName
                        WHEN e.tagSource = 'DIFFICULTY' THEN e.id.tagId
                        ELSE NULL
                    END
                )
                FROM EntityTags e
                LEFT JOIN Levels l ON e.id.tagId = l.levelId AND e.tagSource = 'LEVEL'
                LEFT JOIN Streams s ON e.id.tagId = s.streamId AND e.tagSource = 'STREAM'
                LEFT JOIN Subjects sub ON e.id.tagId = sub.subjectId AND e.tagSource = 'SUBJECT'
                LEFT JOIN Tags t ON e.id.tagId = t.tagId AND e.tagSource = 'TAGS'
                GROUP BY e.id.tagId, e.tagSource, l.levelName, s.streamName, sub.subjectName, t.tagName
                ORDER BY COUNT(e.id.tagId) DESC
            """)
    List<TagsByIdResponseDto> findPopularTags();

    @Query(value = """
            SELECT * FROM entity_tags
            WHERE entity_name = :entityName
            AND entity_id IN (:entityIds)
            """, nativeQuery = true)
    List<EntityTags> findAllByEntityNameAndEntityIds(
            @Param("entityName") String entityName,
            @Param("entityIds") List<String> entityIds
    );

}
