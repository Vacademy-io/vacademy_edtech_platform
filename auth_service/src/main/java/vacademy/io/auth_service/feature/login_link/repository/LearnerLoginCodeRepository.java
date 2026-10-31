package vacademy.io.auth_service.feature.login_link.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.login_link.entity.LearnerLoginCode;

import java.time.Instant;
import java.util.Optional;

public interface LearnerLoginCodeRepository extends JpaRepository<LearnerLoginCode, String> {

    Optional<LearnerLoginCode> findByCodeHash(String codeHash);

    /**
     * The newest user with this email (case-insensitive) who is a learner (STUDENT role, ACTIVE or
     * INVITED) of the institute. Newest wins when an email has several accounts there.
     */
    @Query(value = """
            SELECT u.id FROM users u
            JOIN user_role ur ON ur.user_id = u.id
            JOIN roles r ON r.id = ur.role_id
            WHERE LOWER(u.email) = LOWER(:email)
              AND ur.institute_id = :instituteId
              AND ur.status IN ('ACTIVE', 'INVITED')
              AND r.role_name = 'STUDENT'
            ORDER BY u.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findLearnerIdByEmail(@Param("email") String email, @Param("instituteId") String instituteId);

    @Modifying
    @Transactional
    @Query("UPDATE LearnerLoginCode c SET c.useCount = c.useCount + 1, c.lastUsedAt = :now, c.lastUsedIp = :ip WHERE c.id = :id")
    int recordUse(@Param("id") String id, @Param("now") Instant now, @Param("ip") String ip);
}
