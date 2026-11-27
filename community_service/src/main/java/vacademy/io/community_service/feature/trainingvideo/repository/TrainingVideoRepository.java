package vacademy.io.community_service.feature.trainingvideo.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.community_service.feature.trainingvideo.entity.TrainingVideo;

import java.util.List;

/**
 * Rows of one {@code kind} at a time: the table holds training videos and, since V80, webinars.
 * Every listing filters on kind so a webinar never shows up in the Training popup and vice versa.
 */
public interface TrainingVideoRepository extends JpaRepository<TrainingVideo, String> {

    /** Super-admin listing — includes inactive rows so they can be re-activated. */
    List<TrainingVideo> findByKindOrderByCreatedAtDesc(String kind);

    List<TrainingVideo> findByKindAndActiveTrueOrderByCreatedAtDesc(String kind);

    /** Active rows of the kind whose name or description contains the search term (case-insensitive). */
    @Query("select t from TrainingVideo t where t.active = true and t.kind = :kind "
            + "and (lower(t.title) like lower(concat('%', :search, '%')) "
            + "     or lower(coalesce(t.description, '')) like lower(concat('%', :search, '%'))) "
            + "order by t.createdAt desc")
    List<TrainingVideo> findActiveBySearch(@Param("search") String search, @Param("kind") String kind);

    /** Webinars for the super-admin page — includes inactive ones; newest start first. */
    List<TrainingVideo> findByKindOrderByStartsAtDesc(String kind);

    /** Webinars for the institute-facing panel; newest start first. */
    List<TrainingVideo> findByKindAndActiveTrueOrderByStartsAtDesc(String kind);
}
