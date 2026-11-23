package vacademy.io.admin_core_service.features.commerce.pos.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PosSessionRepository extends JpaRepository<PosSession, String> {

    Optional<PosSession> findByInstituteIdAndId(String instituteId, String id);

    /**
     * The session row locked FOR UPDATE: the close waits here for every sale in flight (they
     * hold the row FOR SHARE). The caller refreshes a managed copy.
     */
    @Query(value = "SELECT * FROM pos_session WHERE institute_id = :instituteId AND id = :id FOR UPDATE",
            nativeQuery = true)
    Optional<PosSession> lockForUpdate(@Param("instituteId") String instituteId, @Param("id") String id);

    /** The session row locked FOR SHARE: a sale, a refund or a movement keeps the close out meanwhile. */
    @Query(value = "SELECT * FROM pos_session WHERE institute_id = :instituteId AND id = :id FOR SHARE",
            nativeQuery = true)
    Optional<PosSession> lockForShare(@Param("instituteId") String instituteId, @Param("id") String id);

    @Query("SELECT s FROM PosSession s WHERE s.instituteId = :instituteId AND s.registerId = :registerId "
            + "AND s.status = 'OPEN'")
    Optional<PosSession> findOpenByRegister(@Param("instituteId") String instituteId,
                                            @Param("registerId") String registerId);

    @Query("SELECT s FROM PosSession s WHERE s.instituteId = :instituteId AND s.cashierUserId = :userId "
            + "AND s.status = 'OPEN'")
    Optional<PosSession> findOpenByCashier(@Param("instituteId") String instituteId, @Param("userId") String userId);

    @Query("SELECT s FROM PosSession s WHERE s.instituteId = :instituteId AND s.registerId IN :registerIds "
            + "AND s.status = 'OPEN'")
    List<PosSession> findOpenByRegisters(@Param("instituteId") String instituteId,
                                         @Param("registerIds") Collection<String> registerIds);

    /** The register's last closed session (the drawer it handed over), if any. */
    @Query(value = """
            SELECT * FROM pos_session
            WHERE institute_id = :instituteId AND register_id = :registerId AND status = 'CLOSED'
            ORDER BY closed_at DESC, opened_at DESC, id DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<PosSession> findLastClosed(@Param("instituteId") String instituteId,
                                        @Param("registerId") String registerId);

    Optional<PosSession> findByInstituteIdAndOpenRequestId(String instituteId, String openRequestId);

    Optional<PosSession> findByInstituteIdAndCloseRequestId(String instituteId, String closeRequestId);
}
