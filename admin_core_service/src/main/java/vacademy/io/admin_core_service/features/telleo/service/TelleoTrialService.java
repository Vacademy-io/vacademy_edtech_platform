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
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallLane;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallLaneRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The state of a self-signed-up Telleo account, and the one rule that makes a free trial safe to
 * give an anonymous visitor: until it goes live, an account can only call the phone number it
 * proved at sign-up, and only until its trial ends.
 *
 * <p>Institutes with no {@code institute_telleo_state} row (every institute that existed before
 * this, and every non-Telleo sign-up) get {@link Verdict#ALLOW} from {@link #checkDial} and are
 * never touched here.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TelleoTrialService {

    public static final String TRIAL = "TRIAL";
    public static final String LIVE = "LIVE";
    public static final String SUSPENDED = "SUSPENDED";
    private static final Set<String> STATES = Set.of(TRIAL, LIVE, SUSPENDED);

    /** A trial shares the voice fleet with paying customers, so it gets one line at a time. */
    static final int TRIAL_LANE_MAX_CONCURRENT = 1;

    /** Stable codes: the public API returns them and the dashboard matches on them. */
    public static final String CODE_TRIAL_ENDED = "trial_ended";
    public static final String CODE_TRIAL_NUMBER = "trial_number_not_allowed";
    public static final String CODE_SUSPENDED = "account_suspended";

    public static final String MSG_TRIAL_ENDED =
            "Your free trial has ended. Upgrade to keep calling.";
    public static final String MSG_TRIAL_NUMBER =
            "During the free trial your agent can only call the phone number you verified at sign-up. "
                    + "Upgrade to call other numbers.";
    public static final String MSG_SUSPENDED =
            "Calling is paused on this account. Contact Telleo support.";

    public enum Verdict {
        ALLOW(null, null),
        TRIAL_ENDED(CODE_TRIAL_ENDED, MSG_TRIAL_ENDED),
        NUMBER_NOT_ALLOWED(CODE_TRIAL_NUMBER, MSG_TRIAL_NUMBER),
        SUSPENDED(CODE_SUSPENDED, MSG_SUSPENDED);

        public final String code;
        public final String message;

        Verdict(String code, String message) {
            this.code = code;
            this.message = message;
        }

        /** Holds every call of the institute, not just this one (the queue holds the lane). */
        public boolean blocksInstitute() {
            return this == TRIAL_ENDED || this == SUSPENDED;
        }
    }

    /** One account's state. {@code trialEndsAt} is institutes.demo_expires_at. */
    public record TrialInfo(String instituteId, String state, String phoneE164, Instant trialEndsAt) {
        public boolean isTrial() {
            return TRIAL.equals(state);
        }

        public boolean trialEnded(Instant now) {
            return trialEndsAt != null && !now.isBefore(trialEndsAt);
        }
    }

    private final NamedParameterJdbcTemplate jdbc;
    private final AiCallLaneRepository laneRepository;

    // ── Reads ───────────────────────────────────────────────────────────────────

    public Optional<TrialInfo> find(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return Optional.empty();
        List<TrialInfo> rows = jdbc.query("""
                SELECT s.institute_id, s.state, p.phone_e164, i.demo_expires_at
                  FROM institute_telleo_state s
                  LEFT JOIN telleo_trial_phone p ON p.institute_id = s.institute_id
                  LEFT JOIN institutes i ON i.id = s.institute_id
                 WHERE s.institute_id = :id
                """, new MapSqlParameterSource("id", instituteId), (rs, n) -> {
            Timestamp ends = rs.getTimestamp("demo_expires_at");
            return new TrialInfo(rs.getString("institute_id"), rs.getString("state"),
                    rs.getString("phone_e164"), ends == null ? null : ends.toInstant());
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
     * May this institute place a real call to {@code destination} right now? Called on the dial
     * path for every real (non-test) call, so it is one primary-key read and fails OPEN only for
     * institutes that are not Telleo self sign-ups.
     */
    public Verdict checkDial(String instituteId, String destination) {
        Optional<TrialInfo> info = find(instituteId);
        if (info.isEmpty()) return Verdict.ALLOW;
        return verdictFor(info.get(), destination, Instant.now());
    }

    static Verdict verdictFor(TrialInfo info, String destination, Instant now) {
        if (SUSPENDED.equals(info.state())) return Verdict.SUSPENDED;
        if (!info.isTrial()) return Verdict.ALLOW;
        if (info.trialEnded(now)) return Verdict.TRIAL_ENDED;
        String allowed = info.phoneE164();
        String to = PhoneNumbers.toE164(destination);
        // A trial without a verified phone (should not happen) calls nobody.
        if (allowed == null || to == null || !allowed.equals(to)) return Verdict.NUMBER_NOT_ALLOWED;
        return Verdict.ALLOW;
    }

    // ── Writes ──────────────────────────────────────────────────────────────────

    /**
     * Opens the trial for a new institute, inside the transaction that creates it, so a phone
     * that already had a trial rolls the whole institute back.
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
        jdbc.update("""
                INSERT INTO institute_telleo_state (institute_id, state, updated_by)
                VALUES (:id, 'TRIAL', 'self-signup')
                ON CONFLICT (institute_id) DO NOTHING
                """, new MapSqlParameterSource("id", instituteId));
        // Only the cap: weight and paused keep their defaults, and an existing row (a staff
        // override) is left alone.
        if (laneRepository.findById(instituteId).isEmpty()) {
            laneRepository.save(AiCallLane.builder()
                    .instituteId(instituteId)
                    .maxConcurrent(TRIAL_LANE_MAX_CONCURRENT)
                    .weight(1)
                    .build());
        }
        log.info("[telleo] trial opened for institute {} (phone ***{})", instituteId,
                phone.substring(Math.max(0, phone.length() - 4)));
    }

    /**
     * Moves an account between TRIAL, LIVE and SUSPENDED. Going LIVE lifts the trial's one-line
     * cap; anything else keeps it.
     */
    @Transactional
    public TrialInfo setState(String instituteId, String state, String actor) {
        String next = state == null ? "" : state.trim().toUpperCase();
        if (!STATES.contains(next)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "state must be TRIAL, LIVE or SUSPENDED");
        }
        int updated = jdbc.update("""
                UPDATE institute_telleo_state SET state = :s, updated_by = :by, updated_at = now()
                 WHERE institute_id = :id
                """, new MapSqlParameterSource().addValue("s", next).addValue("by", actor).addValue("id", instituteId));
        if (updated == 0) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "This institute is not a Telleo self sign-up");
        }
        laneRepository.findById(instituteId).ifPresent(lane -> {
            if (LIVE.equals(next) && Integer.valueOf(TRIAL_LANE_MAX_CONCURRENT).equals(lane.getMaxConcurrent())) {
                lane.setMaxConcurrent(null);
                laneRepository.save(lane);
            } else if (TRIAL.equals(next) && lane.getMaxConcurrent() == null) {
                lane.setMaxConcurrent(TRIAL_LANE_MAX_CONCURRENT);
                laneRepository.save(lane);
            }
        });
        log.info("[telleo] institute {} -> {} by {}", instituteId, next, actor);
        return find(instituteId).orElseThrow();
    }
}
