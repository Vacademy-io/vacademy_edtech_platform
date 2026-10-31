package vacademy.io.admin_core_service.features.slide.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.slide.dto.*;
import vacademy.io.admin_core_service.features.slide.entity.Slide;

import java.util.List;
import java.util.Optional;

public interface SlideRepository extends JpaRepository<Slide, String> {
    @Query("""
                SELECT new vacademy.io.admin_core_service.features.slide.dto.SlideCountProjection(
                    COALESCE(SUM(CASE WHEN s.sourceType = 'VIDEO' THEN 1 ELSE 0 END), 0) AS videoCount,
                    COALESCE(SUM(CASE WHEN s.sourceType = 'HTML_VIDEO' THEN 1 ELSE 0 END), 0) AS htmlVideoCount,
                    COALESCE(SUM(CASE WHEN s.sourceType = 'SCORM' THEN 1 ELSE 0 END), 0) AS scormCount,
                    COALESCE(SUM(CASE WHEN s.sourceType = 'DOCUMENT' AND EXISTS (SELECT 1 FROM DocumentSlide d WHERE d.id = s.sourceId AND d.type = 'PDF') THEN 1 ELSE 0 END), 0) AS pdfCount,
                    COALESCE(SUM(CASE WHEN s.sourceType = 'DOCUMENT' AND EXISTS (SELECT 1 FROM DocumentSlide d WHERE d.id = s.sourceId AND d.type IN ('DOC', 'HTML')) THEN 1 ELSE 0 END), 0) AS docCount,
                    COALESCE(SUM(CASE WHEN s.sourceType NOT IN ('VIDEO', 'HTML_VIDEO', 'SCORM', 'DOCUMENT') THEN 1 ELSE 0 END), 0) AS unknownCount
                )
                FROM ChapterToSlides cts
                JOIN Slide s ON cts.slide.id = s.id
                WHERE cts.chapter.id = :chapterId
                AND cts.status != 'DELETED'
                AND s.status != 'DELETED'
            """)
    SlideCountProjection countSlidesByChapterId(@Param("chapterId") String chapterId);

    /**
     * Student report v2: total assignment slides available to a package session (the "Assigned"
     * count). Uses the DIRECT path assignment slides actually take — chapters map to a package
     * session via chapter_package_session_mapping and slides via chapter_to_slides — avoiding the
     * fragile subject/module joins. Statuses are permissive (anything not deleted) because content
     * is commonly PUBLISHED rather than ACTIVE; an over-strict filter returned 0 here. READ-ONLY.
     */
    @Query(value = """
            SELECT COUNT(DISTINCT s.id)
            FROM chapter_package_session_mapping cpsm
            JOIN chapter c ON c.id = cpsm.chapter_id
            JOIN chapter_to_slides cs ON cs.chapter_id = c.id
            JOIN slide s ON s.id = cs.slide_id
            WHERE cpsm.package_session_id = :packageSessionId
              AND cpsm.status <> 'DELETED'
              AND c.status <> 'DELETED'
              AND cs.status <> 'DELETED'
              AND s.status <> 'DELETED'
              AND s.source_type = 'ASSIGNMENT'
            """, nativeQuery = true)
    Integer countAssignmentSlidesForPackageSession(@Param("packageSessionId") String packageSessionId);

    @Query(value = """
            SELECT s.id AS slideId,
                   s.title AS slideTitle,
                   s.description AS slideDescription,
                   s.source_type AS sourceType,
                   s.status AS status,
                   s.image_file_id AS imageFileId,
                   s.last_sync_date AS lastSyncDate,
                   ds.id AS documentId,
                   ds.title AS documentTitle,
                   ds.cover_file_id AS documentCoverFileId,
                   ds.type AS documentType,
                   -- Legacy rows (published pre 2026-07-08) carry content only in
                   -- published_data; fall back so this projection is never empty.
                   COALESCE(ds.data, ds.published_data) AS documentData,
                   vs.id AS videoId,
                   vs.title AS videoTitle,
                   vs.url AS videoUrl,
                   vs.source_type AS videoSourceType,
                   vs.description AS videoDescription,
                   COALESCE(cts.slide_order, 9999) AS slideOrder,
                   vs.published_url AS publishedUrl,
                   ds.published_data AS publishedData
            FROM chapter_to_slides cts
            JOIN slide s ON cts.slide_id = s.id
            JOIN chapter ch ON cts.chapter_id = ch.id
            LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
            LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
            WHERE ch.id = :chapterId
              AND s.status IN :status
              AND cts.status != 'DELETED'
            ORDER BY
                cts.slide_order IS NOT NULL,
                cts.slide_order ASC,
                s.created_at DESC
            """, nativeQuery = true)
    List<SlideDetailProjection> findSlideDetailsByChapterId(
            @Param("chapterId") String chapterId,
            @Param("status") List<String> status);

    @Query(value = """
                SELECT
                    s.id AS slideId,
                    s.title AS slideTitle,
                    s.description AS slideDescription,
                    s.source_type AS sourceType,
                    s.status AS status,
                    s.image_file_id AS imageFileId,

                    ds.id AS documentId,
                    ds.title AS documentTitle,
                    ds.cover_file_id AS documentCoverFileId,
                    ds.type AS documentType,


                    vs.id AS videoId,
                    vs.title AS videoTitle,
                    vs.description AS videoDescription,
                    vs.published_url AS publishedUrl,
                    vs.source_type AS videoSourceType,
                    ds.published_data AS publishedData,
                    cts.slide_order AS slideOrder

                FROM slide s
                JOIN activity_log al ON al.slide_id = s.id
                JOIN chapter_to_slides cts ON s.id = cts.slide_id
                JOIN chapter ch ON cts.chapter_id = ch.id

                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'

                WHERE al.user_id = :userId
                AND s.status IN :status
                AND (al.percentage_watched IS NULL OR al.percentage_watched != 100)
                AND cts.status != 'DELETED'

                ORDER BY
                    CASE WHEN cts.slide_order IS NULL THEN 0 ELSE 1 END,
                    cts.slide_order ASC,
                    al.updated_at DESC,
                    s.id

                LIMIT 5
            """, nativeQuery = true)
    List<SlideDetailProjection> findRecentIncompleteSlidesByUserId(
            @Param("userId") String userId,
            @Param("status") List<String> status);

    @Query(value = """
                SELECT
                    s.id AS slideId,
                    s.title AS slideTitle,
                    s.description AS slideDescription,
                    s.source_type AS sourceType,
                    s.status AS status,
                    s.image_file_id AS imageFileId,

                    ds.id AS documentId,
                    ds.title AS documentTitle,
                    ds.cover_file_id AS documentCoverFileId,
                    ds.type AS documentType,
                    ds.published_data AS publishedData,

                    vs.id AS videoId,
                    vs.title AS videoTitle,
                    vs.description AS videoDescription,
                    vs.published_url AS publishedUrl,
                    vs.source_type AS videoSourceType,
                    cts.slide_order AS slideOrder,

                    COALESCE(NULLIF(doc_percent.value, ''), '0') AS percentageDocumentWatched,
                    COALESCE(NULLIF(doc_last.value, ''), '0') AS documentLastPage,
                    doc_last.updated_at AS documentLastUpdated,

                    COALESCE(NULLIF(vid_percent.value, ''), '0') AS percentageVideoWatched,
                    COALESCE(NULLIF(vid_last.value, ''), '0') AS videoLastTimestamp,
                    vid_last.updated_at AS videoLastUpdated,

                    COALESCE(slide_complete.pct, 0) AS percentageCompleted

                FROM chapter_to_slides cts
                JOIN slide s ON cts.slide_id = s.id
                JOIN chapter ch ON cts.chapter_id = ch.id

                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'

                LEFT JOIN learner_operation doc_percent ON doc_percent.source = 'SLIDE'
                    AND doc_percent.source_id = s.id
                    AND s.source_type = 'DOCUMENT'
                    AND doc_percent.operation = 'PERCENTAGE_DOCUMENT_WATCHED'
                    AND doc_percent.user_id = :userId

                LEFT JOIN learner_operation doc_last ON doc_last.source = 'SLIDE'
                    AND doc_last.source_id = s.id
                    AND s.source_type = 'DOCUMENT'
                    AND doc_last.operation = 'DOCUMENT_LAST_PAGE'
                    AND doc_last.user_id = :userId

                LEFT JOIN learner_operation vid_percent ON vid_percent.source = 'SLIDE'
                    AND vid_percent.source_id = s.id
                    AND s.source_type = 'VIDEO'
                    AND vid_percent.operation = 'PERCENTAGE_VIDEO_WATCHED'
                    AND vid_percent.user_id = :userId

                LEFT JOIN learner_operation vid_last ON vid_last.source = 'SLIDE'
                    AND vid_last.source_id = s.id
                    AND s.source_type = 'VIDEO'
                    AND vid_last.operation = 'VIDEO_LAST_TIMESTAMP'
                    AND vid_last.user_id = :userId

                -- Unified per-slide completion for this learner, across every slide
                -- type, using the same completion operations the chapter rollup uses
                -- (so the slide number is consistent with the chapter percentage).
                LEFT JOIN (
                    SELECT lo.source_id AS slide_id,
                        MAX(CASE WHEN lo.value ~ '^[0-9]+(\\.[0-9]+)?$'
                                 THEN LEAST(CAST(lo.value AS FLOAT), 100) ELSE 0 END) AS pct
                    FROM learner_operation lo
                    WHERE lo.source = 'SLIDE'
                      AND lo.user_id = :userId
                      AND lo.operation IN ('PERCENTAGE_VIDEO_WATCHED','PERCENTAGE_DOCUMENT_COMPLETED',
                                           'PERCENTAGE_QUIZ_COMPLETED','PERCENTAGE_QUESTION_COMPLETED',
                                           'PERCENTAGE_ASSIGNMENT_COMPLETED','PERCENTAGE_ASSESSMENT_DONE',
                                           'PERCENTAGE_SCORM_COMPLETED','PERCENTAGE_AUDIO_LISTENED')
                    GROUP BY lo.source_id
                ) slide_complete ON slide_complete.slide_id = s.id

                WHERE ch.id = :chapterId
                AND s.status IN (:status)
                AND cts.status != 'DELETED'
                ORDER BY
                    CASE
                        WHEN cts.slide_order IS NULL THEN 0
                        ELSE 1
                    END,
                    cts.slide_order ASC
            """, nativeQuery = true)
    List<SlideDetailWithOperationProjection> findSlideDetailsWithOperationByChapterId(
            @Param("userId") String userId,
            @Param("chapterId") String chapterId,
            @Param("status") List<String> status);

    @Query(value = """
            SELECT s.id AS slideId,
                   s.title AS slideTitle,
                   s.description AS slideDescription,
                   s.source_type AS sourceType,
                   s.status AS status,
                   s.image_file_id AS imageFileId,
                   ds.id AS documentId,
                   ds.title AS documentTitle,
                   ds.cover_file_id AS documentCoverFileId,
                   ds.type AS documentType,
                   vs.id AS videoId,
                   vs.source_type AS videoSourceType,
                   vs.title AS videoTitle,
                   vs.description AS videoDescription,
                   COALESCE(cts.slide_order, 9999) AS slideOrder,
                   vs.published_url AS publishedUrl,
                   ds.published_data AS publishedData
            FROM chapter_to_slides cts
            JOIN slide s ON cts.slide_id = s.id
            JOIN chapter ch ON cts.chapter_id = ch.id
            LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
            LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
            WHERE ch.id = :chapterId
              AND s.status IN :status
              AND cts.status != 'DELETED'
            ORDER BY
                cts.slide_order IS NOT NULL,
                cts.slide_order ASC,
                s.created_at DESC
            """, nativeQuery = true)
    List<SlideDetailProjection> findLearnerSlideDetailsByChapterId(
            @Param("chapterId") String chapterId,
            @Param("status") List<String> status);

