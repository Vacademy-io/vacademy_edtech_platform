package vacademy.io.community_service.feature.trainingvideo.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.community_service.feature.trainingvideo.entity.TrainingVideo;

import java.util.List;

public interface TrainingVideoRepository extends JpaRepository<TrainingVideo, String> {

    /** Super-admin listing — includes inactive rows so they can be re-activated. */
    List<TrainingVideo> findAllByOrderByCreatedAtDesc();

    List<TrainingVideo> findByActiveTrueOrderByCreatedAtDesc();

    /** Active videos whose name or description contains the search term (case-insensitive). */
    @Query("select t from TrainingVideo t where t.active = true "
            + "and (lower(t.title) like lower(concat('%', :search, '%')) "
            + "     or lower(coalesce(t.description, '')) like lower(concat('%', :search, '%'))) "
            + "order by t.createdAt desc")
    List<TrainingVideo> findActiveBySearch(@Param("search") String search);
}
