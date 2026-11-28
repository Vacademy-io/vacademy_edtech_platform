package vacademy.io.admin_core_service.features.commerce.otp;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.Optional;

/**
 * Every state change is one conditional UPDATE, so two requests for the same code cannot both
 * win, on any pod.
 */
public interface CommerceOtpChallengeRepository extends JpaRepository<CommerceOtpChallenge, String> {

    /** The newest code sent to this phone for this purpose that can still be tried. */
    Optional<CommerceOtpChallenge> findFirstByInstituteIdAndPhoneHashAndPurposeAndStatusOrderByCreatedAtDesc(
            String instituteId, String phoneHash, String purpose, String status);

    /** A new code was sent: the earlier ones can no longer be tried. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceOtpChallenge c SET c.status = 'SUPERSEDED', c.updatedAt = :now "
            + "WHERE c.instituteId = :instituteId AND c.phoneHash = :phoneHash AND c.purpose = :purpose "
            + "AND c.status = 'SENT'")
    int supersede(@Param("instituteId") String instituteId, @Param("phoneHash") String phoneHash,
                  @Param("purpose") String purpose, @Param("now") Date now);

    /** Counts one try. 0 rows: the code is used up, superseded or already has {@code max} tries. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceOtpChallenge c SET c.attempts = c.attempts + 1, c.updatedAt = :now "
            + "WHERE c.id = :id AND c.status = 'SENT' AND c.attempts < :max AND c.expiresAt > :now")
    int countAttempt(@Param("id") String id, @Param("max") int max, @Param("now") Date now);

    @Transactional
    @Modifying
    @Query("UPDATE CommerceOtpChallenge c SET c.status = 'LOCKED', c.updatedAt = :now "
            + "WHERE c.id = :id AND c.status = 'SENT'")
    int lock(@Param("id") String id, @Param("now") Date now);

    /** Single use: only one request turns a SENT code into a VERIFIED one. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceOtpChallenge c SET c.status = 'VERIFIED', c.verifiedAt = :now, c.tokenKey = :tokenKey, "
            + "c.tokenExpiresAt = :tokenExpiresAt, c.updatedAt = :now WHERE c.id = :id AND c.status = 'SENT'")
    int markVerified(@Param("id") String id, @Param("tokenKey") String tokenKey,
                     @Param("tokenExpiresAt") Date tokenExpiresAt, @Param("now") Date now);

    /** Spends a verified-phone token: only one request wins. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceOtpChallenge c SET c.status = 'CONSUMED', c.consumedAt = :now, c.updatedAt = :now "
            + "WHERE c.id = :id AND c.status = 'VERIFIED' AND c.tokenExpiresAt > :now")
    int consume(@Param("id") String id, @Param("now") Date now);

    @Transactional
    @Modifying
    @Query("DELETE FROM CommerceOtpChallenge c WHERE c.createdAt < :before")
    int deleteCreatedBefore(@Param("before") Date before);
}
