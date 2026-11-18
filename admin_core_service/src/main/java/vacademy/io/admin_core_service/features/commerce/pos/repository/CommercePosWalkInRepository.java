package vacademy.io.admin_core_service.features.commerce.pos.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.pos.entity.CommercePosWalkIn;

import java.util.Optional;

public interface CommercePosWalkInRepository extends JpaRepository<CommercePosWalkIn, String> {

    Optional<CommercePosWalkIn> findByInstituteId(String instituteId);

    /** The institute's walk-in row; a race inserts nothing (the first row stays). 1 = inserted. */
    @Modifying
    @Query(value = """
            INSERT INTO commerce_pos_walk_in (id, institute_id, user_id)
            VALUES (:id, :instituteId, :userId)
            ON CONFLICT (institute_id) DO NOTHING
            """, nativeQuery = true)
    int insertIfMissing(@Param("id") String id, @Param("instituteId") String instituteId,
                        @Param("userId") String userId);
}
