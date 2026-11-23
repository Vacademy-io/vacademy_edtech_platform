package vacademy.io.admin_core_service.features.learner_home.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeBlock;

import java.util.Collection;
import java.util.List;

@Repository
public interface LearnerHomeBlockRepository extends JpaRepository<LearnerHomeBlock, String> {

    List<LearnerHomeBlock> findByLayoutIdOrderByPositionAsc(String layoutId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "DELETE FROM learner_home_block WHERE layout_id = :layoutId", nativeQuery = true)
    int deleteByLayout(@Param("layoutId") String layoutId);

    /** Rows of (layout_id, count). */
    @Query(value = "SELECT layout_id, COUNT(*) FROM learner_home_block WHERE layout_id IN (:layoutIds) "
            + "GROUP BY layout_id", nativeQuery = true)
    List<Object[]> countByLayout(@Param("layoutIds") Collection<String> layoutIds);
}
