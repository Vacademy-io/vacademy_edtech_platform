package vacademy.io.admin_core_service.features.catalogue_review.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public interface CatalogueReviewRepository extends JpaRepository<CatalogueReview, String> {

    Optional<CatalogueReview> findByIdAndInstituteId(String id, String instituteId);

    /**
     * Admin list, newest first. Null status = every status; the search matches
     * name, text, city, course and designation. The CASTs keep a null search
     * term typed (an untyped null reaches Postgres as bytea and LOWER fails).
     */
    @Query(value = """
            SELECT r FROM CatalogueReview r
             WHERE r.instituteId = :instituteId
               AND (:status IS NULL OR r.status = :status)
               AND (:q IS NULL
                    OR LOWER(r.reviewerName) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(COALESCE(r.reviewText, '')) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(COALESCE(r.city, '')) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(COALESCE(r.courseName, '')) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(COALESCE(r.designation, '')) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%')))
             ORDER BY r.createdAt DESC
            """)
    Page<CatalogueReview> searchForAdmin(@Param("instituteId") String instituteId,
                                         @Param("status") String status,
                                         @Param("q") String q,
                                         Pageable pageable);

    /** Public list: approved only, at least minRating stars, newest first. */
    @Query(value = """
            SELECT r FROM CatalogueReview r
             WHERE r.instituteId = :instituteId
               AND r.status = 'APPROVED'
               AND r.rating >= :minRating
             ORDER BY r.createdAt DESC
            """)
    Page<CatalogueReview> findApproved(@Param("instituteId") String instituteId,
                                       @Param("minRating") int minRating,
                                       Pageable pageable);

    /** Rows of [status, count] for the admin tabs. */
    @Query(value = """
            SELECT r.status, COUNT(r) FROM CatalogueReview r
             WHERE r.instituteId = :instituteId
             GROUP BY r.status
            """)
    List<Object[]> countByStatus(@Param("instituteId") String instituteId);

    /** One row [average rating, count] over every approved review. */
    @Query(value = """
            SELECT AVG(r.rating), COUNT(r) FROM CatalogueReview r
             WHERE r.instituteId = :instituteId AND r.status = 'APPROVED'
            """)
    List<Object[]> approvedSummary(@Param("instituteId") String instituteId);

    long countByVisitorKeyAndCreatedAtAfter(String visitorKey, Timestamp after);

    long countByInstituteIdAndCreatedAtAfter(String instituteId, Timestamp after);
}
