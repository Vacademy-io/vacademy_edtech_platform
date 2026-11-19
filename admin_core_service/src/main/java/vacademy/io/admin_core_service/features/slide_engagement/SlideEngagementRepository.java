package vacademy.io.admin_core_service.features.slide_engagement;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SlideEngagementRepository extends JpaRepository<SlideEngagement, String> {

    /** The slide and what kind it is; documentType is null for non-document slides. */
    interface SlideKindRow {
        String getSlideId();

        String getTitle();

        String getStatus();

        String getSourceType();

        String getDocumentType();
    }

    @Query(value = """
            SELECT s.id AS slideId,
                   s.title AS title,
                   s.status AS status,
                   s.source_type AS sourceType,
                   d.type AS documentType
            FROM slide s
            LEFT JOIN document_slide d ON d.id = s.source_id AND s.source_type = 'DOCUMENT'
            WHERE s.id = :slideId
            """, nativeQuery = true)
    Optional<SlideKindRow> findSlideKind(@Param("slideId") String slideId);

    interface OperationRow {
        String getOperation();

        String getValue();
    }

    /** The learner's completion rows for this slide (percentages and the manual tick). */
    @Query(value = """
            SELECT lo.operation AS operation, lo.value AS value
            FROM learner_operation lo
            WHERE lo.source = 'SLIDE'
              AND lo.source_id = :slideId
              AND lo.user_id = :userId
              AND lo.operation IN ('MARKED_AS_WATCHED', 'PERCENTAGE_DOCUMENT_COMPLETED',
                                   'PERCENTAGE_QUESTION_COMPLETED', 'PERCENTAGE_QUIZ_COMPLETED')
            """, nativeQuery = true)
    List<OperationRow> findCompletionRows(@Param("slideId") String slideId, @Param("userId") String userId);

    /** Learners who have earned this slide's points (in this institute). */
    @Query(value = """
            SELECT COUNT(DISTINCT pl.user_id)
            FROM points_ledger pl
            WHERE pl.source_type = 'COURSE_ACTIVITY'
              AND pl.source_id = :slideId
              AND pl.institute_id = :instituteId
              AND pl.points > 0
            """, nativeQuery = true)
    long countEarners(@Param("slideId") String slideId, @Param("instituteId") String instituteId);
}
