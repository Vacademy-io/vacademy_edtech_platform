package vacademy.io.admin_core_service.features.catalogue_blog.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_blog.entity.CatalogueBlogPost;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public interface CatalogueBlogPostRepository extends JpaRepository<CatalogueBlogPost, String> {

    Optional<CatalogueBlogPost> findByIdAndInstituteId(String id, String instituteId);

    Optional<CatalogueBlogPost> findByInstituteIdAndSlug(String instituteId, String slug);

    boolean existsByInstituteIdAndSlug(String instituteId, String slug);

    /**
     * Admin list. Null status = every status; the search matches title, slug
     * and category. Newest edit first so the post being worked on stays on top.
     * The CASTs matter: a null search term reaches Postgres untyped (bytea) and
     * LOWER('%' || NULL || '%') then fails with "function lower(bytea) does not
     * exist" even though the IS NULL branch would have short-circuited it.
     */
    @Query(value = """
            SELECT p FROM CatalogueBlogPost p
             WHERE p.instituteId = :instituteId
               AND (:status IS NULL OR p.status = :status)
               AND (:category IS NULL OR p.category = :category)
               AND (:q IS NULL
                    OR LOWER(p.title) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(p.slug) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                    OR LOWER(COALESCE(p.category, '')) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%')))
             ORDER BY p.updatedAt DESC
            """)
    Page<CatalogueBlogPost> searchForAdmin(@Param("instituteId") String instituteId,
                                           @Param("status") String status,
                                           @Param("category") String category,
                                           @Param("q") String q,
                                           Pageable pageable);

    /**
     * Public list: PUBLISHED, already past its publish time, newest first. The
     * `now` bound is what makes a scheduled post invisible until its time.
     */
    @Query(value = """
            SELECT p FROM CatalogueBlogPost p
             WHERE p.instituteId = :instituteId
               AND p.status = 'PUBLISHED'
               AND p.publishedAt IS NOT NULL AND p.publishedAt <= :now
               AND (:category IS NULL OR p.category = :category)
             ORDER BY p.publishedAt DESC
            """)
    Page<CatalogueBlogPost> findPublished(@Param("instituteId") String instituteId,
                                          @Param("category") String category,
                                          @Param("now") Timestamp now,
                                          Pageable pageable);

    /** Categories in use, for the section editor's filter picker and the public filter chips. */
    @Query(value = """
            SELECT DISTINCT p.category FROM CatalogueBlogPost p
             WHERE p.instituteId = :instituteId
               AND p.category IS NOT NULL AND p.category <> ''
               AND (:publishedOnly = FALSE OR (p.status = 'PUBLISHED' AND p.publishedAt <= :now))
             ORDER BY p.category
            """)
    List<String> distinctCategories(@Param("instituteId") String instituteId,
                                    @Param("publishedOnly") boolean publishedOnly,
                                    @Param("now") Timestamp now);
}
