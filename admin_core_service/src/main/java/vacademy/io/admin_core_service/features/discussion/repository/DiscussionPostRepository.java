package vacademy.io.admin_core_service.features.discussion.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionPost;

import java.util.List;
import java.util.Optional;

public interface DiscussionPostRepository extends JpaRepository<DiscussionPost, String> {

    /** A batch's view: its own posts plus teacher posts addressed to every batch (NULL). */
    @Query(value = """
            SELECT * FROM discussion_post
            WHERE slide_id = :slideId
              AND (package_session_id = :packageSessionId OR package_session_id IS NULL)
              AND status <> 'DELETED'
            ORDER BY created_at
            """, nativeQuery = true)
    List<DiscussionPost> findForBatch(@Param("slideId") String slideId,
            @Param("packageSessionId") String packageSessionId);

    /** Every live post on the slide inside one institute, for the teacher's view. */
    @Query(value = """
            SELECT * FROM discussion_post
            WHERE slide_id = :slideId
              AND institute_id = :instituteId
              AND status <> 'DELETED'
            ORDER BY created_at
            """, nativeQuery = true)
    List<DiscussionPost> findForInstitute(@Param("slideId") String slideId, @Param("instituteId") String instituteId);

    @Query(value = """
            SELECT COUNT(*) > 0 FROM discussion_post
            WHERE slide_id = :slideId
              AND user_id = :userId
              AND parent_id IS NULL
              AND status <> 'DELETED'
            """, nativeQuery = true)
    boolean hasResponded(@Param("slideId") String slideId, @Param("userId") String userId);

    @Modifying
    @Query(value = "UPDATE discussion_post SET report_count = report_count + 1 WHERE id = :postId", nativeQuery = true)
    int incrementReportCount(@Param("postId") String postId);

    /** The slide row and its document, for a discussion slide. */
    interface SlideDocumentRow {
        String getSlideId();

        String getSlideStatus();

        String getSourceType();

        String getDocumentType();

        String getData();

        String getPublishedData();
    }

    @Query(value = """
            SELECT s.id AS slideId,
                   s.status AS slideStatus,
                   s.source_type AS sourceType,
                   d.type AS documentType,
                   d.data AS data,
                   d.published_data AS publishedData
            FROM slide s
            LEFT JOIN document_slide d ON d.id = s.source_id
            WHERE s.id = :slideId
            """, nativeQuery = true)
    Optional<SlideDocumentRow> findSlideDocument(@Param("slideId") String slideId);

    interface BatchRow {
        String getPackageSessionId();

        String getPackageName();

        String getLevelName();

        String getSessionName();
    }

    /** The batches of this institute whose courses include the slide, with display names. */
    @Query(value = """
            SELECT DISTINCT ps.id AS packageSessionId,
                   p.package_name AS packageName,
                   l.level_name AS levelName,
                   s.session_name AS sessionName
            FROM chapter_to_slides cts
            JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = cts.chapter_id
            JOIN package_session ps ON ps.id = cpsm.package_session_id
            JOIN package p ON p.id = ps.package_id
            JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = :instituteId
            LEFT JOIN level l ON l.id = ps.level_id
            LEFT JOIN session s ON s.id = ps.session_id
            WHERE cts.slide_id = :slideId
              AND cts.status <> 'DELETED'
              AND cpsm.status <> 'DELETED'
            """, nativeQuery = true)
    List<BatchRow> findBatchesOfSlide(@Param("slideId") String slideId, @Param("instituteId") String instituteId);
}
