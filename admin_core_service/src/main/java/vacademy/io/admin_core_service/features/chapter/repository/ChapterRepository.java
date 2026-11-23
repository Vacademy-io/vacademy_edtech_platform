package vacademy.io.admin_core_service.features.chapter.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.chapter.entity.Chapter;

import java.util.List;

@Repository
public interface ChapterRepository extends JpaRepository<Chapter, String> {

    @Query(value = """
            WITH chapter_scope AS (
                SELECT DISTINCT
                    c.id,
                    c.chapter_name,
                    c.status,
                    c.file_id,
                    c.description,
                    cps.chapter_order,
                    c.parent_id,
                    c.created_at
                FROM chapter c
                JOIN module_chapter_mapping mc ON mc.chapter_id = c.id
                JOIN chapter_package_session_mapping cps ON cps.chapter_id = c.id
                WHERE mc.module_id = :moduleId
                  AND cps.package_session_id = :packageSessionId
                  AND c.status IN (:chapterStatus)
                  AND cps.status IN (:chapterToPackageSessionStatus)
            ),
            valid_slides AS (
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    cs.chapter_id,
                    s.id AS slide_id,
                    s.title,
                    s.status,
                    s.source_id,
                    s.description,
                    cs.slide_order,
                    s.source_type,
                    s.parent_id,
                    s.created_at
                FROM chapter_scope c
                JOIN chapter_to_slides cs ON cs.chapter_id = c.id
                JOIN slide s ON s.id = cs.slide_id
                WHERE s.status IN (:slideStatus)
                  AND cs.status IN (:chapterToSlidesStatus)
                ORDER BY cs.chapter_id, s.id, cs.slide_order
            ),
            video_slide_question_options_agg AS (
                SELECT
                    o.video_slide_question_id,
                    json_agg(
                        json_build_object(
                            'id', o.id,
                            'media_id', o.media_id,
                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', rt_opt.content) ELSE NULL END,
                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', rt_opt_exp.content) ELSE NULL END
                        )
                    ) AS options_json
                FROM video_slide_question_options o
                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                WHERE EXISTS (
                    SELECT 1
                    FROM video_slide_question q
                    WHERE q.id = o.video_slide_question_id
                      AND q.status IN (:videoSlideQuestionStatus)
                      AND EXISTS (
                          SELECT 1 FROM valid_slides vs
                          WHERE vs.source_type = 'VIDEO'
                            AND vs.source_id = q.video_slide_id
                      )
                )
                GROUP BY o.video_slide_question_id
            ),
            video_slide_questions_agg AS (
                SELECT
                    q.video_slide_id,
                    json_agg(
                        json_build_object(
                            'id', q.id,
                            'question_response_type', q.question_response_type,
                            'question_type', q.question_type,
                            'access_level', q.access_level,
                            'question_order', q.question_order,
                            'question_time_in_millis', q.question_time_in_millis,
                            'media_id', q.media_id,
                            'auto_evaluation_json', q.auto_evaluation_json,
                            'evaluation_type', q.evaluation_type,
                            'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', rt_text.content),
                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', rt_parent.content) ELSE NULL END,
                            'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', rt_exp.content) ELSE NULL END,
                            'options', COALESCE(vsqo.options_json, CAST('[]' AS json))
                        )
                        ORDER BY q.question_order
                    ) AS questions_json
                FROM video_slide_question q
                LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                LEFT JOIN video_slide_question_options_agg vsqo ON vsqo.video_slide_question_id = q.id
                WHERE q.status IN (:videoSlideQuestionStatus)
                  AND EXISTS (
                      SELECT 1 FROM valid_slides vs
                      WHERE vs.source_type = 'VIDEO'
                        AND vs.source_id = q.video_slide_id
                  )
                GROUP BY q.video_slide_id
            ),
            question_slide_options_agg AS (
                SELECT
                    o.question_id,
                    json_agg(
                        json_build_object(
                            'id', o.id,
                            'media_id', o.media_id,
                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', rt_opt.content) ELSE NULL END,
                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', rt_opt_exp.content) ELSE NULL END
                        )
                        ORDER BY o.created_on
                    ) AS options_json
                FROM option o
                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                WHERE EXISTS (
                    SELECT 1 FROM valid_slides vs
                    WHERE vs.source_type = 'QUESTION'
                      AND vs.source_id = o.question_id
                )
                GROUP BY o.question_id
            ),
            quiz_slide_question_options_agg AS (
                SELECT
                    o.quiz_slide_question_id,
                    json_agg(
                        json_build_object(
                            'id', o.id,
                            'media_id', o.media_id,
                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', rt_opt.content) ELSE NULL END,
                            'explanation_text', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', rt_opt_exp.content) ELSE NULL END
                        )
                    ) AS options_json
                FROM quiz_slide_question_options o
                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                WHERE EXISTS (
                    SELECT 1 FROM quiz_slide_question q
                    WHERE q.id = o.quiz_slide_question_id
                      AND EXISTS (
                          SELECT 1 FROM valid_slides vs
                          WHERE vs.source_type = 'QUIZ'
                            AND vs.source_id = q.quiz_slide_id
                      )
                )
                GROUP BY o.quiz_slide_question_id
            ),
            quiz_slide_questions_agg AS (
                SELECT
                    q.quiz_slide_id,
                    json_agg(
                        json_build_object(
                            'id', q.id,
                            'media_id', q.media_id,
                            'status', q.status,
                            'question_response_type', q.question_response_type,
                            'question_type', q.question_type,
                            'access_level', q.access_level,
                            'auto_evaluation_json', q.auto_evaluation_json,
                            'evaluation_type', q.evaluation_type,
                            'question_order', q.question_order,
                            'can_skip', q.can_skip,
                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', rt_parent.content) ELSE NULL END,
                            'text', CASE WHEN q.text_id IS NOT NULL THEN json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', rt_text.content) ELSE NULL END,
                            'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', rt_exp.content) ELSE NULL END,
                            'options', COALESCE(qsqo.options_json, CAST('[]' AS json))
                        )
                        ORDER BY q.question_order
                    ) AS questions_json
                FROM quiz_slide_question q
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                LEFT JOIN quiz_slide_question_options_agg qsqo ON qsqo.quiz_slide_question_id = q.id
                WHERE EXISTS (
                    SELECT 1 FROM valid_slides vs
                    WHERE vs.source_type = 'QUIZ'
                      AND vs.source_id = q.quiz_slide_id
                )
                GROUP BY q.quiz_slide_id
            ),
            video_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'video_slide', json_build_object(
                            'id', v.id,
                            'url', v.url,
                            'title', v.title,
                            'description', v.description,
                            'source_type', v.source_type,
                            'published_url', v.published_url,
                            'video_length_in_millis', v.video_length,
                            'published_video_length_in_millis', v.published_video_length,
                            'questions', COALESCE(vsq.questions_json, CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN video v ON v.id = vs.source_id
                LEFT JOIN video_slide_questions_agg vsq ON vsq.video_slide_id = v.id
                WHERE vs.source_type = 'VIDEO'
            ),
            document_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'document_slide', json_build_object(
                            'id', d.id,
                            'title', d.title,
                            'type', d.type,
                            'cover_file_id', d.cover_file_id,
                            'total_pages', d.total_pages,
                            'published_document_total_pages', d.published_document_total_pages,
                            'data', d.data,
                            'published_data', d.published_data
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN document_slide d ON d.id = vs.source_id
                WHERE vs.source_type = 'DOCUMENT'
            ),
            question_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'question_slide', json_build_object(
                            'id', q.id,
                            'question_type', q.question_type,
                            'question_response_type', q.question_response_type,
                            'access_level', q.access_level,
                            'default_question_time_mins', q.default_question_time_mins,
                            'points', q.points,
                            're_attempt_count', q.re_attempt_count,
                            'show_answer_after_submit', COALESCE(q.show_answer_after_submit, TRUE),
                            'auto_evaluation_json', q.auto_evaluation_json,
                            'evaluation_type', q.evaluation_type,
                            'media_id', q.media_id,
                            'source_type', q.source_type,
                            'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', rt_text.content),
                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', rt_parent.content) ELSE NULL END,
                            'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', rt_exp.content) ELSE NULL END,
                            'options', COALESCE(qso.options_json, CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN question_slide q ON q.id = vs.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                LEFT JOIN question_slide_options_agg qso ON qso.question_id = q.id
                WHERE vs.source_type = 'QUESTION'
            ),
            assignment_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'assignment_slide', json_build_object(
                            'id', a.id,
                            'live_date', a.live_date,
                            'end_date', a.end_date,
                            'comma_separated_media_ids', a.comma_separated_media_ids,
                            're_attempt_count', a.re_attempt_count,
                            'text_data', CASE WHEN a.text_id IS NOT NULL THEN json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', rt_text.content) ELSE NULL END,
                            'parent_rich_text', CASE WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', rt_parent.content) ELSE NULL END
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN assignment_slide a ON a.id = vs.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                WHERE vs.source_type = 'ASSIGNMENT'
            ),
            quiz_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'quiz_slide', json_build_object(
                            'id', qz.id,
                            'title', qz.title,
                            'description', CASE WHEN qz.description IS NOT NULL THEN json_build_object('id', rt_desc.id, 'type', rt_desc.type, 'content', rt_desc.content) ELSE NULL END,
                            'questions', COALESCE(qsq.questions_json, CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN quiz_slide qz ON qz.id = vs.source_id
                LEFT JOIN rich_text_data rt_desc ON rt_desc.id = qz.description
                LEFT JOIN quiz_slide_questions_agg qsq ON qsq.quiz_slide_id = qz.id
                WHERE vs.source_type = 'QUIZ'
            ),
            audio_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'audio_slide', json_build_object(
                            'id', a.id,
                            'title', a.title,
                            'description', a.description,
                            'audio_file_id', a.audio_file_id,
                            'thumbnail_file_id', a.thumbnail_file_id,
                            'audio_length_in_millis', a.audio_length_in_millis,
                            'published_audio_file_id', a.published_audio_file_id,
                            'published_audio_length_in_millis', a.published_audio_length_in_millis,
                            'source_type', a.source_type,
                            'external_url', a.external_url,
                            'transcript', a.transcript
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN audio_slide a ON a.id = vs.source_id
                WHERE vs.source_type = 'AUDIO'
            ),
            html_video_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'html_video_slide', json_build_object(
                            'id', h.id,
                            'url', h.url,
                            'video_length_in_millis', h.video_length,
                            'ai_gen_video_id', h.ai_gen_video_id
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN html_video_slide h ON h.id = vs.source_id
                WHERE vs.source_type = 'HTML_VIDEO'
            ),
            scorm_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'scorm_slide', json_build_object(
                            'id', sc.id,
                            'launch_path', sc.launch_path,
                            'scorm_version', sc.scorm_version,
                            'original_file_id', sc.original_file_id
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN scorm_slide sc ON sc.id = vs.source_id
                WHERE vs.source_type = 'SCORM'
            ),
            assessment_slides AS (
                SELECT
                    vs.chapter_id,
                    vs.created_at,
                    vs.slide_order,
                    json_build_object(
                        'id', vs.slide_id,
                        'title', vs.title,
                        'status', vs.status,
                        'is_loaded', TRUE,
                        'new_slide', TRUE,
                        'source_id', vs.source_id,
                        'description', vs.description,
                        'slide_order', vs.slide_order,
                        'source_type', vs.source_type,
                        'parent_id', vs.parent_id,
                        'assessment_slide', json_build_object(
                            'id', asl.id,
                            'assessment_id', asl.assessment_id,
                            'allow_reattempt', asl.allow_reattempt,
                            'show_result', asl.show_result
                        )
                    ) AS slide_data
                FROM valid_slides vs
                JOIN assessment_slide asl ON asl.id = vs.source_id
                WHERE vs.source_type = 'ASSESSMENT'
            ),
            all_slides AS (
                SELECT * FROM video_slides
                UNION ALL
                SELECT * FROM document_slides
                UNION ALL
                SELECT * FROM question_slides
                UNION ALL
                SELECT * FROM assignment_slides
                UNION ALL
                SELECT * FROM quiz_slides
                UNION ALL
                SELECT * FROM audio_slides
                UNION ALL
                SELECT * FROM html_video_slides
                UNION ALL
                SELECT * FROM scorm_slides
                UNION ALL
                SELECT * FROM assessment_slides
            )
            SELECT json_agg(
                       json_build_object(
                           'chapter', json_build_object(
                               'id', c.id,
                               'chapter_name', c.chapter_name,
                               'status', c.status,
                               'file_id', c.file_id,
                               'description', c.description,
                               'chapter_order', c.chapter_order,
                               'parent_id', c.parent_id
                           ),
                           'slides', (
                               SELECT json_agg(slide_data ORDER BY slide_order IS NOT NULL, slide_order, created_at DESC)
                               FROM all_slides s
                               WHERE s.chapter_id = c.id
                           )
                       )
                       ORDER BY c.chapter_order ASC NULLS LAST, c.created_at ASC
                   )
            FROM chapter_scope c
            """, nativeQuery = true)
    String getChaptersAndSlidesByModuleIdAndPackageSessionId(
            @Param("moduleId") String moduleId,
            @Param("chapterStatus") List<String> chapterStatus,
            @Param("packageSessionId") String packageSessionId,
            @Param("chapterToPackageSessionStatus") List<String> chapterToPackageSessionStatus,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterToSlidesStatus") List<String> chapterToSlidesStatus,
            @Param("videoSlideQuestionStatus") List<String> videoSlideQuestionStatus);
}