    @Query(value = """
                SELECT DISTINCT ON (s.id)
                    s.id AS slideId,
                    s.title AS slideTitle,
                    s.description AS slideDescription,
                    s.source_type AS sourceType,
                    s.status AS status,
                    s.image_file_id AS imageFileId,

                    COALESCE(
                        CASE WHEN lo.operation = 'VIDEO_LAST_TIMESTAMP' THEN CAST(lo.value AS BIGINT) END,
                        CASE WHEN lo.operation = 'DOCUMENT_LAST_PAGE' THEN CAST(lo.value AS BIGINT) END
                    ) AS progressMarker,

                    ps.package_id AS packageId,
                    ps.level_id AS levelId,
                    ch.id AS chapterId,
                    m.id AS moduleId,
                    sub.id AS subjectId,
                    ps.id AS packageSessionId

                FROM slide s
                JOIN activity_log al ON al.slide_id = s.id
                JOIN chapter_to_slides cts ON s.id = cts.slide_id AND cts.status IN (:chapterSlideStatus)
                JOIN chapter ch ON cts.chapter_id = ch.id AND ch.status IN (:chapterStatus)
                JOIN package_session ps ON ps.id IN (:packageSessionIds) AND ps.status IN (:packageSessionStatus)
                JOIN module_chapter_mapping mtc ON mtc.chapter_id = ch.id
                JOIN modules m ON mtc.module_id = m.id AND m.status IN (:moduleStatus)
                JOIN subject_module_mapping smm ON smm.module_id = m.id
                JOIN subject sub ON smm.subject_id = sub.id AND sub.status IN (:subjectStatus)

                LEFT JOIN document_slide ds ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'
                LEFT JOIN video vs ON vs.id = s.source_id AND s.source_type = 'VIDEO'
                LEFT JOIN learner_operation lo ON lo.user_id = :userId
                                                  AND lo.source = 'SLIDE'
                                                  AND lo.source_id = s.id

                WHERE al.user_id = :userId
                AND s.status IN (:slideStatus)
                AND (al.percentage_watched IS NULL OR al.percentage_watched != 100)
                LIMIT 5
            """, nativeQuery = true)
    List<LearnerRecentSlides> findRecentIncompleteSlides(
            @Param("userId") String userId,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterSlideStatus") List<String> chapterSlideStatus,
            @Param("chapterStatus") List<String> chapterStatus,
            @Param("moduleStatus") List<String> moduleStatus,
            @Param("subjectStatus") List<String> subjectStatus,
            @Param("packageSessionStatus") List<String> packageSessionStatus);

    @Query(value = """
                    SELECT json_agg(slide_data ORDER BY slide_order IS NOT NULL, slide_order, created_at DESC) AS slides
                    FROM (
                        -- VIDEO SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'video_slide', json_build_object(
                                    'id', v.id,
                                    'url', v.url,
                                    'title', v.title,
                                    'description', v.description,
                                    'embedded_type', v.embedded_type,
                                    'embedded_data', v.embedded_data,
                                    'source_type', v.source_type,
                                    'published_url', v.published_url,
                                    'video_length_in_millis', v.video_length,
                                    'published_video_length_in_millis', v.published_video_length,
                                    'questions', COALESCE((
                                        SELECT json_agg(
                                            json_build_object(
                                                'id', q.id,
                                                'question_response_type', q.question_response_type,
                                                'question_type', q.question_type,
                                                'access_level', q.access_level,
                                                'question_order', q.question_order,
                                                'question_time_in_millis', q.question_time_in_millis,
                                                'media_id', q.media_id,
                                                'can_skip', q.can_skip,
                                                'auto_evaluation_json', q.auto_evaluation_json,
                                                'evaluation_type', q.evaluation_type,
                                                'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                                'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                                'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                                'options', COALESCE((
                                                    SELECT json_agg(
                                                        json_build_object(
                                                            'id', o.id,
                                                            'media_id', o.media_id,
                                                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                                        )
                                                    )
                                                    FROM video_slide_question_options o
                                                    LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                                    LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                                    LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                                    LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                                    WHERE o.video_slide_question_id = q.id
                                                ), CAST('[]' AS json))
                                            )
                                            ORDER BY q.question_order
                                        )
                                        FROM video_slide_question q
                                        LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                                        LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                                        LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                                        LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                                        LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                                        LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                                        WHERE q.video_slide_id = v.id
                                        AND q.status IN (:videoSlideQuestionStatus)
                                    ), CAST('[]' AS json))
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN video v ON v.id = s.source_id
                        WHERE s.source_type = 'VIDEO' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- DOCUMENT SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'document_slide', json_build_object(
                                    'id', d.id,
                                    'title', d.title,
                                    'type', d.type,
                                    'cover_file_id', d.cover_file_id,
                                    -- Publishing before the 2026-07-08 save-lifecycle fix nulled the
                                    -- draft columns, so ~6.5k legacy rows hold their content only in
                                    -- published_*. Fall back so no reader ever sees a null document.
                                    'total_pages', COALESCE(d.total_pages, d.published_document_total_pages),
                                    'published_document_total_pages', d.published_document_total_pages,
                                    'data', COALESCE(d.data, d.published_data),
                                    'published_data', d.published_data
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN document_slide d ON d.id = s.source_id
                        WHERE s.source_type = 'DOCUMENT' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- QUESTION SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'question_slide', json_build_object(
                                    'id', q.id,
                                    'question_type', q.question_type,
                                    'question_response_type', q.question_response_type,
                                    'access_level', q.access_level,
                                    'default_question_time_mins', q.default_question_time_mins,
                                    'points', q.points,
                                    're_attempt_count', q.re_attempt_count,
                                    'auto_evaluation_json', q.auto_evaluation_json,
                                    'evaluation_type', q.evaluation_type,
                                    'media_id', q.media_id,
                                    'source_type', q.source_type,
                                    'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                    'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                    'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                    'options', COALESCE((
                                        SELECT json_agg(
                                            json_build_object(
                                                'id', o.id,
                                                'media_id', o.media_id,
                                                'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                                'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                            )
                                            ORDER BY o.created_on
                                        )
                                        FROM option o
                                        LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                        LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                        LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                        LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                        WHERE o.question_id = q.id
                                    ), CAST('[]' AS json))
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN question_slide q ON q.id = s.source_id
                        LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                        LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                        LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                        LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                        LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                        LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                        WHERE s.source_type = 'QUESTION' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- ASSIGNMENT SLIDES
                         SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'assignment_slide', json_build_object(
                                    'id', a.id,
                                    'live_date', a.live_date,
                                    'end_date', a.end_date,
                                    'comma_separated_media_ids', a.comma_separated_media_ids,
                                    're_attempt_count', a.re_attempt_count,
                                    'text_data', CASE
                                        WHEN a.text_id IS NOT NULL THEN json_build_object(
                                            'id', rt_text.id,
                                            'type', rt_text.type,
                                            'content', COALESCE(rtt_text.content, rt_text.content)
                                        ) ELSE NULL
                                    END,
                                    'parent_rich_text', CASE
                                        WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object(
                                            'id', rt_parent.id,
                                            'type', rt_parent.type,
                                            'content', COALESCE(rtt_parent.content, rt_parent.content)
                                        ) ELSE NULL
                                    END,
                                    'questions', COALESCE((
                                        SELECT json_agg(
                                            json_build_object(
                                                'id', q.id,
                                                'question_order', q.question_order,
                                                'status', q.status,
                                                'text_data', CASE
                                                    WHEN q.text_id IS NOT NULL THEN json_build_object(
                                                        'id', rtq.id,
                                                        'type', rtq.type,
                                                        'content', COALESCE(rtt_rtq.content, rtq.content)
                                                    ) ELSE NULL
                                                END
                                            )
                                            ORDER BY q.question_order
                                        )
                                        FROM assignment_slide_question q
                                        LEFT JOIN rich_text_data rtq ON rtq.id = q.text_id
                                        LEFT JOIN rich_text_translation rtt_rtq ON rtt_rtq.rich_text_id = rtq.id AND rtt_rtq.locale = :lang AND rtt_rtq.state IN ('PUBLISHED','STALE')
                                        WHERE q.assignment_slide_id = a.id AND q.status IN (:videoSlideQuestionStatus)
                                    ), CAST('[]' AS json))
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN assignment_slide a ON a.id = s.source_id
                        LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                        LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                        LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                        LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                        WHERE s.source_type = 'ASSIGNMENT' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- QUIZ SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'quiz_slide', json_build_object(
                                    'id', qs.id,
                                    'title', qs.title,
                                    'description', CASE WHEN qs_description_rt.id IS NOT NULL THEN json_build_object('id', qs_description_rt.id, 'type', qs_description_rt.type, 'content', COALESCE(rtt_qs_desc.content, qs_description_rt.content)) ELSE NULL END,
                                    'time_limit_in_minutes', qs.time_limit_in_minutes,
                                    'marks_per_question', qs.marks_per_question,
                                    'negative_marking', qs.negative_marking,
                                    'pass_percentage', qs.pass_percentage,
                                    'partial_marking', qs.partial_marking,
                                    're_attempt_count', qs.re_attempt_count,
                                    'questions', COALESCE((
                                        SELECT json_agg(
                                            json_build_object(
                                                'id', q.id,
                                                'question_response_type', q.question_response_type,
                                                'question_type', q.question_type,
                                                'access_level', q.access_level,
                                                'question_order', q.question_order,
                                                'status', q.status,
                                                'media_id', q.media_id,
                                                'can_skip', q.can_skip,
                                                'auto_evaluation_json', q.auto_evaluation_json,
                                                'evaluation_type', q.evaluation_type,
                                                'marks', q.marks,
                                                'negative_marking', q.negative_marking,
                                                'text', json_build_object('id', q_text_rt.id, 'type', q_text_rt.type, 'content', COALESCE(rtt_q_text.content, q_text_rt.content)),
                                                'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', q_parent_rt.id, 'type', q_parent_rt.type, 'content', COALESCE(rtt_q_parent.content, q_parent_rt.content)) ELSE NULL END,
                                                'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', q_exp_rt.id, 'type', q_exp_rt.type, 'content', COALESCE(rtt_q_exp.content, q_exp_rt.content)) ELSE NULL END,
                                                'options', COALESCE((
                                                    SELECT json_agg(
                                                        json_build_object(
                                                            'id', o.id,
                                                            'media_id', o.media_id,
                                                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', o_text_rt.id, 'type', o_text_rt.type, 'content', COALESCE(rtt_o_text.content, o_text_rt.content)) ELSE NULL END,
                                                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', o_exp_rt.id, 'type', o_exp_rt.type, 'content', COALESCE(rtt_o_exp.content, o_exp_rt.content)) ELSE NULL END
                                                        )
                                                    )
                                                    FROM quiz_slide_question_options o
                                                    LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                                                    LEFT JOIN rich_text_translation rtt_o_text ON rtt_o_text.rich_text_id = o_text_rt.id AND rtt_o_text.locale = :lang AND rtt_o_text.state IN ('PUBLISHED','STALE')
                                                    LEFT JOIN rich_text_data o_exp_rt ON o_exp_rt.id = o.explanation_text_id
                                                    LEFT JOIN rich_text_translation rtt_o_exp ON rtt_o_exp.rich_text_id = o_exp_rt.id AND rtt_o_exp.locale = :lang AND rtt_o_exp.state IN ('PUBLISHED','STALE')
                                                    WHERE o.quiz_slide_question_id = q.id
                                                ), CAST('[]' AS json))
                                            )
                                            ORDER BY q.question_order
                                        )
                                        FROM quiz_slide_question q
                                        LEFT JOIN rich_text_data q_text_rt ON q_text_rt.id = q.text_id
                                        LEFT JOIN rich_text_translation rtt_q_text ON rtt_q_text.rich_text_id = q_text_rt.id AND rtt_q_text.locale = :lang AND rtt_q_text.state IN ('PUBLISHED','STALE')
                                        LEFT JOIN rich_text_data q_parent_rt ON q_parent_rt.id = q.parent_rich_text_id
                                        LEFT JOIN rich_text_translation rtt_q_parent ON rtt_q_parent.rich_text_id = q_parent_rt.id AND rtt_q_parent.locale = :lang AND rtt_q_parent.state IN ('PUBLISHED','STALE')
                                        LEFT JOIN rich_text_data q_exp_rt ON q_exp_rt.id = q.explanation_text_id
                                        LEFT JOIN rich_text_translation rtt_q_exp ON rtt_q_exp.rich_text_id = q_exp_rt.id AND rtt_q_exp.locale = :lang AND rtt_q_exp.state IN ('PUBLISHED','STALE')
                                        WHERE q.quiz_slide_id = qs.id
                                        AND q.status IN (:videoSlideQuestionStatus)
                                    ), CAST('[]' AS json))
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN quiz_slide qs ON qs.id = s.source_id
                        LEFT JOIN rich_text_data qs_description_rt ON qs_description_rt.id = qs.description
                        LEFT JOIN rich_text_translation rtt_qs_desc ON rtt_qs_desc.rich_text_id = qs_description_rt.id AND rtt_qs_desc.locale = :lang AND rtt_qs_desc.state IN ('PUBLISHED','STALE')
                        WHERE s.source_type = 'QUIZ' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- HTML VIDEO SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'html_video_slide', json_build_object(
                                    'id', h.id,
                                    'url', h.url,
                                    'video_length_in_millis', h.video_length,
                                    'ai_gen_video_id', h.ai_gen_video_id,
                                    'code_editor_config', CASE WHEN h.code_editor_config IS NULL THEN NULL ELSE CAST(h.code_editor_config AS TEXT) END
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN html_video_slide h ON h.id = s.source_id
                        WHERE s.source_type = 'HTML_VIDEO' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)


                        UNION ALL

                        -- SCORM SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'scorm_slide', json_build_object(
                                    'id', sc.id,
                                    'launch_path', sc.launch_path,
                                    'launch_url', sc.launch_url,
                                    'scorm_version', sc.scorm_version,
                                    'original_file_id', sc.original_file_id
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN scorm_slide sc ON sc.id = s.source_id
                        WHERE s.source_type = 'SCORM' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- AUDIO SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
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
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN audio_slide a ON a.id = s.source_id
                        WHERE s.source_type = 'AUDIO' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)

                        UNION ALL

                        -- ASSESSMENT SLIDES
                        SELECT
                            s.created_at,
                            cs.slide_order,
                            json_build_object(
                                'id', s.id,
                                'title', COALESCE(eft_title.content, s.title),
                                'status', s.status,
                                'is_loaded', true,
                                'new_slide', true,
                                'source_id', s.source_id,
                                'description', COALESCE(eft_desc.content, s.description),
                                'slide_order', cs.slide_order,
                                'source_type', s.source_type,
                                'drip_condition', s.drip_condition_json,
                                'assessment_slide', json_build_object(
                                    'id', asl.id,
                                    'assessment_id', asl.assessment_id,
                                    'allow_reattempt', asl.allow_reattempt,
                                    'show_result', asl.show_result
                                )
                            ) AS slide_data
                        FROM slide s
                        JOIN chapter_to_slides cs ON cs.slide_id = s.id
                        JOIN chapter c ON c.id = cs.chapter_id
                        LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                        LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                        JOIN assessment_slide asl ON asl.id = s.source_id
                        WHERE s.source_type = 'ASSESSMENT' AND c.id = :chapterId
                        AND s.status IN (:slideStatus)
                        AND cs.status IN (:chapterToSlidesStatus)
                    ) AS all_slides
            """, nativeQuery = true)
    String getSlidesByChapterId(
            @Param("chapterId") String chapterId,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterToSlidesStatus") List<String> chapterToSlidesStatus,
            @Param("videoSlideQuestionStatus") List<String> videoSlideQuestionStatus,
            @Param("lang") String lang);

