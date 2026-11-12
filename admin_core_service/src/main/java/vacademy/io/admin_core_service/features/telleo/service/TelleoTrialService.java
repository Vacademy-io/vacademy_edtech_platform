package vacademy.io.admin_core_service.features.telleo.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.core.PhoneNumbers;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The phone a self sign-up proved with a WhatsApp code, kept so one phone gets one free trial and
 * so "Call me now" knows where to ring. The trial itself is the platform's self sign-up trial
 * ({@code lead_tag = FREE_TRIAL} + {@code demo_expires_at}, see docs/PRODUCT_SELF_SIGNUP.md): it
 * ends when the institute buys or is granted credits or takes a plan.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TelleoTrialService {

    /** A Telleo self sign-up. {@code trialEndsAt} is institutes.demo_expires_at. */
    public record TrialInfo(String instituteId, String phoneE164, Instant trialEndsAt) {}

    private final NamedParameterJdbcTemplate jdbc;

    public Optional<TrialInfo> find(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Optional.empty();
        List<TrialInfo> rows = jdbc.query("""
                SELECT p.institute_id, p.phone_e164, i.demo_expires_at
                  FROM telleo_trial_phone p
                  LEFT JOIN institutes i ON i.id = p.institute_id
                 WHERE p.institute_id = :id
                """, new MapSqlParameterSource("id", instituteId), (rs, n) -> {
            Timestamp ends = rs.getTimestamp("demo_expires_at");
            return new TrialInfo(rs.getString("institute_id"), rs.getString("phone_e164"),
                    ends == null ? null : ends.toInstant());
        });
        return rows.stream().findFirst();
    }

    /** Whether a phone number may still start a trial (one trial per phone). */
    public boolean isPhoneAvailable(String rawPhone) {
        String phone = PhoneNumbers.toE164(rawPhone);
        if (phone == null) return false;
        Integer used = jdbc.queryForObject("SELECT COUNT(*) FROM telleo_trial_phone WHERE phone_e164 = :p",
                new MapSqlParameterSource("p", phone), Integer.class);
        return used == null || used == 0;
    }

    /**
     * Records the proven phone for a new institute, inside the transaction that creates it, so a
     * phone that already had a trial rolls the whole institute back.
     */
    @Transactional
    public void registerTrial(String instituteId, String rawPhone) {
        String phone = PhoneNumbers.toE164(rawPhone);
        if (phone == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "A verified phone number is required for the free trial");
        }
        try {
            jdbc.update("INSERT INTO telleo_trial_phone (phone_e164, institute_id) VALUES (:p, :id)",
                    new MapSqlParameterSource().addValue("p", phone).addValue("id", instituteId));
        } catch (DuplicateKeyException e) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This phone number has already been used for a free trial. Please log in instead.");
        }
        log.info("[telleo] trial opened for institute {} (phone ***{})", instituteId,
                phone.substring(Math.max(0, phone.length() - 4)));
    }
}
