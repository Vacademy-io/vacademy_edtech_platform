package vacademy.io.admin_core_service.features.slide_activity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SlideActivityResponseRepository extends JpaRepository<SlideActivityResponse, String> {

    Optional<SlideActivityResponse> findBySlideIdAndUserIdAndKind(String slideId, String userId, String kind);

    /** [optionId, votes] for one batch, or every batch when packageSessionId is "" (never null). */
    @Query("SELECT r.optionId, COUNT(r) FROM SlideActivityResponse r WHERE r.slideId = :slideId " +
            "AND r.kind = 'POLL' AND r.instituteId = :instituteId " +
            "AND (:packageSessionId = '' OR r.packageSessionId = :packageSessionId) GROUP BY r.optionId")
    List<Object[]> countVotes(@Param("slideId") String slideId, @Param("instituteId") String instituteId,
                              @Param("packageSessionId") String packageSessionId);

    @Query("SELECT r FROM SlideActivityResponse r WHERE r.slideId = :slideId AND r.kind = :kind " +
            "AND r.instituteId = :instituteId " +
            "AND (:packageSessionId = '' OR r.packageSessionId = :packageSessionId) " +
            "ORDER BY r.bestScore DESC NULLS LAST, r.updatedAt DESC")
    List<SlideActivityResponse> findForSlide(@Param("slideId") String slideId, @Param("kind") String kind,
                                             @Param("instituteId") String instituteId,
                                             @Param("packageSessionId") String packageSessionId,
                                             org.springframework.data.domain.Pageable page);
}