    @Query(value = """
                SELECT json_agg(slide_data ORDER BY slide_order IS NOT NULL, slide_order, created_at DESC) AS slides
                FROM (
                    -- VIDEO SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', COALESCE(CAST(lo_video_marker.value AS bigint), NULL),
                            'percentage_completed', CASE
                                WHEN lo_video_percent.value IS NULL OR lo_video_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_video_percent.value AS double precision)
                            END,
                            'video_slide', json_build_object(
                                'id', v.id,
                                'url', v.url,
                                'title', v.title,
                                'description', v.description,
                                'embedded_type', v.embedded_type,
                                'embedded_data', v.embedded_data,
                                'source_type', v.source_type,
                                'published_url', v.published_url,
                                'video_length_in_millis', v.video_length,
                                'published_video_length_in_millis', v.published_video_length,
                                'questions', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', q.id,
                                            'can_skip', q.can_skip,
                                            'question_response_type', q.question_response_type,
                                            'question_type', q.question_type,
                                            'access_level', q.access_level,
                                            'question_order', q.question_order,
                                            'question_time_in_millis', q.question_time_in_millis,
                                            'media_id', q.media_id,
                                            'auto_evaluation_json', q.auto_evaluation_json,
                                            'evaluation_type', q.evaluation_type,
                                            'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                            'options', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', o.id,
                                                        'media_id', o.media_id,
                                                        'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                                        'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                                    )
                                                )
                                                FROM video_slide_question_options o
                                                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                                LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                                WHERE o.video_slide_question_id = q.id
                                            ), CAST('[]' AS json))
                                        )
                                        ORDER BY q.question_order
                                    )
                                    FROM video_slide_question q
                                    LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                                    LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                                    LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                                    LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                                    WHERE q.video_slide_id = v.id AND q.status IN (:videoSlideQuestionStatus)
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN video v ON v.id = s.source_id
                    LEFT JOIN learner_operation lo_video_marker ON lo_video_marker.source = 'SLIDE' AND lo_video_marker.source_id = s.id AND lo_video_marker.user_id = :userId AND lo_video_marker.operation = 'VIDEO_LAST_TIMESTAMP'
                    LEFT JOIN learner_operation lo_video_percent ON lo_video_percent.source = 'SLIDE' AND lo_video_percent.source_id = s.id AND lo_video_percent.user_id = :userId AND lo_video_percent.operation = 'PERCENTAGE_VIDEO_WATCHED'
                    WHERE s.source_type = 'VIDEO' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- DOCUMENT SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', COALESCE(CAST(lo_doc_marker.value AS bigint), NULL),
                            'percentage_completed', CASE
                                WHEN lo_doc_percent.value IS NULL OR lo_doc_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_doc_percent.value AS double precision)
                            END,
                            'document_slide', json_build_object(
                                'id', d.id,
                                'title', d.title,
                                'type', d.type,
                                'cover_file_id', d.cover_file_id,
                                -- Publishing before the 2026-07-08 save-lifecycle fix nulled the
                                -- draft columns, so ~6.5k legacy rows hold their content only in
                                -- published_*. Fall back so no reader ever sees a null document.
                                'total_pages', COALESCE(d.total_pages, d.published_document_total_pages),
                                'published_document_total_pages', d.published_document_total_pages,
                                'data', COALESCE(d.data, d.published_data),
                                'published_data', d.published_data
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN document_slide d ON d.id = s.source_id
                    LEFT JOIN learner_operation lo_doc_marker ON lo_doc_marker.source = 'SLIDE' AND lo_doc_marker.source_id = s.id AND lo_doc_marker.user_id = :userId AND lo_doc_marker.operation = 'DOCUMENT_LAST_PAGE'
                    LEFT JOIN learner_operation lo_doc_percent ON lo_doc_percent.source = 'SLIDE' AND lo_doc_percent.source_id = s.id AND lo_doc_percent.user_id = :userId AND lo_doc_percent.operation = 'PERCENTAGE_DOCUMENT_COMPLETED'
                    WHERE s.source_type = 'DOCUMENT' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- QUESTION SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', CASE
                                WHEN lo_ques_percent.value IS NULL OR lo_ques_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_ques_percent.value AS double precision)
                            END,
                            'question_slide', json_build_object(
                                'id', q.id,
                                'question_type', q.question_type,
                                'question_response_type', q.question_response_type,
                                'access_level', q.access_level,
                                'default_question_time_mins', q.default_question_time_mins,
                                'points', q.points,
                                're_attempt_count', q.re_attempt_count,
                                'auto_evaluation_json', q.auto_evaluation_json,
                                'evaluation_type', q.evaluation_type,
                                'media_id', q.media_id,
                                'source_type', q.source_type,
                                'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                'options', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', o.id,
                                            'media_id', o.media_id,
                                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                    )
                                    ORDER BY o.created_on
                                )
                                FROM option o
                                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                WHERE o.question_id = q.id
                            ), CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN question_slide q ON q.id = s.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_ques_percent ON lo_ques_percent.source = 'SLIDE' AND lo_ques_percent.source_id = s.id AND lo_ques_percent.user_id = :userId AND lo_ques_percent.operation = 'PERCENTAGE_QUESTION_COMPLETED'
                WHERE s.source_type = 'QUESTION' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- ASSIGNMENT SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_assign_percent.value IS NULL OR lo_assign_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_assign_percent.value AS double precision)
                        END,
                        'assignment_slide', json_build_object(
                            'id', a.id,
                            'live_date', a.live_date,
                            'end_date', a.end_date,
                            'comma_separated_media_ids', a.comma_separated_media_ids,
                            're_attempt_count', a.re_attempt_count,
                            'text_data', CASE
                                WHEN a.text_id IS NOT NULL THEN json_build_object(
                                    'id', rt_text.id,
                                    'type', rt_text.type,
                                    'content', COALESCE(rtt_text.content, rt_text.content)
                                ) ELSE NULL
                            END,
                            'parent_rich_text', CASE
                                WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object(
                                    'id', rt_parent.id,
                                    'type', rt_parent.type,
                                    'content', COALESCE(rtt_parent.content, rt_parent.content)
                                ) ELSE NULL
                            END,
                            'questions', COALESCE((
                                SELECT json_agg(
                                    json_build_object(
                                        'id', q.id,
                                        'question_order', q.question_order,
                                        'status', q.status,
                                        'text_data', CASE
                                            WHEN q.text_id IS NOT NULL THEN json_build_object(
                                                'id', rtq.id,
                                                'type', rtq.type,
                                                'content', COALESCE(rtt_rtq.content, rtq.content)
                                            ) ELSE NULL
                                        END
                                    )
                                    ORDER BY q.question_order
                                )
                                FROM assignment_slide_question q
                                LEFT JOIN rich_text_data rtq ON rtq.id = q.text_id
                                LEFT JOIN rich_text_translation rtt_rtq ON rtt_rtq.rich_text_id = rtq.id AND rtt_rtq.locale = :lang AND rtt_rtq.state IN ('PUBLISHED','STALE')
                                WHERE q.assignment_slide_id = a.id AND q.status IN (:videoSlideQuestionStatus)
                            ), CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN assignment_slide a ON a.id = s.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_assign_percent ON lo_assign_percent.source = 'SLIDE' AND lo_assign_percent.source_id = s.id AND lo_assign_percent.user_id = :userId AND lo_assign_percent.operation = 'PERCENTAGE_ASSIGNMENT_COMPLETED'
                WHERE s.source_type = 'ASSIGNMENT' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- QUIZ SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL, -- Assuming no specific marker for quizzes, adjust if needed
                        'percentage_completed', CASE
                            WHEN lo_quiz_percent.value IS NULL OR lo_quiz_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_quiz_percent.value AS double precision)
                        END,
                        'quiz_slide', json_build_object(
                            'id', qs.id,
                            'title', qs.title,
                            'description', CASE WHEN qs_description_rt.id IS NOT NULL THEN json_build_object('id', qs_description_rt.id, 'type', qs_description_rt.type, 'content', COALESCE(rtt_qs_desc.content, qs_description_rt.content)) ELSE NULL END,
                            'time_limit_in_minutes', qs.time_limit_in_minutes,
                            'marks_per_question', qs.marks_per_question,
                            'negative_marking', qs.negative_marking,
                            'pass_percentage', qs.pass_percentage,
                            'partial_marking', qs.partial_marking,
                            're_attempt_count', qs.re_attempt_count,
                            'questions', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', q.id,
                                                        'question_response_type', q.question_response_type,
                                                        'question_type', q.question_type,
                                                        'access_level', q.access_level,
                                                        'question_order', q.question_order,
                                                        'status', q.status,
                                                        'media_id', q.media_id,
                                                        'can_skip', q.can_skip,
                                                        'auto_evaluation_json', q.auto_evaluation_json,
                                                        'evaluation_type', q.evaluation_type,
                                                        'marks', q.marks,
                                                        'negative_marking', q.negative_marking,
                                                        'text', json_build_object('id', q_text_rt.id, 'type', q_text_rt.type, 'content', COALESCE(rtt_q_text.content, q_text_rt.content)),
                                                        'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', q_parent_rt.id, 'type', q_parent_rt.type, 'content', COALESCE(rtt_q_parent.content, q_parent_rt.content)) ELSE NULL END,
                                                        'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', q_exp_rt.id, 'type', q_exp_rt.type, 'content', COALESCE(rtt_q_exp.content, q_exp_rt.content)) ELSE NULL END,
                                                        'options', COALESCE((
                                                            SELECT json_agg(
                                                                json_build_object(
                                                                    'id', o.id,
                                                                    'media_id', o.media_id,
                                                                    'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', o_text_rt.id, 'type', o_text_rt.type, 'content', COALESCE(rtt_o_text.content, o_text_rt.content)) ELSE NULL END,
                                                                    'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', o_exp_rt.id, 'type', o_exp_rt.type, 'content', COALESCE(rtt_o_exp.content, o_exp_rt.content)) ELSE NULL END
                                                                )
                                                            )
                                                            FROM quiz_slide_question_options o
                                                            LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                                                            LEFT JOIN rich_text_translation rtt_o_text ON rtt_o_text.rich_text_id = o_text_rt.id AND rtt_o_text.locale = :lang AND rtt_o_text.state IN ('PUBLISHED','STALE')
                                                            LEFT JOIN rich_text_data o_exp_rt ON o_exp_rt.id = o.explanation_text_id
                                                            LEFT JOIN rich_text_translation rtt_o_exp ON rtt_o_exp.rich_text_id = o_exp_rt.id AND rtt_o_exp.locale = :lang AND rtt_o_exp.state IN ('PUBLISHED','STALE')
                                                            WHERE o.quiz_slide_question_id = q.id
                                                        ), CAST('[]' AS json))
                                                    )
                                                    ORDER BY q.question_order
                                                )
                                                FROM quiz_slide_question q
                                                LEFT JOIN rich_text_data q_text_rt ON q_text_rt.id = q.text_id
                                                LEFT JOIN rich_text_translation rtt_q_text ON rtt_q_text.rich_text_id = q_text_rt.id AND rtt_q_text.locale = :lang AND rtt_q_text.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data q_parent_rt ON q_parent_rt.id = q.parent_rich_text_id
                                                LEFT JOIN rich_text_translation rtt_q_parent ON rtt_q_parent.rich_text_id = q_parent_rt.id AND rtt_q_parent.locale = :lang AND rtt_q_parent.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data q_exp_rt ON q_exp_rt.id = q.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_q_exp ON rtt_q_exp.rich_text_id = q_exp_rt.id AND rtt_q_exp.locale = :lang AND rtt_q_exp.state IN ('PUBLISHED','STALE')
                                                WHERE q.quiz_slide_id = qs.id
                                                AND q.status IN (:videoSlideQuestionStatus)
                                            ), CAST('[]' AS json))
                                        )
                                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN quiz_slide qs ON qs.id = s.source_id
                LEFT JOIN rich_text_data qs_description_rt ON qs_description_rt.id = qs.description
                LEFT JOIN rich_text_translation rtt_qs_desc ON rtt_qs_desc.rich_text_id = qs_description_rt.id AND rtt_qs_desc.locale = :lang AND rtt_qs_desc.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_quiz_percent ON lo_quiz_percent.source = 'SLIDE' AND lo_quiz_percent.source_id = s.id AND lo_quiz_percent.user_id = :userId AND lo_quiz_percent.operation = 'PERCENTAGE_QUIZ_COMPLETED'
                WHERE s.source_type = 'QUIZ' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- HTML VIDEO SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', NULL,
                        'html_video_slide', json_build_object(
                            'id', h.id,
                            'url', h.url,
                            'video_length_in_millis', h.video_length,
                            'ai_gen_video_id', h.ai_gen_video_id,
                            'code_editor_config', CASE WHEN h.code_editor_config IS NULL THEN NULL ELSE CAST(h.code_editor_config AS TEXT) END
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN html_video_slide h ON h.id = s.source_id
                WHERE s.source_type = 'HTML_VIDEO' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- SCORM SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_scorm_percent.value IS NULL OR lo_scorm_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_scorm_percent.value AS double precision)
                        END,
                        'scorm_slide', json_build_object(
                            'id', sc.id,
                            'launch_path', sc.launch_path,
                            'launch_url', sc.launch_url,
                            'scorm_version', sc.scorm_version,
                            'original_file_id', sc.original_file_id
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN scorm_slide sc ON sc.id = s.source_id
                LEFT JOIN learner_operation lo_scorm_percent ON lo_scorm_percent.source = 'SLIDE' AND lo_scorm_percent.source_id = s.id AND lo_scorm_percent.user_id = :userId AND lo_scorm_percent.operation = 'PERCENTAGE_SCORM_COMPLETED'
                WHERE s.source_type = 'SCORM' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- AUDIO SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', COALESCE(CAST(lo_audio_marker.value AS bigint), NULL),
                        'percentage_completed', CASE
                            WHEN lo_audio_percent.value IS NULL OR lo_audio_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_audio_percent.value AS double precision)
                        END,
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
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN audio_slide a ON a.id = s.source_id
                LEFT JOIN learner_operation lo_audio_marker ON lo_audio_marker.source = 'SLIDE' AND lo_audio_marker.source_id = s.id AND lo_audio_marker.user_id = :userId AND lo_audio_marker.operation = 'AUDIO_LAST_TIMESTAMP'
                LEFT JOIN learner_operation lo_audio_percent ON lo_audio_percent.source = 'SLIDE' AND lo_audio_percent.source_id = s.id AND lo_audio_percent.user_id = :userId AND lo_audio_percent.operation = 'PERCENTAGE_AUDIO_LISTENED'
                WHERE s.source_type = 'AUDIO' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- ASSESSMENT SLIDES
                SELECT DISTINCT ON (s.id)
                    s.created_at,
                    cs.slide_order,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_assessment_percent.value IS NULL OR lo_assessment_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_assessment_percent.value AS double precision)
                        END,
                        'assessment_slide', json_build_object(
                            'id', asl.id,
                            'assessment_id', asl.assessment_id,
                            'allow_reattempt', asl.allow_reattempt,
                            'show_result', asl.show_result
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN assessment_slide asl ON asl.id = s.source_id
                LEFT JOIN learner_operation lo_assessment_percent ON lo_assessment_percent.source = 'SLIDE' AND lo_assessment_percent.source_id = s.id AND lo_assessment_percent.user_id = :userId AND lo_assessment_percent.operation = 'PERCENTAGE_ASSESSMENT_DONE'
                WHERE s.source_type = 'ASSESSMENT' AND c.id = :chapterId
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)
            ) AS slide_data
            """, nativeQuery = true)
    String getSlidesByChapterId(
            @Param("chapterId") String chapterId,
            @Param("userId") String userId,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterToSlidesStatus") List<String> chapterToSlidesStatus,
            @Param("videoSlideQuestionStatus") List<String> videoSlideQuestionStatus,
            @Param("lang") String lang);

