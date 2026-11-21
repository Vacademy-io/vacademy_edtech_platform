package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;

import java.util.List;
import java.util.Optional;

public interface CommerceProductMediaRepository extends JpaRepository<CommerceProductMedia, String> {

    Optional<CommerceProductMedia> findByInstituteIdAndId(String instituteId, String id);

    Page<CommerceProductMedia> findByInstituteIdAndPackageId(String instituteId, String packageId, Pageable pageable);

    List<CommerceProductMedia> findByInstituteIdAndPackageIdOrderByPositionAsc(String instituteId, String packageId);

    // ---- renditions_json. The column is written only by the statements below; the
    // ---- entity maps it read-only, so a gallery save never overwrites the job's state.

    /**
     * Replaces the rendition state of one row if it still holds the expected state and still
     * points at the same file. Returns 1 when this caller won. The expected state may be null
     * (a row never processed); it is cast to varchar first because a null parameter of a
     * native query can reach the database typed as binary, which has no cast to jsonb.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_product_media
               SET renditions_json = CAST(:next AS jsonb)
             WHERE id = :id
               AND media_id = :mediaId
               AND renditions_json IS NOT DISTINCT FROM CAST(CAST(:expected AS varchar) AS jsonb)
            """, nativeQuery = true)
    int swapRenditions(@Param("id") String id,
                       @Param("mediaId") String mediaId,
                       @Param("expected") String expected,
                       @Param("next") String next);

    /** As {@link #swapRenditions}, and records the size of the original as measured. */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_product_media
               SET renditions_json = CAST(:next AS jsonb),
                   width = :width,
                   height = :height
             WHERE id = :id
               AND media_id = :mediaId
               AND renditions_json IS NOT DISTINCT FROM CAST(CAST(:expected AS varchar) AS jsonb)
            """, nativeQuery = true)
    int swapRenditionsAndSize(@Param("id") String id,
                              @Param("mediaId") String mediaId,
                              @Param("expected") String expected,
                              @Param("next") String next,
                              @Param("width") int width,
                              @Param("height") int height);

    /** Back to "not processed yet" for one row of the institute. */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_product_media
               SET renditions_json = NULL
             WHERE institute_id = :instituteId
               AND id = :id
            """, nativeQuery = true)
    int clearRenditions(@Param("instituteId") String instituteId, @Param("id") String id);

    /**
     * Queues the images of an institute again, optionally of one product only. Rows that were
     * never processed are already queued and stay as they are; they are counted too.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_product_media
               SET renditions_json = CASE
                       WHEN renditions_json IS NULL THEN NULL
                       ELSE (renditions_json - '_error') || CAST(:patch AS jsonb)
                   END
             WHERE institute_id = :instituteId
               AND kind = 'IMAGE'
               AND (CAST(:packageId AS varchar) IS NULL OR package_id = CAST(:packageId AS varchar))
               AND (:force = TRUE
                    OR renditions_json IS NULL
                    OR COALESCE(renditions_json ->> '_status', '') <> 'READY')
            """, nativeQuery = true)
    int requeueRenditions(@Param("instituteId") String instituteId,
                          @Param("packageId") String packageId,
                          @Param("force") boolean force,
                          @Param("patch") String patch);

    /** Ids of images the rendition job should work on now, oldest first. Times are epoch seconds. */
    @Query(value = """
            SELECT m.id
              FROM commerce_product_media m
             WHERE m.kind = 'IMAGE'
               AND (m.renditions_json IS NULL
                    OR (m.renditions_json ->> '_status' = 'PENDING'
                        AND COALESCE(CAST(m.renditions_json ->> '_next_attempt_at' AS bigint), 0) <= :now)
                    OR (m.renditions_json ->> '_status' = 'PROCESSING'
                        AND COALESCE(CAST(m.renditions_json ->> '_claimed_at' AS bigint), 0) < :staleBefore))
             ORDER BY m.created_at, m.id
             LIMIT :limit
            """, nativeQuery = true)
    List<String> findIdsDueForRenditions(@Param("now") long now,
                                         @Param("staleBefore") long staleBefore,
                                         @Param("limit") int limit);

    /** Status and count per state for the images of one institute. */
    @Query(value = """
            SELECT COALESCE(m.renditions_json ->> '_status', 'PENDING') AS status, COUNT(*) AS total
              FROM commerce_product_media m
             WHERE m.institute_id = :instituteId
               AND m.kind = 'IMAGE'
             GROUP BY 1
            """, nativeQuery = true)
    List<Object[]> countRenditionStatuses(@Param("instituteId") String instituteId);
}
