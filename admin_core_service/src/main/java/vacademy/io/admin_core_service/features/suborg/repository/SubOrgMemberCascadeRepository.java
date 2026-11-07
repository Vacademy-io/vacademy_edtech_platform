package vacademy.io.admin_core_service.features.suborg.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.suborg.entity.SubOrgMemberCascade;

import java.sql.Timestamp;
import java.util.List;

public interface SubOrgMemberCascadeRepository extends JpaRepository<SubOrgMemberCascade, String> {

    @Query(value = """
            SELECT * FROM sub_org_member_cascade
            WHERE status = 'PENDING' AND effective_at <= :now
            ORDER BY effective_at
            LIMIT 100
            """, nativeQuery = true)
    List<SubOrgMemberCascade> findDue(@Param("now") Timestamp now);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE sub_org_member_cascade
            SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
            WHERE sub_org_id = :subOrgId
              AND package_session_id = :packageSessionId
              AND admin_user_id = :adminUserId
              AND status = 'PENDING'
            """, nativeQuery = true)
    int supersedePending(@Param("subOrgId") String subOrgId,
                         @Param("packageSessionId") String packageSessionId,
                         @Param("adminUserId") String adminUserId);
}
