package vacademy.io.admin_core_service.features.commerce.pos.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PosRegisterRepository extends JpaRepository<PosRegister, String> {

    /** A register of this institute; another institute's id reads as absent. */
    Optional<PosRegister> findByInstituteIdAndId(String instituteId, String id);

    boolean existsByInstituteIdAndCode(String instituteId, String code);

    List<PosRegister> findByInstituteId(String instituteId);

    @Query("SELECT r FROM PosRegister r WHERE r.instituteId = :instituteId AND r.locationId IN :locationIds")
    List<PosRegister> findByInstituteIdAndLocationIdIn(@Param("instituteId") String instituteId,
                                                       @Param("locationIds") Collection<String> locationIds);
}