    /**
     * Bulk variant of the learner {@code getSlidesByChapterId} query above: same
     * nine per-source-type branches and JSON shape per slide, but for EVERY
     * chapter mapped to the package session. Chapter scoping is ACTIVE-only on
     * BOTH the mapping and the chapter — the exact set modules-with-chapters
     * shows learners — so PENDING_APPROVAL chapters (teacher approval flow)
     * are never proactively delivered. Result groups slides per chapter:
     * [{"chapter_id": ..., "slides": [ ...same objects as /slides... ]}].
     * Keep the branch bodies in sync with the per-chapter query when editing.
     */
    @Query(value = """
                SELECT json_agg(json_build_object('chapter_id', chapter_id, 'slides', slides)) AS chapters
                FROM (
                    SELECT chapter_id,
                           json_agg(slide_data ORDER BY slide_order IS NOT NULL, slide_order, created_at DESC) AS slides
                    FROM (
                    -- VIDEO SLIDES
                    SELECT DISTINCT ON (cs.chapter_id, s.id)
                        s.created_at,
                        cs.slide_order,
                        cs.chapter_id,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', COALESCE(CAST(lo_video_marker.value AS bigint), NULL),
                            'percentage_completed', CASE
                                WHEN lo_video_percent.value IS NULL OR lo_video_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_video_percent.value AS double precision)
                            END,
                            'video_slide', json_build_object(
                                'id', v.id,
                                'url', v.url,
                                'title', v.title,
                                'description', v.description,
                                'embedded_type', v.embedded_type,
                                'embedded_data', v.embedded_data,
                                'source_type', v.source_type,
                                'published_url', v.published_url,
                                'video_length_in_millis', v.video_length,
                                'published_video_length_in_millis', v.published_video_length,
                                'questions', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', q.id,
                                            'can_skip', q.can_skip,
                                            'question_response_type', q.question_response_type,
                                            'question_type', q.question_type,
                                            'access_level', q.access_level,
                                            'question_order', q.question_order,
                                            'question_time_in_millis', q.question_time_in_millis,
                                            'media_id', q.media_id,
                                            'auto_evaluation_json', q.auto_evaluation_json,
                                            'evaluation_type', q.evaluation_type,
                                            'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                            'options', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', o.id,
                                                        'media_id', o.media_id,
                                                        'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                                        'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                                    )
                                                )
                                                FROM video_slide_question_options o
                                                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                                LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                                WHERE o.video_slide_question_id = q.id
                                            ), CAST('[]' AS json))
                                        )
                                        ORDER BY q.question_order
                                    )
                                    FROM video_slide_question q
                                    LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                                    LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                                    LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                                    LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                                    WHERE q.video_slide_id = v.id AND q.status IN (:videoSlideQuestionStatus)
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN video v ON v.id = s.source_id
                    LEFT JOIN learner_operation lo_video_marker ON lo_video_marker.source = 'SLIDE' AND lo_video_marker.source_id = s.id AND lo_video_marker.user_id = :userId AND lo_video_marker.operation = 'VIDEO_LAST_TIMESTAMP'
                    LEFT JOIN learner_operation lo_video_percent ON lo_video_percent.source = 'SLIDE' AND lo_video_percent.source_id = s.id AND lo_video_percent.user_id = :userId AND lo_video_percent.operation = 'PERCENTAGE_VIDEO_WATCHED'
                    WHERE s.source_type = 'VIDEO' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- DOCUMENT SLIDES
                    SELECT DISTINCT ON (cs.chapter_id, s.id)
                        s.created_at,
                        cs.slide_order,
                        cs.chapter_id,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', COALESCE(CAST(lo_doc_marker.value AS bigint), NULL),
                            'percentage_completed', CASE
                                WHEN lo_doc_percent.value IS NULL OR lo_doc_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_doc_percent.value AS double precision)
                            END,
                            'document_slide', json_build_object(
                                'id', d.id,
                                'title', d.title,
                                'type', d.type,
                                'cover_file_id', d.cover_file_id,
                                -- Publishing before the 2026-07-08 save-lifecycle fix nulled the
                                -- draft columns, so ~6.5k legacy rows hold their content only in
                                -- published_*. Fall back so no reader ever sees a null document.
                                'total_pages', COALESCE(d.total_pages, d.published_document_total_pages),
                                'published_document_total_pages', d.published_document_total_pages,
                                'data', COALESCE(d.data, d.published_data),
                                'published_data', d.published_data
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN document_slide d ON d.id = s.source_id
                    LEFT JOIN learner_operation lo_doc_marker ON lo_doc_marker.source = 'SLIDE' AND lo_doc_marker.source_id = s.id AND lo_doc_marker.user_id = :userId AND lo_doc_marker.operation = 'DOCUMENT_LAST_PAGE'
                    LEFT JOIN learner_operation lo_doc_percent ON lo_doc_percent.source = 'SLIDE' AND lo_doc_percent.source_id = s.id AND lo_doc_percent.user_id = :userId AND lo_doc_percent.operation = 'PERCENTAGE_DOCUMENT_COMPLETED'
                    WHERE s.source_type = 'DOCUMENT' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- QUESTION SLIDES
                    SELECT DISTINCT ON (cs.chapter_id, s.id)
                        s.created_at,
                        cs.slide_order,
                        cs.chapter_id,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', CASE
                                WHEN lo_ques_percent.value IS NULL OR lo_ques_percent.value = 'null' THEN NULL
                                ELSE CAST(lo_ques_percent.value AS double precision)
                            END,
                            'question_slide', json_build_object(
                                'id', q.id,
                                'question_type', q.question_type,
                                'question_response_type', q.question_response_type,
                                'access_level', q.access_level,
                                'default_question_time_mins', q.default_question_time_mins,
                                'points', q.points,
                                're_attempt_count', q.re_attempt_count,
                                'auto_evaluation_json', q.auto_evaluation_json,
                                'evaluation_type', q.evaluation_type,
                                'media_id', q.media_id,
                                'source_type', q.source_type,
                                'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                'options', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', o.id,
                                            'media_id', o.media_id,
                                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                    )
                                    ORDER BY o.created_on
                                )
                                FROM option o
                                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                WHERE o.question_id = q.id
                            ), CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN question_slide q ON q.id = s.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_ques_percent ON lo_ques_percent.source = 'SLIDE' AND lo_ques_percent.source_id = s.id AND lo_ques_percent.user_id = :userId AND lo_ques_percent.operation = 'PERCENTAGE_QUESTION_COMPLETED'
                WHERE s.source_type = 'QUESTION' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- ASSIGNMENT SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_assign_percent.value IS NULL OR lo_assign_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_assign_percent.value AS double precision)
                        END,
                        'assignment_slide', json_build_object(
                            'id', a.id,
                            'live_date', a.live_date,
                            'end_date', a.end_date,
                            'comma_separated_media_ids', a.comma_separated_media_ids,
                            're_attempt_count', a.re_attempt_count,
                            'text_data', CASE
                                WHEN a.text_id IS NOT NULL THEN json_build_object(
                                    'id', rt_text.id,
                                    'type', rt_text.type,
                                    'content', COALESCE(rtt_text.content, rt_text.content)
                                ) ELSE NULL
                            END,
                            'parent_rich_text', CASE
                                WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object(
                                    'id', rt_parent.id,
                                    'type', rt_parent.type,
                                    'content', COALESCE(rtt_parent.content, rt_parent.content)
                                ) ELSE NULL
                            END,
                            'questions', COALESCE((
                                SELECT json_agg(
                                    json_build_object(
                                        'id', q.id,
                                        'question_order', q.question_order,
                                        'status', q.status,
                                        'text_data', CASE
                                            WHEN q.text_id IS NOT NULL THEN json_build_object(
                                                'id', rtq.id,
                                                'type', rtq.type,
                                                'content', COALESCE(rtt_rtq.content, rtq.content)
                                            ) ELSE NULL
                                        END
                                    )
                                    ORDER BY q.question_order
                                )
                                FROM assignment_slide_question q
                                LEFT JOIN rich_text_data rtq ON rtq.id = q.text_id
                                LEFT JOIN rich_text_translation rtt_rtq ON rtt_rtq.rich_text_id = rtq.id AND rtt_rtq.locale = :lang AND rtt_rtq.state IN ('PUBLISHED','STALE')
                                WHERE q.assignment_slide_id = a.id AND q.status IN (:videoSlideQuestionStatus)
                            ), CAST('[]' AS json))
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN assignment_slide a ON a.id = s.source_id
                LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_assign_percent ON lo_assign_percent.source = 'SLIDE' AND lo_assign_percent.source_id = s.id AND lo_assign_percent.user_id = :userId AND lo_assign_percent.operation = 'PERCENTAGE_ASSIGNMENT_COMPLETED'
                WHERE s.source_type = 'ASSIGNMENT' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- QUIZ SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL, -- Assuming no specific marker for quizzes, adjust if needed
                        'percentage_completed', CASE
                            WHEN lo_quiz_percent.value IS NULL OR lo_quiz_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_quiz_percent.value AS double precision)
                        END,
                        'quiz_slide', json_build_object(
                            'id', qs.id,
                            'title', qs.title,
                            'description', CASE WHEN qs_description_rt.id IS NOT NULL THEN json_build_object('id', qs_description_rt.id, 'type', qs_description_rt.type, 'content', COALESCE(rtt_qs_desc.content, qs_description_rt.content)) ELSE NULL END,
                            'time_limit_in_minutes', qs.time_limit_in_minutes,
                            'marks_per_question', qs.marks_per_question,
                            'negative_marking', qs.negative_marking,
                            'pass_percentage', qs.pass_percentage,
                            'partial_marking', qs.partial_marking,
                            're_attempt_count', qs.re_attempt_count,
                            'questions', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', q.id,
                                                        'question_response_type', q.question_response_type,
                                                        'question_type', q.question_type,
                                                        'access_level', q.access_level,
                                                        'question_order', q.question_order,
                                                        'status', q.status,
                                                        'media_id', q.media_id,
                                                        'can_skip', q.can_skip,
                                                        'auto_evaluation_json', q.auto_evaluation_json,
                                                        'evaluation_type', q.evaluation_type,
                                                        'marks', q.marks,
                                                        'negative_marking', q.negative_marking,
                                                        'text', json_build_object('id', q_text_rt.id, 'type', q_text_rt.type, 'content', COALESCE(rtt_q_text.content, q_text_rt.content)),
                                                        'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', q_parent_rt.id, 'type', q_parent_rt.type, 'content', COALESCE(rtt_q_parent.content, q_parent_rt.content)) ELSE NULL END,
                                                        'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', q_exp_rt.id, 'type', q_exp_rt.type, 'content', COALESCE(rtt_q_exp.content, q_exp_rt.content)) ELSE NULL END,
                                                        'options', COALESCE((
                                                            SELECT json_agg(
                                                                json_build_object(
                                                                    'id', o.id,
                                                                    'media_id', o.media_id,
                                                                    'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', o_text_rt.id, 'type', o_text_rt.type, 'content', COALESCE(rtt_o_text.content, o_text_rt.content)) ELSE NULL END,
                                                                    'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', o_exp_rt.id, 'type', o_exp_rt.type, 'content', COALESCE(rtt_o_exp.content, o_exp_rt.content)) ELSE NULL END
                                                                )
                                                            )
                                                            FROM quiz_slide_question_options o
                                                            LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                                                            LEFT JOIN rich_text_translation rtt_o_text ON rtt_o_text.rich_text_id = o_text_rt.id AND rtt_o_text.locale = :lang AND rtt_o_text.state IN ('PUBLISHED','STALE')
                                                            LEFT JOIN rich_text_data o_exp_rt ON o_exp_rt.id = o.explanation_text_id
                                                            LEFT JOIN rich_text_translation rtt_o_exp ON rtt_o_exp.rich_text_id = o_exp_rt.id AND rtt_o_exp.locale = :lang AND rtt_o_exp.state IN ('PUBLISHED','STALE')
                                                            WHERE o.quiz_slide_question_id = q.id
                                                        ), CAST('[]' AS json))
                                                    )
                                                    ORDER BY q.question_order
                                                )
                                                FROM quiz_slide_question q
                                                LEFT JOIN rich_text_data q_text_rt ON q_text_rt.id = q.text_id
                                                LEFT JOIN rich_text_translation rtt_q_text ON rtt_q_text.rich_text_id = q_text_rt.id AND rtt_q_text.locale = :lang AND rtt_q_text.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data q_parent_rt ON q_parent_rt.id = q.parent_rich_text_id
                                                LEFT JOIN rich_text_translation rtt_q_parent ON rtt_q_parent.rich_text_id = q_parent_rt.id AND rtt_q_parent.locale = :lang AND rtt_q_parent.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data q_exp_rt ON q_exp_rt.id = q.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_q_exp ON rtt_q_exp.rich_text_id = q_exp_rt.id AND rtt_q_exp.locale = :lang AND rtt_q_exp.state IN ('PUBLISHED','STALE')
                                                WHERE q.quiz_slide_id = qs.id
                                                AND q.status IN (:videoSlideQuestionStatus)
                                            ), CAST('[]' AS json))
                                        )
                                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN quiz_slide qs ON qs.id = s.source_id
                LEFT JOIN rich_text_data qs_description_rt ON qs_description_rt.id = qs.description
                LEFT JOIN rich_text_translation rtt_qs_desc ON rtt_qs_desc.rich_text_id = qs_description_rt.id AND rtt_qs_desc.locale = :lang AND rtt_qs_desc.state IN ('PUBLISHED','STALE')
                LEFT JOIN learner_operation lo_quiz_percent ON lo_quiz_percent.source = 'SLIDE' AND lo_quiz_percent.source_id = s.id AND lo_quiz_percent.user_id = :userId AND lo_quiz_percent.operation = 'PERCENTAGE_QUIZ_COMPLETED'
                WHERE s.source_type = 'QUIZ' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- HTML VIDEO SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', NULL,
                        'html_video_slide', json_build_object(
                            'id', h.id,
                            'url', h.url,
                            'video_length_in_millis', h.video_length,
                            'ai_gen_video_id', h.ai_gen_video_id,
                            'code_editor_config', CASE WHEN h.code_editor_config IS NULL THEN NULL ELSE CAST(h.code_editor_config AS TEXT) END
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN html_video_slide h ON h.id = s.source_id
                WHERE s.source_type = 'HTML_VIDEO' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- SCORM SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_scorm_percent.value IS NULL OR lo_scorm_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_scorm_percent.value AS double precision)
                        END,
                        'scorm_slide', json_build_object(
                            'id', sc.id,
                            'launch_path', sc.launch_path,
                            'launch_url', sc.launch_url,
                            'scorm_version', sc.scorm_version,
                            'original_file_id', sc.original_file_id
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN scorm_slide sc ON sc.id = s.source_id
                LEFT JOIN learner_operation lo_scorm_percent ON lo_scorm_percent.source = 'SLIDE' AND lo_scorm_percent.source_id = s.id AND lo_scorm_percent.user_id = :userId AND lo_scorm_percent.operation = 'PERCENTAGE_SCORM_COMPLETED'
                WHERE s.source_type = 'SCORM' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- AUDIO SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', COALESCE(CAST(lo_audio_marker.value AS bigint), NULL),
                        'percentage_completed', CASE
                            WHEN lo_audio_percent.value IS NULL OR lo_audio_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_audio_percent.value AS double precision)
                        END,
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
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN audio_slide a ON a.id = s.source_id
                LEFT JOIN learner_operation lo_audio_marker ON lo_audio_marker.source = 'SLIDE' AND lo_audio_marker.source_id = s.id AND lo_audio_marker.user_id = :userId AND lo_audio_marker.operation = 'AUDIO_LAST_TIMESTAMP'
                LEFT JOIN learner_operation lo_audio_percent ON lo_audio_percent.source = 'SLIDE' AND lo_audio_percent.source_id = s.id AND lo_audio_percent.user_id = :userId AND lo_audio_percent.operation = 'PERCENTAGE_AUDIO_LISTENED'
                WHERE s.source_type = 'AUDIO' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)

                UNION ALL

                -- ASSESSMENT SLIDES
                SELECT DISTINCT ON (cs.chapter_id, s.id)
                    s.created_at,
                    cs.slide_order,
                    cs.chapter_id,
                    json_build_object(
                        'id', s.id,
                        'title', COALESCE(eft_title.content, s.title),
                        'status', s.status,
                        'is_loaded', true,
                        'new_slide', true,
                        'source_id', s.source_id,
                        'description', COALESCE(eft_desc.content, s.description),
                        'slide_order', cs.slide_order,
                        'source_type', s.source_type,
                        'drip_condition', s.drip_condition_json,
                        'progress_marker', NULL,
                        'percentage_completed', CASE
                            WHEN lo_assessment_percent.value IS NULL OR lo_assessment_percent.value = 'null' THEN NULL
                            ELSE CAST(lo_assessment_percent.value AS double precision)
                        END,
                        'assessment_slide', json_build_object(
                            'id', asl.id,
                            'assessment_id', asl.assessment_id,
                            'allow_reattempt', asl.allow_reattempt,
                            'show_result', asl.show_result
                        )
                    ) AS slide_data
                FROM slide s
                JOIN chapter_to_slides cs ON cs.slide_id = s.id
                JOIN chapter c ON c.id = cs.chapter_id
                LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                JOIN assessment_slide asl ON asl.id = s.source_id
                LEFT JOIN learner_operation lo_assessment_percent ON lo_assessment_percent.source = 'SLIDE' AND lo_assessment_percent.source_id = s.id AND lo_assessment_percent.user_id = :userId AND lo_assessment_percent.operation = 'PERCENTAGE_ASSESSMENT_DONE'
                WHERE s.source_type = 'ASSESSMENT' AND c.id IN (SELECT cpsm.chapter_id FROM chapter_package_session_mapping cpsm JOIN chapter cpc ON cpc.id = cpsm.chapter_id WHERE cpsm.package_session_id = :packageSessionId AND cpsm.status = 'ACTIVE' AND cpc.status = 'ACTIVE')
                AND s.status IN (:slideStatus)
                AND cs.status IN (:chapterToSlidesStatus)
            ) AS slide_rows
                    GROUP BY chapter_id
                ) AS per_chapter
            """, nativeQuery = true)
    String getLearnerSlidesByPackageSessionId(
            @Param("packageSessionId") String packageSessionId,
            @Param("userId") String userId,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterToSlidesStatus") List<String> chapterToSlidesStatus,
            @Param("videoSlideQuestionStatus") List<String> videoSlideQuestionStatus,
            @Param("lang") String lang);

