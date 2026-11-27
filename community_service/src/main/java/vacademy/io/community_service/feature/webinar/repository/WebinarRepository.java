package vacademy.io.community_service.feature.webinar.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.community_service.feature.webinar.entity.Webinar;

import java.util.List;

public interface WebinarRepository extends JpaRepository<Webinar, String> {

    /** Super-admin listing — includes hidden webinars so they can be shown again; newest start first. */
    List<Webinar> findAllByOrderByStartsAtDesc();

    /** Institute-facing listing: published webinars, newest start first. */
    List<Webinar> findByActiveTrueOrderByStartsAtDesc();
}
