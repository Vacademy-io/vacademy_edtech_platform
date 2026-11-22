package vacademy.io.auth_service.feature.sso.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.sso.entity.SsoHandoffCode;

import java.util.Date;

@Repository
public interface SsoHandoffCodeRepository extends JpaRepository<SsoHandoffCode, String> {

    /** Marks the code used; 1 only for the first caller while it is unexpired. */
    @Modifying
    @Transactional
    @Query("UPDATE SsoHandoffCode c SET c.usedAt = :now WHERE c.codeHash = :hash AND c.usedAt IS NULL AND c.expiresAt > :now")
    int consume(@Param("hash") String hash, @Param("now") Date now);

    @Modifying
    @Transactional
    @Query("DELETE FROM SsoHandoffCode c WHERE c.expiresAt < :before")
    int deleteExpiredBefore(@Param("before") Date before);
}
