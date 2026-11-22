package vacademy.io.auth_service.feature.sso.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.sso.entity.SsoLoginAttempt;

import java.util.Date;

@Repository
public interface SsoLoginAttemptRepository extends JpaRepository<SsoLoginAttempt, String> {

    /** Marks the attempt used; 1 only for the first caller while it is unexpired. */
    @Modifying
    @Transactional
    @Query("UPDATE SsoLoginAttempt a SET a.usedAt = :now WHERE a.state = :state AND a.usedAt IS NULL AND a.expiresAt > :now")
    int consume(@Param("state") String state, @Param("now") Date now);

    @Modifying
    @Transactional
    @Query("DELETE FROM SsoLoginAttempt a WHERE a.expiresAt < :before")
    int deleteExpiredBefore(@Param("before") Date before);
}
