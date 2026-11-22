package vacademy.io.notification_service.features.email_otp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.email_otp.entity.EmailOtp;

import java.util.List;
import java.util.Optional;

@Repository
public interface OtpRepository extends JpaRepository<EmailOtp, String> {

    List<EmailOtp> findAllByService(String service);

    Optional<EmailOtp> findByEmailAndService(String email, String service);

    Optional<EmailOtp> findByOtp(String otp);

    Optional<EmailOtp> findTopByEmailOrderByCreatedAtDesc(String email);

    Optional<EmailOtp> findTopByPhoneNumberAndTypeOrderByCreatedAtDesc(String phoneNumber, String type);

    /** OTP emails created for this address in the last {@code minutes} minutes (database clock). */
    @Query(value = "SELECT count(*) FROM email_otp WHERE lower(email) = lower(:email) "
            + "AND created_at > now() - make_interval(mins => :minutes)", nativeQuery = true)
    long countRecentForEmail(@Param("email") String email, @Param("minutes") int minutes);

    /**
     * Wrong-entry count kept in {@code is_verified} as {@code "fail:N"} (any other value = 0),
     * so no extra column is needed. Atomically takes one attempt for this code and returns 1,
     * or returns 0 when {@code maxFailures} wrong entries have already been used up.
     */
    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value = "UPDATE email_otp SET is_verified = 'fail:' || ("
            + "CASE WHEN is_verified LIKE 'fail:%' THEN CAST(substring(is_verified from 6) AS integer) ELSE 0 END + 1) "
            + "WHERE id = :id AND "
            + "(CASE WHEN is_verified LIKE 'fail:%' THEN CAST(substring(is_verified from 6) AS integer) ELSE 0 END) "
            + "< :maxFailures", nativeQuery = true)
    int takeVerifyAttempt(@Param("id") String id, @Param("maxFailures") int maxFailures);

    /** Marks the code as verified (also clears the wrong-entry count). */
    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value = "UPDATE email_otp SET is_verified = 'true' WHERE id = :id", nativeQuery = true)
    int markVerified(@Param("id") String id);

}
