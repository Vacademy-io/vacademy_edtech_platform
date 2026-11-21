package vacademy.io.notification_service.features.email_otp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
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

}