    @Query(value = """
            SELECT
                cpsm.created_at AS createdAt,
                c.id AS topChapterId,
                cpsm.package_session_id AS packageSessionId,
                sub.id AS subjectId
            FROM slide s
            JOIN chapter_to_slides cs ON cs.slide_id = s.id
            JOIN chapter c ON c.id = cs.chapter_id
            JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = c.id
            JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
            JOIN modules m ON m.id = mcm.module_id
            JOIN subject_module_mapping smm ON smm.module_id = m.id
            JOIN subject sub ON sub.id = smm.subject_id
            JOIN subject_session sps ON sps.subject_id = sub.id
            WHERE
                s.id = :slideId
                AND sub.status IN :subjectStatusList
                AND m.status IN :moduleStatusList
                AND c.status IN :chapterStatusList
                AND cpsm.status IN :chapterToSessionStatusList
                AND s.status IN :slideStatusList
                AND cs.status IN :slideStatusList
            LIMIT 1
            """, nativeQuery = true)
    Optional<SlideMetadataProjection> findSlideMetadataBySlideId(
            @Param("slideId") String slideId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("chapterToSessionStatusList") List<String> chapterToSessionStatusList,
            @Param("slideStatusList") List<String> slideStatusList);

    /**
     * Student report v2 "Marks by Subject": resolves a single slide's subject name
     * (nullable — a slide need not be mapped to a subject/chapter). Used by
     * SubjectMarksCollector to attach a subject hint to ASSIGNMENT graded items
     * (which are keyed only by slideId, unlike the QUESTION/QUIZ native queries
     * that resolve the subject inline). Collapses multi-subject mappings via LIMIT 1.
     */
    @Query(value = """
            SELECT sub.subject_name
            FROM slide s
            LEFT JOIN chapter_to_slides cs ON cs.slide_id = s.id
            LEFT JOIN chapter c ON c.id = cs.chapter_id
            LEFT JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
            LEFT JOIN modules m ON m.id = mcm.module_id
            LEFT JOIN subject_module_mapping smm ON smm.module_id = m.id
            LEFT JOIN subject sub ON sub.id = smm.subject_id
            WHERE s.id = :slideId
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findSubjectNameBySlideId(@Param("slideId") String slideId);

    @Query(value = """
            SELECT
                CASE
                    WHEN s.source_type = 'DOCUMENT' THEN COALESCE(ds.type, 'UNKNOWN_DOCUMENT_TYPE')
                    ELSE s.source_type
                END AS sourceType,

                COUNT(DISTINCT s.id) AS slideCount,

                SUM(
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120) -- 3 minutes per page, max 120 minutes
                                WHEN ds.type = 'PRESENTATION' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60) -- 2 minutes per page, max 60 minutes
                                ELSE 10 -- Default for other document types
                            END
                        WHEN s.source_type = 'QUESTION' THEN
                            5
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN :assignmentQuestionStatusList), 0) * 3
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN :questionStatusList), 0) * 2
                        ELSE 0
                    END
                ) AS readTimeInMinutes

            FROM slide s
            LEFT JOIN video vs
                ON vs.id = s.source_id AND s.source_type = 'VIDEO'
            LEFT JOIN html_video_slide hvs
                ON hvs.id = s.source_id AND s.source_type = 'HTML_VIDEO'
            LEFT JOIN document_slide ds
                ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'

            JOIN chapter_to_slides cs
                ON cs.slide_id = s.id
            JOIN chapter c
                ON c.id = cs.chapter_id
            JOIN module_chapter_mapping mcm
                ON mcm.chapter_id = c.id
            JOIN modules m
                ON m.id = mcm.module_id
            JOIN subject_module_mapping smm
                ON smm.module_id = m.id
            JOIN subject sub
                ON sub.id = smm.subject_id
            JOIN subject_session ss
                ON ss.subject_id = sub.id
            JOIN chapter_package_session_mapping cpsm
                ON cpsm.chapter_id = c.id

            WHERE
                ss.session_id = :sessionId
                AND cpsm.package_session_id = :sessionId
                AND sub.status IN :subjectStatusList
                AND m.status IN :moduleStatusList
                AND c.status IN :chapterStatusList
                AND cs.status IN :slideStatusList
                AND s.status IN :slideStatusList
                AND cpsm.status IN :chapterPackageStatusList

            GROUP BY
                CASE
                    WHEN s.source_type = 'DOCUMENT' THEN COALESCE(ds.type, 'UNKNOWN_DOCUMENT_TYPE')
                    ELSE s.source_type
                END
            """, nativeQuery = true)
    List<SlideTypeReadTimeProjection> getSlideReadTimeSummaryBySourceTypeForLearner(
            @Param("sessionId") String sessionId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList);

    @Query(value = """
            SELECT
                CASE
                    WHEN s.source_type = 'DOCUMENT' THEN COALESCE(ds.type, 'UNKNOWN_DOCUMENT_TYPE')
                    ELSE s.source_type
                END AS sourceType,

                COUNT(DISTINCT s.id) AS slideCount,

                SUM(
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            ROUND(COALESCE(vs.published_video_length, 0) / 60000.0, 2) -- Corrected ROUND function arguments
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 3, 120) -- Using ds.total_pages as fallback
                                WHEN ds.type = 'PRESENTATION' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages) * 2, 60) -- Added PRESENTATION type with its own logic, using ds.total_pages as fallback
                                ELSE 10 -- Default for other document types
                            END
                        WHEN s.source_type = 'QUESTION' THEN
                            5
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN :assignmentQuestionStatusList), 0) * 3
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN :questionStatusList), 0) * 2
                        ELSE 0
                    END
                ) AS readTimeInMinutes

            FROM slide s
            LEFT JOIN video vs
                ON vs.id = s.source_id AND s.source_type = 'VIDEO'
            LEFT JOIN html_video_slide hvs
                ON hvs.id = s.source_id AND s.source_type = 'HTML_VIDEO'
            LEFT JOIN document_slide ds
                ON ds.id = s.source_id AND s.source_type = 'DOCUMENT'

            JOIN chapter_to_slides cs
                ON cs.slide_id = s.id
            JOIN chapter c
                ON c.id = cs.chapter_id
            JOIN module_chapter_mapping mcm
                ON mcm.chapter_id = c.id
            JOIN modules m
                ON m.id = mcm.module_id
            JOIN subject_module_mapping smm
                ON smm.module_id = m.id
            JOIN subject sub
                ON sub.id = smm.subject_id
            JOIN subject_session ss
                ON ss.subject_id = sub.id
            JOIN chapter_package_session_mapping cpsm
                ON cpsm.chapter_id = c.id

            WHERE
                ss.session_id = :sessionId
                AND cpsm.package_session_id = :sessionId
                AND sub.status IN :subjectStatusList
                AND m.status IN :moduleStatusList
                AND c.status IN :chapterStatusList
                AND cs.status IN :slideStatusList
                AND s.status IN :slideStatusList
                AND cpsm.status IN :chapterPackageStatusList

            GROUP BY
                CASE
                    WHEN s.source_type = 'DOCUMENT' THEN COALESCE(ds.type, 'UNKNOWN_DOCUMENT_TYPE')
                    ELSE s.source_type
                END
            """, nativeQuery = true)
    List<SlideTypeReadTimeProjection> getSlideReadTimeSummaryBySourceType(
            @Param("sessionId") String sessionId,
            @Param("subjectStatusList") List<String> subjectStatusList,
            @Param("moduleStatusList") List<String> moduleStatusList,
            @Param("chapterStatusList") List<String> chapterStatusList,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("chapterPackageStatusList") List<String> chapterPackageStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("questionStatusList") List<String> questionStatusList);

    @Query(value = """
                SELECT json_agg(slide_data ORDER BY slide_order IS NOT NULL, slide_order, created_at DESC) AS slides
                FROM (
                    -- VIDEO SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'video_slide', json_build_object(
                                'id', v.id,
                                'url', v.url,
                                'title', v.title,
                                'description', v.description,
                                'source_type', v.source_type,
                                'published_url', v.published_url,
                                'video_length_in_millis', v.video_length,
                                'published_video_length_in_millis', v.published_video_length,
                                'embedded_type', v.embedded_type,
                                'embedded_data', v.embedded_data,
                                'questions', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', q.id,
                                            'can_skip', q.can_skip,
                                            'question_response_type', q.question_response_type,
                                            'question_type', q.question_type,
                                            'access_level', q.access_level,
                                            'question_order', q.question_order,
                                            'question_time_in_millis', q.question_time_in_millis,
                                            'media_id', q.media_id,
                                            'auto_evaluation_json', q.auto_evaluation_json,
                                            'evaluation_type', q.evaluation_type,
                                            'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                            'options', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', o.id,
                                                        'media_id', o.media_id,
                                                        'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                                        'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                                    )
                                                )
                                                FROM video_slide_question_options o
                                                LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                                LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                                WHERE o.video_slide_question_id = q.id
                                            ), CAST('[]' AS json))
                                        )
                                        ORDER BY q.question_order
                                    )
                                    FROM video_slide_question q
                                    LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                                    LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                                    LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                                    LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                                    WHERE q.video_slide_id = v.id AND q.status IN (:videoSlideQuestionStatus)
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN video v ON v.id = s.source_id
                    WHERE s.source_type = 'VIDEO' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- DOCUMENT SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'document_slide', json_build_object(
                                'id', d.id,
                                'title', d.title,
                                'type', d.type,
                                'cover_file_id', d.cover_file_id,
                                -- Publishing before the 2026-07-08 save-lifecycle fix nulled the
                                -- draft columns, so ~6.5k legacy rows hold their content only in
                                -- published_*. Fall back so no reader ever sees a null document.
                                'total_pages', COALESCE(d.total_pages, d.published_document_total_pages),
                                'published_document_total_pages', d.published_document_total_pages,
                                'data', COALESCE(d.data, d.published_data),
                                'published_data', d.published_data
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN document_slide d ON d.id = s.source_id
                    WHERE s.source_type = 'DOCUMENT' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- QUESTION SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'question_slide', json_build_object(
                                'id', q.id,
                                'question_type', q.question_type,
                                'question_response_type', q.question_response_type,
                                'access_level', q.access_level,
                                'default_question_time_mins', q.default_question_time_mins,
                                'points', q.points,
                                're_attempt_count', q.re_attempt_count,
                                'auto_evaluation_json', q.auto_evaluation_json,
                                'evaluation_type', q.evaluation_type,
                                'media_id', q.media_id,
                                'source_type', q.source_type,
                                'text_data', json_build_object('id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)),
                                'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)) ELSE NULL END,
                                'explanation_text_data', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_exp.id, 'type', rt_exp.type, 'content', COALESCE(rtt_exp.content, rt_exp.content)) ELSE NULL END,
                                'options', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', o.id,
                                            'media_id', o.media_id,
                                            'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', rt_opt.id, 'type', rt_opt.type, 'content', COALESCE(rtt_opt.content, rt_opt.content)) ELSE NULL END,
                                            'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', rt_opt_exp.id, 'type', rt_opt_exp.type, 'content', COALESCE(rtt_opt_exp.content, rt_opt_exp.content)) ELSE NULL END
                                        )
                                        ORDER BY o.created_on
                                    )
                                    FROM option o
                                    LEFT JOIN rich_text_data rt_opt ON rt_opt.id = o.text_id
                                    LEFT JOIN rich_text_translation rtt_opt ON rtt_opt.rich_text_id = rt_opt.id AND rtt_opt.locale = :lang AND rtt_opt.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data rt_opt_exp ON rt_opt_exp.id = o.explanation_text_id
                                    LEFT JOIN rich_text_translation rtt_opt_exp ON rtt_opt_exp.rich_text_id = rt_opt_exp.id AND rtt_opt_exp.locale = :lang AND rtt_opt_exp.state IN ('PUBLISHED','STALE')
                                    WHERE o.question_id = q.id
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN question_slide q ON q.id = s.source_id
                    LEFT JOIN rich_text_data rt_text ON rt_text.id = q.text_id
                    LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                    LEFT JOIN rich_text_data rt_parent ON rt_parent.id = q.parent_rich_text_id
                    LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                    LEFT JOIN rich_text_data rt_exp ON rt_exp.id = q.explanation_text_id
                    LEFT JOIN rich_text_translation rtt_exp ON rtt_exp.rich_text_id = rt_exp.id AND rtt_exp.locale = :lang AND rtt_exp.state IN ('PUBLISHED','STALE')
                    WHERE s.source_type = 'QUESTION' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- ASSIGNMENT SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'assignment_slide', json_build_object(
                                'id', a.id,
                                'live_date', a.live_date,
                                'end_date', a.end_date,
                                'comma_separated_media_ids', a.comma_separated_media_ids,
                                're_attempt_count', a.re_attempt_count,
                                'text_data', CASE
                                    WHEN a.text_id IS NOT NULL THEN json_build_object(
                                        'id', rt_text.id, 'type', rt_text.type, 'content', COALESCE(rtt_text.content, rt_text.content)
                                    ) ELSE NULL
                                END,
                                'parent_rich_text', CASE
                                    WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object(
                                        'id', rt_parent.id, 'type', rt_parent.type, 'content', COALESCE(rtt_parent.content, rt_parent.content)
                                    ) ELSE NULL
                                END,
                                'questions', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', q.id,
                                            'question_order', q.question_order,
                                            'status', q.status,
                                            'text_data', CASE
                                                WHEN q.text_id IS NOT NULL THEN json_build_object(
                                                    'id', rtq.id, 'type', rtq.type, 'content', COALESCE(rtt_rtq.content, rtq.content)
                                                ) ELSE NULL
                                            END
                                        )
                                        ORDER BY q.question_order
                                    )
                                    FROM assignment_slide_question q
                                    LEFT JOIN rich_text_data rtq ON rtq.id = q.text_id
                                    LEFT JOIN rich_text_translation rtt_rtq ON rtt_rtq.rich_text_id = rtq.id AND rtt_rtq.locale = :lang AND rtt_rtq.state IN ('PUBLISHED','STALE')
                                    WHERE q.assignment_slide_id = a.id AND q.status IN (:videoSlideQuestionStatus)
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN assignment_slide a ON a.id = s.source_id
                    LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                    LEFT JOIN rich_text_translation rtt_text ON rtt_text.rich_text_id = rt_text.id AND rtt_text.locale = :lang AND rtt_text.state IN ('PUBLISHED','STALE')
                    LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                    LEFT JOIN rich_text_translation rtt_parent ON rtt_parent.rich_text_id = rt_parent.id AND rtt_parent.locale = :lang AND rtt_parent.state IN ('PUBLISHED','STALE')
                    WHERE s.source_type = 'ASSIGNMENT' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- QUIZ SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL, -- Assuming no specific marker for quizzes, adjust if needed
                            'percentage_completed', NULL, -- Assuming no specific percentage completed for quizzes, adjust if needed
                            'quiz_slide', json_build_object(
                                'id', qs.id,
                                'title', qs.title,
                                'description', CASE WHEN qs_description_rt.id IS NOT NULL THEN json_build_object('id', qs_description_rt.id, 'type', qs_description_rt.type, 'content', COALESCE(rtt_qs_desc.content, qs_description_rt.content)) ELSE NULL END,
                                'time_limit_in_minutes', qs.time_limit_in_minutes,
                                'marks_per_question', qs.marks_per_question,
                                'negative_marking', qs.negative_marking,
                                'pass_percentage', qs.pass_percentage,
                                'partial_marking', qs.partial_marking,
                                're_attempt_count', qs.re_attempt_count,
                                'questions', COALESCE((
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', q.id,
                                            'question_response_type', q.question_response_type,
                                            'question_type', q.question_type,
                                            'access_level', q.access_level,
                                            'question_order', q.question_order,
                                            'status', q.status,
                                            'media_id', q.media_id,
                                            'can_skip', q.can_skip,
                                            'auto_evaluation_json', q.auto_evaluation_json,
                                            'evaluation_type', q.evaluation_type,
                                            'marks', q.marks,
                                            'negative_marking', q.negative_marking,
                                            'text', json_build_object('id', q_text_rt.id, 'type', q_text_rt.type, 'content', COALESCE(rtt_q_text.content, q_text_rt.content)),
                                            'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', q_parent_rt.id, 'type', q_parent_rt.type, 'content', COALESCE(rtt_q_parent.content, q_parent_rt.content)) ELSE NULL END,
                                            'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', q_exp_rt.id, 'type', q_exp_rt.type, 'content', COALESCE(rtt_q_exp.content, q_exp_rt.content)) ELSE NULL END,
                                            'options', COALESCE((
                                                SELECT json_agg(
                                                    json_build_object(
                                                        'id', o.id,
                                                        'media_id', o.media_id,
                                                        'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', o_text_rt.id, 'type', o_text_rt.type, 'content', COALESCE(rtt_o_text.content, o_text_rt.content)) ELSE NULL END,
                                                        'explanation_text_data', CASE WHEN o.explanation_text_id IS NOT NULL THEN json_build_object('id', o_exp_rt.id, 'type', o_exp_rt.type, 'content', COALESCE(rtt_o_exp.content, o_exp_rt.content)) ELSE NULL END
                                                    )
                                                )
                                                FROM quiz_slide_question_options o
                                                LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                                                LEFT JOIN rich_text_translation rtt_o_text ON rtt_o_text.rich_text_id = o_text_rt.id AND rtt_o_text.locale = :lang AND rtt_o_text.state IN ('PUBLISHED','STALE')
                                                LEFT JOIN rich_text_data o_exp_rt ON o_exp_rt.id = o.explanation_text_id
                                                LEFT JOIN rich_text_translation rtt_o_exp ON rtt_o_exp.rich_text_id = o_exp_rt.id AND rtt_o_exp.locale = :lang AND rtt_o_exp.state IN ('PUBLISHED','STALE')
                                                WHERE o.quiz_slide_question_id = q.id
                                            ), CAST('[]' AS json))
                                        )
                                        ORDER BY q.question_order
                                    )
                                    FROM quiz_slide_question q
                                    LEFT JOIN rich_text_data q_text_rt ON q_text_rt.id = q.text_id
                                    LEFT JOIN rich_text_translation rtt_q_text ON rtt_q_text.rich_text_id = q_text_rt.id AND rtt_q_text.locale = :lang AND rtt_q_text.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data q_parent_rt ON q_parent_rt.id = q.parent_rich_text_id
                                    LEFT JOIN rich_text_translation rtt_q_parent ON rtt_q_parent.rich_text_id = q_parent_rt.id AND rtt_q_parent.locale = :lang AND rtt_q_parent.state IN ('PUBLISHED','STALE')
                                    LEFT JOIN rich_text_data q_exp_rt ON q_exp_rt.id = q.explanation_text_id
                                    LEFT JOIN rich_text_translation rtt_q_exp ON rtt_q_exp.rich_text_id = q_exp_rt.id AND rtt_q_exp.locale = :lang AND rtt_q_exp.state IN ('PUBLISHED','STALE')
                                    WHERE q.quiz_slide_id = qs.id
                                    AND q.status IN (:videoSlideQuestionStatus)
                                ), CAST('[]' AS json))
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN quiz_slide qs ON qs.id = s.source_id
                    LEFT JOIN rich_text_data qs_description_rt ON qs_description_rt.id = qs.description
                    LEFT JOIN rich_text_translation rtt_qs_desc ON rtt_qs_desc.rich_text_id = qs_description_rt.id AND rtt_qs_desc.locale = :lang AND rtt_qs_desc.state IN ('PUBLISHED','STALE')
                    WHERE s.source_type = 'QUIZ' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- HTML VIDEO SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'html_video_slide', json_build_object(
                                'id', h.id,
                                'url', h.url,
                                'video_length_in_millis', h.video_length,
                                'ai_gen_video_id', h.ai_gen_video_id,
                                'code_editor_config', CASE WHEN h.code_editor_config IS NULL THEN NULL ELSE CAST(h.code_editor_config AS TEXT) END
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN html_video_slide h ON h.id = s.source_id
                    WHERE s.source_type = 'HTML_VIDEO' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- SCORM SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'scorm_slide', json_build_object(
                                'id', sc.id,
                                'launch_path', sc.launch_path,
                                'launch_url', sc.launch_url,
                                'scorm_version', sc.scorm_version,
                                'original_file_id', sc.original_file_id
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN scorm_slide sc ON sc.id = s.source_id
                    WHERE s.source_type = 'SCORM' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- AUDIO SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
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
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN audio_slide a ON a.id = s.source_id
                    WHERE s.source_type = 'AUDIO' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)

                    UNION ALL

                    -- ASSESSMENT SLIDES
                    SELECT DISTINCT ON (s.id)
                        s.created_at,
                        cs.slide_order,
                        json_build_object(
                            'id', s.id,
                            'title', COALESCE(eft_title.content, s.title),
                            'status', s.status,
                            'is_loaded', true,
                            'new_slide', true,
                            'source_id', s.source_id,
                            'description', COALESCE(eft_desc.content, s.description),
                            'slide_order', cs.slide_order,
                            'source_type', s.source_type,
                            'drip_condition', s.drip_condition_json,
                            'progress_marker', NULL,
                            'percentage_completed', NULL,
                            'assessment_slide', json_build_object(
                                'id', asl.id,
                                'assessment_id', asl.assessment_id,
                                'allow_reattempt', asl.allow_reattempt,
                                'show_result', asl.show_result
                            )
                        ) AS slide_data
                    FROM slide s
                    JOIN chapter_to_slides cs ON cs.slide_id = s.id
                    JOIN chapter c ON c.id = cs.chapter_id
                    LEFT JOIN entity_field_translation eft_title ON eft_title.entity_type = 'SLIDE' AND eft_title.entity_id = s.id AND eft_title.field = 'title' AND eft_title.locale = :lang AND eft_title.state IN ('PUBLISHED','STALE')
                    LEFT JOIN entity_field_translation eft_desc ON eft_desc.entity_type = 'SLIDE' AND eft_desc.entity_id = s.id AND eft_desc.field = 'description' AND eft_desc.locale = :lang AND eft_desc.state IN ('PUBLISHED','STALE')
                    JOIN assessment_slide asl ON asl.id = s.source_id
                    WHERE s.source_type = 'ASSESSMENT' AND c.id = :chapterId
                    AND s.status IN (:slideStatus)
                    AND cs.status IN (:chapterToSlidesStatus)
                ) AS slide_data
            """, nativeQuery = true)
    String getSlidesByChapterIdOpen(
            @Param("chapterId") String chapterId,
            @Param("slideStatus") List<String> slideStatus,
            @Param("chapterToSlidesStatus") List<String> chapterToSlidesStatus,
            @Param("videoSlideQuestionStatus") List<String> videoSlideQuestionStatus,
            @Param("lang") String lang);

    @Query(value = """
            -- Main query to calculate the total read time
            SELECT
                -- Use COALESCE to ensure the result is 0 if no slides are found, instead of NULL
                COALESCE(SUM(
                    CASE
                        -- 1. For VIDEO slides
                        WHEN s.source_type = 'VIDEO' THEN
                            -- CORRECTED this line: vs.video_length -> vs.video_length
                            ROUND(COALESCE(vs.published_video_length, vs.video_length, 0) / 60000.0, 2)

                        -- 1.5 For HTML_VIDEO slides
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)

                        -- 1.6 For SCORM slides (default 15 mins)
                        WHEN s.source_type = 'SCORM' THEN
                            15.0

                        -- 2. For DOCUMENT slides (PDF, PRESENTATION, etc.)
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    -- 3 minutes per page, with a maximum of 120 minutes
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 3, 120)
                                WHEN ds.type = 'PRESENTATION' THEN
                                    -- 2 minutes per page, with a maximum of 60 minutes
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 2, 60)
                                ELSE
                                    -- Default time for any other document type
                                    10
                            END

                        -- 3. For QUESTION slides
                        WHEN s.source_type = 'QUESTION' THEN
                            5

                        -- 4. For ASSIGNMENT slides (time based on question count from CTE)
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)), 0) * 3

                        -- 5. For QUIZ slides (time based on question count from CTE)
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:quizQuestionStatusList)), 0) * 2

                        -- 6. Default case for any other slide type
                        ELSE 0
                    END
                ), 0)
            FROM
                package_session ps
            JOIN
                chapter_package_session_mapping cpsm ON cpsm.package_session_id = ps.id
            JOIN
                chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id
            JOIN
                slide s ON s.id = cts.slide_id
            LEFT JOIN
                video vs ON s.source_id = vs.id AND s.source_type = 'VIDEO'
            LEFT JOIN
                document_slide ds ON s.source_id = ds.id AND s.source_type = 'DOCUMENT'
            LEFT JOIN
                html_video_slide hvs ON s.source_id = hvs.id AND s.source_type = 'HTML_VIDEO'
            WHERE
                ps.package_id = :packageId
                AND ps.session_id = :sessionId
                AND ps.level_id = :levelId
                AND s.status IN (:slideStatusList)
                AND cts.status IN (:slideStatusList)
            """, nativeQuery = true)
    Double calculateTotalReadTimeInMinutes(
            @Param("packageId") String packageId,
            @Param("sessionId") String sessionId,
            @Param("levelId") String levelId,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("quizQuestionStatusList") List<String> quizQuestionStatusList);

    /**
     * Batched form of {@link #calculateTotalReadTimeInMinutes}: one row per
     * (package, session, level) triple instead of one query per triple.
     *
     * <p>The aggregate expression, joins and status predicates are character-for-character
     * the single-key query; only the WHERE moves from three equality checks to three IN
     * lists and a GROUP BY is added. A caller passing the three id sets therefore gets the
     * same number for a given triple as it would have got from the single-key call.
     *
     * <p>Two differences the caller must handle. The IN lists form a cross product, so this
     * returns rows for triples that exist in package_session but were never asked about --
     * callers must keep only the triples they care about. And GROUP BY emits nothing for a
     * triple with no matching slides, where the single-key query returned 0.0 from its
     * COALESCE over an empty aggregate -- callers must default missing triples to 0.0.
     */
    @Query(value = """
            SELECT
                ps.package_id AS "packageId",
                ps.session_id AS "sessionId",
                ps.level_id   AS "levelId",
                COALESCE(SUM(
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            ROUND(COALESCE(vs.published_video_length, vs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'SCORM' THEN
                            15.0
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 3, 120)
                                WHEN ds.type = 'PRESENTATION' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 2, 60)
                                ELSE
                                    10
                            END
                        WHEN s.source_type = 'QUESTION' THEN
                            5
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)), 0) * 3
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:quizQuestionStatusList)), 0) * 2
                        ELSE 0
                    END
                ), 0) AS "readTimeInMinutes"
            FROM
                package_session ps
            JOIN
                chapter_package_session_mapping cpsm ON cpsm.package_session_id = ps.id
            JOIN
                chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id
            JOIN
                slide s ON s.id = cts.slide_id
            LEFT JOIN
                video vs ON s.source_id = vs.id AND s.source_type = 'VIDEO'
            LEFT JOIN
                document_slide ds ON s.source_id = ds.id AND s.source_type = 'DOCUMENT'
            LEFT JOIN
                html_video_slide hvs ON s.source_id = hvs.id AND s.source_type = 'HTML_VIDEO'
            WHERE
                ps.package_id IN (:packageIds)
                AND ps.session_id IN (:sessionIds)
                AND ps.level_id IN (:levelIds)
                AND s.status IN (:slideStatusList)
                AND cts.status IN (:slideStatusList)
            GROUP BY
                ps.package_id, ps.session_id, ps.level_id
            """, nativeQuery = true)
    List<vacademy.io.admin_core_service.features.slide.dto.LevelReadTimeProjection> calculateTotalReadTimeInMinutesBatch(
            @Param("packageIds") List<String> packageIds,
            @Param("sessionIds") List<String> sessionIds,
            @Param("levelIds") List<String> levelIds,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("quizQuestionStatusList") List<String> quizQuestionStatusList);


    @Query(value = """
            -- Main query to calculate the total read time
            SELECT
                COALESCE(SUM(
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            ROUND(COALESCE(vs.published_video_length, vs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'SCORM' THEN
                            15.0
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 3, 120)
                                WHEN ds.type = 'PRESENTATION' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 2, 60)
                                ELSE
                                    10
                            END
                        WHEN s.source_type = 'QUESTION' THEN
                            5
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)), 0) * 3
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:quizQuestionStatusList)), 0) * 2
                        ELSE 0
                    END
                ), 0)
            FROM
                package_session ps
            JOIN
                chapter_package_session_mapping cpsm ON cpsm.package_session_id = ps.id
            JOIN
                chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id
            JOIN
                slide s ON s.id = cts.slide_id
            LEFT JOIN
                video vs ON s.source_id = vs.id AND s.source_type = 'VIDEO'
            LEFT JOIN
                document_slide ds ON s.source_id = ds.id AND s.source_type = 'DOCUMENT'
            LEFT JOIN
                html_video_slide hvs ON s.source_id = hvs.id AND s.source_type = 'HTML_VIDEO'
            WHERE
                ps.id = :packageSessionId
                AND s.status IN (:slideStatusList)
                AND cts.status IN (:slideStatusList)
            """, nativeQuery = true)
    Double calculateTotalReadTimeInMinutes(
            @Param("packageSessionId") String packageSessionId,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("quizQuestionStatusList") List<String> quizQuestionStatusList);

    /**
     * Batch query to calculate read times for multiple package sessions at once.
     * This eliminates the N+1 query problem when fetching read times for multiple
     * sessions.
     */
    @Query(value = """
            -- Main query to calculate read time per package session
            SELECT
                ps.id AS packageSessionId,
                COALESCE(SUM(
                    CASE
                        WHEN s.source_type = 'VIDEO' THEN
                            ROUND(COALESCE(vs.published_video_length, vs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'HTML_VIDEO' THEN
                            ROUND(COALESCE(hvs.video_length, 0) / 60000.0, 2)
                        WHEN s.source_type = 'SCORM' THEN
                            15.0
                        WHEN s.source_type = 'DOCUMENT' THEN
                            CASE
                                WHEN ds.type = 'PDF' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 3, 120)
                                WHEN ds.type = 'PRESENTATION' THEN
                                    LEAST(COALESCE(ds.published_document_total_pages, ds.total_pages, 0) * 2, 60)
                                ELSE
                                    10
                            END
                        WHEN s.source_type = 'QUESTION' THEN
                            5
                        WHEN s.source_type = 'ASSIGNMENT' THEN
                            COALESCE((SELECT COUNT(*) FROM assignment_slide_question asq WHERE asq.assignment_slide_id = s.source_id AND asq.status IN (:assignmentQuestionStatusList)), 0) * 3
                        WHEN s.source_type = 'QUIZ' THEN
                            COALESCE((SELECT COUNT(*) FROM quiz_slide_question qsq WHERE qsq.quiz_slide_id = s.source_id AND qsq.status IN (:quizQuestionStatusList)), 0) * 2
                        ELSE 0
                    END
                ), 0) AS readTimeInMinutes
            FROM
                package_session ps
            JOIN
                chapter_package_session_mapping cpsm ON cpsm.package_session_id = ps.id
            JOIN
                chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id
            JOIN
                slide s ON s.id = cts.slide_id
            LEFT JOIN
                video vs ON s.source_id = vs.id AND s.source_type = 'VIDEO'
            LEFT JOIN
                document_slide ds ON s.source_id = ds.id AND s.source_type = 'DOCUMENT'
            LEFT JOIN
                html_video_slide hvs ON s.source_id = hvs.id AND s.source_type = 'HTML_VIDEO'
            WHERE
                ps.id IN (:packageSessionIds)
                AND s.status IN (:slideStatusList)
                AND cts.status IN (:slideStatusList)
            GROUP BY
                ps.id
            """, nativeQuery = true)
    List<PackageSessionReadTimeProjection> calculateReadTimesForPackageSessions(
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("slideStatusList") List<String> slideStatusList,
            @Param("assignmentQuestionStatusList") List<String> assignmentQuestionStatusList,
            @Param("quizQuestionStatusList") List<String> quizQuestionStatusList);

    @Query(value = """
            SELECT json_agg(slide_data) AS slides FROM (
                SELECT json_build_object(
                    'id', s.id,
                    'title', s.title,
                    'status', s.status,
                    'is_loaded', true,
                    'new_slide', false,
                    'source_id', s.source_id,
                    'description', s.description,
                    'slide_order', 0,
                    'source_type', s.source_type,
                    'assignment_slide', CASE WHEN s.source_type = 'ASSIGNMENT' THEN (
                        SELECT json_build_object(
                            'id', a.id,
                            'live_date', a.live_date,
                            'end_date', a.end_date,
                            'comma_separated_media_ids', a.comma_separated_media_ids,
                            're_attempt_count', a.re_attempt_count,
                            'total_marks', a.total_marks,
                            'passing_marks', a.passing_marks,
                            'text_data', CASE WHEN a.text_id IS NOT NULL THEN json_build_object(
                                'id', rt_text.id, 'type', rt_text.type, 'content', rt_text.content
                            ) ELSE NULL END,
                            'parent_rich_text', CASE WHEN a.parent_rich_text_id IS NOT NULL THEN json_build_object(
                                'id', rt_parent.id, 'type', rt_parent.type, 'content', rt_parent.content
                            ) ELSE NULL END,
                            'questions', COALESCE((
                                SELECT json_agg(json_build_object(
                                    'id', q.id,
                                    'question_order', q.question_order,
                                    'status', q.status,
                                    'question_type', q.question_type,
                                    'text_data', CASE WHEN q.text_id IS NOT NULL THEN json_build_object(
                                        'id', rtq.id, 'type', rtq.type, 'content', rtq.content
                                    ) ELSE NULL END,
                                    'options', COALESCE((
                                        SELECT json_agg(json_build_object(
                                            'id', o.id,
                                            'text', json_build_object('id', rto.id, 'type', rto.type, 'content', rto.content)
                                        ) ORDER BY o.id)
                                        FROM assignment_slide_question_options o
                                        LEFT JOIN rich_text_data rto ON rto.id = o.text_id
                                        WHERE o.assignment_slide_question_id = q.id
                                    ), CAST('[]' AS json))
                                ) ORDER BY q.question_order)
                                FROM assignment_slide_question q
                                LEFT JOIN rich_text_data rtq ON rtq.id = q.text_id
                                WHERE q.assignment_slide_id = a.id AND q.status IN (:questionStatus)
                            ), CAST('[]' AS json))
                        )
                        FROM assignment_slide a
                        LEFT JOIN rich_text_data rt_text ON rt_text.id = a.text_id
                        LEFT JOIN rich_text_data rt_parent ON rt_parent.id = a.parent_rich_text_id
                        WHERE a.id = s.source_id
                    ) ELSE NULL END,
                    'quiz_slide', CASE WHEN s.source_type = 'QUIZ' THEN (
                        SELECT json_build_object(
                            'id', qs.id,
                            'title', qs.title,
                            'description', CASE WHEN qs_description_rt.id IS NOT NULL THEN json_build_object('id', qs_description_rt.id, 'type', qs_description_rt.type, 'content', qs_description_rt.content) ELSE NULL END,
                            'time_limit_in_minutes', qs.time_limit_in_minutes,
                            'marks_per_question', qs.marks_per_question,
                            'negative_marking', qs.negative_marking,
                            'pass_percentage', qs.pass_percentage,
                            'partial_marking', qs.partial_marking,
                            're_attempt_count', qs.re_attempt_count,
                            'questions', COALESCE((
                                SELECT json_agg(
                                    json_build_object(
                                        'id', q.id,
                                        'question_response_type', q.question_response_type,
                                        'question_type', q.question_type,
                                        'access_level', q.access_level,
                                        'question_order', q.question_order,
                                        'status', q.status,
                                        'media_id', q.media_id,
                                        'can_skip', q.can_skip,
                                        'auto_evaluation_json', q.auto_evaluation_json,
                                        'evaluation_type', q.evaluation_type,
                                        'marks', q.marks,
                                        'negative_marking', q.negative_marking,
                                        'text', CASE WHEN q.text_id IS NOT NULL THEN json_build_object('id', q_text_rt.id, 'type', q_text_rt.type, 'content', q_text_rt.content) ELSE NULL END,
                                        'parent_rich_text', CASE WHEN q.parent_rich_text_id IS NOT NULL THEN json_build_object('id', q_parent_rt.id, 'type', q_parent_rt.type, 'content', q_parent_rt.content) ELSE NULL END,
                                        'explanation_text', CASE WHEN q.explanation_text_id IS NOT NULL THEN json_build_object('id', q_exp_rt.id, 'type', q_exp_rt.type, 'content', q_exp_rt.content) ELSE NULL END,
                                        'options', COALESCE((
                                            SELECT json_agg(
                                                json_build_object(
                                                    'id', o.id,
                                                    'media_id', o.media_id,
                                                    'text', CASE WHEN o.text_id IS NOT NULL THEN json_build_object('id', o_text_rt.id, 'type', o_text_rt.type, 'content', o_text_rt.content) ELSE NULL END
                                                )
                                            )
                                            FROM quiz_slide_question_options o
                                            LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                                            WHERE o.quiz_slide_question_id = q.id
                                        ), CAST('[]' AS json))
                                    )
                                    ORDER BY q.question_order
                                )
                                FROM quiz_slide_question q
                                LEFT JOIN rich_text_data q_text_rt ON q_text_rt.id = q.text_id
                                LEFT JOIN rich_text_data q_parent_rt ON q_parent_rt.id = q.parent_rich_text_id
                                LEFT JOIN rich_text_data q_exp_rt ON q_exp_rt.id = q.explanation_text_id
                                WHERE q.quiz_slide_id = qs.id
                                AND q.status IN (:questionStatus)
                            ), CAST('[]' AS json))
                        )
                        FROM quiz_slide qs
                        LEFT JOIN rich_text_data qs_description_rt ON qs_description_rt.id = qs.description
                        WHERE qs.id = s.source_id
                    ) ELSE NULL END
                ) AS slide_data
                FROM slide s
                WHERE s.id = :slideId
            ) AS result
            """, nativeQuery = true)
    String getSlideBySlideId(
            @Param("slideId") String slideId,
            @Param("questionStatus") List<String> questionStatus);

    /**
     * Live assessment slides backed by any of the given assessment_slide rows.
     * Used to cascade an assessment deletion into the course slides that launch
     * it, so a deleted assessment can't leave a dead slide behind.
     */
    @Query("""
                SELECT s FROM Slide s
                WHERE s.sourceType = 'ASSESSMENT'
                AND s.sourceId IN (:sourceIds)
                AND s.status <> 'DELETED'
            """)
    List<Slide> findActiveAssessmentSlidesBySourceIds(@Param("sourceIds") List<String> sourceIds);

}
