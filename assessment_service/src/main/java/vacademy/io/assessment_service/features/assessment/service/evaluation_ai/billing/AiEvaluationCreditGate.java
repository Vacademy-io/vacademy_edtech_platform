package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient.ToolEstimate;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Credit check for AI evaluation (AI_EVALUATION_PUBLIC_API.md 10.6, gate G10).
 *
 * <p><b>At accept</b> ({@link #reserve}), inside the transaction that inserts the
 * process rows:
 * <ol>
 *   <li>quote every copy with ai_service ({@code /credits/v1/estimate-tool}, one call
 *       per distinct price) - BEFORE the lock, so a slow credit service never holds
 *       other accepts for the same institute;</li>
 *   <li>{@code pg_advisory_xact_lock(hashtext('ai_credit:' || institute))}: accepts for
 *       one institute are serialised across both pods until the caller commits;</li>
 *   <li>{@code committed} = what the institute's queued and running checks were
 *       quoted ({@code SUM(quoted_credits)});</li>
 *   <li>{@code available = balance + credit_limit - committed}; refuse with
 *       {@link InsufficientCreditsException} when it does not cover the copies.</li>
 * </ol>
 * The caller writes the returned quote and rate snapshot on each process row
 * before its transaction commits, so the next accept counts them.
 *
 * <p><b>Failure mode.</b> {@link Mode#DASHBOARD} fails open: an unreachable credit
 * service or an institute with no balance row lets the work through (a credit-service
 * blip must not stop a teacher). {@link Mode#API} fails closed:
 * {@link CreditCheckUnavailableException} (503, retry in 30 s).
 *
 * <p><b>At dispatch</b> ({@link #checkAtDispatch}), outside any transaction: the quote
 * is compared with the live balance again; short = the process fails with
 * {@code insufficient_credits} before anything is sent, so it is never billed.
 */
@Slf4j
@Component
public class AiEvaluationCreditGate {

        public enum Mode {
                /** A teacher on the admin dashboard: refuse only on a known shortfall. */
                DASHBOARD,
                /** Partner API traffic: any doubt refuses. */
                API
        }

        /** What a process row records at accept: the quote for one copy and the rate it used. */
        public record Reservation(BigDecimal quotedCredits, String rateSnapshotJson) {
                public static final Reservation NONE = new Reservation(null, null);
        }

        public enum DispatchVerdict {
                /** Send it. */
                PROCEED,
                /** The balance no longer covers the quote: fail it, unbilled. */
                INSUFFICIENT,
                /** API traffic and the credit service did not answer: put it back in the queue. */
                UNAVAILABLE
        }

        /**
         * @param newQuote set when the row had no quote yet (queued by a learner's submit or
         *                 before this release) and one was made now; the caller stores it
         */
        public record DispatchCheck(DispatchVerdict verdict, BigDecimal quoted, BigDecimal balance,
                        BigDecimal creditLimit, Reservation newQuote) {
        }

        static final String LOCK_KEY_PREFIX = "ai_credit:";

        /** pg_advisory_xact_lock returns void; wrapping it gives JDBC a row to read. */
        static final String LOCK_SQL = "SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(:lockKey))) AS l";

        /**
         * What the institute's queued and running checks were quoted. Two halves so each
         * matches one of V52's partial indexes (pending / in flight, both leading on lane):
         * the status lists are literals - generated from the enum, never user input -
         * because Postgres only proves a partial-index predicate from constants.
         */
        static final String COMMITTED_SQL = "SELECT COALESCE(SUM(c.q), 0) FROM ("
                        + " SELECT p.quoted_credits AS q FROM ai_evaluation_process p"
                        + " WHERE p.status = 'PENDING' AND p.lane IN (" + literals(laneNames()) + ")"
                        + " AND p.institute_id = :instituteId"
                        + " UNION ALL"
                        + " SELECT p.quoted_credits AS q FROM ai_evaluation_process p"
                        + " WHERE p.status IN (" + literals(AiEvaluationStatusEnum.IN_FLIGHT) + ")"
                        + " AND p.lane IN (" + literals(laneNames()) + ")"
                        + " AND p.institute_id = :instituteId"
                        + ") c";

        private final AiServiceCreditClient creditClient;
        private final NamedParameterJdbcTemplate jdbc;
        private final ObjectMapper objectMapper;
        private final Duration timeout;

        /**
         * Kill switch for the DASHBOARD refusals only (accept and dispatch). Off = dashboard
         * copies are still quoted (quoted_credits, rate_snapshot) but never refused, which
         * is how the dashboard behaved before this check. Partner API traffic is always
         * enforced.
         */
        private final boolean dashboardEnforced;

        @Autowired
        public AiEvaluationCreditGate(AiServiceCreditClient creditClient, JdbcTemplate jdbcTemplate,
                        ObjectMapper objectMapper,
                        @Value("${assessment.ai-evaluation.credit-check.timeout-ms:4000}") long timeoutMs,
                        @Value("${assessment.ai-evaluation.credit-check.dashboard-enforced:false}") boolean dashboardEnforced) {
                this(creditClient, new NamedParameterJdbcTemplate(jdbcTemplate), objectMapper,
                                Duration.ofMillis(Math.max(500, timeoutMs)), dashboardEnforced);
        }

        AiEvaluationCreditGate(AiServiceCreditClient creditClient, NamedParameterJdbcTemplate jdbc,
                        ObjectMapper objectMapper, Duration timeout) {
                this(creditClient, jdbc, objectMapper, timeout, true);
        }

        AiEvaluationCreditGate(AiServiceCreditClient creditClient, NamedParameterJdbcTemplate jdbc,
                        ObjectMapper objectMapper, Duration timeout, boolean dashboardEnforced) {
                this.creditClient = creditClient;
                this.jdbc = jdbc;
                this.objectMapper = objectMapper;
                this.timeout = timeout;
                this.dashboardEnforced = dashboardEnforced;
        }

        // ------------------------------------------------------------------ accept

        /**
         * Price {@code copies}, check the institute can afford all of them on top of what
         * is already committed, and hold the per-institute lock until the caller's
         * transaction commits.
         *
         * <p>Must be called inside the transaction that inserts the process rows (the lock
         * is transaction-scoped). Deliberately not {@code @Transactional}: a refusal must
         * not mark the caller's transaction rollback-only behind its back - the caller
         * decides what a refusal rolls back.
         *
         * @param creditLimit the overdraft the institute's contract allows; 0 (or null) for
         *                    the dashboard
         * @return one reservation per copy, in order; {@link Reservation#NONE} entries when
         *         the dashboard check could not price a copy
         * @throws InsufficientCreditsException when the copies do not fit
         * @throws CreditCheckUnavailableException API mode only, when the credit service did
         *                                         not answer
         */
        public List<Reservation> reserve(String instituteId, List<AiEvaluationCharge> copies, BigDecimal creditLimit,
                        Mode mode) {
                return reserve(instituteId, copies, creditLimit, mode, Prequote.NONE);
        }

        /**
         * Quotes taken BEFORE the caller's transaction, so the HTTP estimate (up to the
         * credit-check timeout) never runs while the caller holds row locks and a pooled
         * connection. Holds failed quotes too: {@link #reserve} then refuses exactly as if it
         * had asked itself, without a second wait.
         */
        public record Prequote(String instituteId, Map<AiEvaluationCharge, ToolEstimate> estimates) {
                public static final Prequote NONE = new Prequote(null, Map.of());

                ToolEstimate find(String forInstitute, AiEvaluationCharge charge) {
                        if (instituteId == null || !instituteId.equals(forInstitute) || estimates == null) {
                                return null;
                        }
                        return estimates.get(charge);
                }
        }

        /** Step 1 of {@link #reserve} on its own: no lock, no transaction, no DB. */
        public Prequote prequote(String instituteId, List<AiEvaluationCharge> charges) {
                if (instituteId == null || instituteId.isBlank() || charges == null || charges.isEmpty()) {
                        return Prequote.NONE;
                }
                Map<AiEvaluationCharge, ToolEstimate> quotes = new LinkedHashMap<>();
                for (AiEvaluationCharge charge : charges) {
                        if (charge != null) {
                                quotes.computeIfAbsent(charge,
                                                c -> creditClient.estimate(c.toolKey(), c.params(), instituteId, timeout));
                        }
                }
                return new Prequote(instituteId, java.util.Collections.unmodifiableMap(quotes));
        }

        /**
         * {@link #reserve(String, List, BigDecimal, Mode)} using quotes taken before the
         * transaction; a charge the prequote does not cover is quoted here as usual.
         */
        public List<Reservation> reserve(String instituteId, List<AiEvaluationCharge> copies, BigDecimal creditLimit,
                        Mode mode, Prequote prequote) {
                if (copies == null || copies.isEmpty()) {
                        return List.of();
                }
                if (instituteId == null || instituteId.isBlank()) {
                        if (mode == Mode.API) {
                                throw new IllegalArgumentException("institute_id is required for an API credit check");
                        }
                        log.warn("[ai-credit] no institute on {} copies; credit check skipped", copies.size());
                        return none(copies.size());
                }
                BigDecimal limit = creditLimit == null || creditLimit.signum() < 0 ? BigDecimal.ZERO : creditLimit;

                // 1. Quote, outside the lock: one call per distinct price.
                Map<AiEvaluationCharge, ToolEstimate> quotes = new LinkedHashMap<>();
                for (AiEvaluationCharge charge : copies) {
                        quotes.computeIfAbsent(charge, c -> {
                                ToolEstimate early = prequote == null ? null : prequote.find(instituteId, c);
                                return early != null ? early
                                                : creditClient.estimate(c.toolKey(), c.params(), instituteId, timeout);
                        });
                }
                List<ToolEstimate> failed = quotes.values().stream()
                                .filter(q -> !q.reachable() || q.credits() == null).toList();
                if (!failed.isEmpty()) {
                        String why = failed.get(0).error() != null ? failed.get(0).error() : "no quote returned";
                        if (mode == Mode.API) {
                                // Alert: an API copy refused because billing could not be checked.
                                log.error("[ai-credit] credit service unavailable for institute {}; API copies refused: {}",
                                                instituteId, why);
                                throw new CreditCheckUnavailableException(why);
                        }
                        log.error("[ai-credit] credit service unavailable for institute {}; dashboard check skipped (fail open): {}",
                                        instituteId, why);
                        return copies.stream().map(c -> reservationFor(quotes.get(c), c, limit)).toList();
                }

                if (mode == Mode.DASHBOARD && !dashboardEnforced) {
                        return copies.stream().map(c -> reservationFor(quotes.get(c), c, limit)).toList();
                }

                // 2. Serialise accepts for this institute until the caller commits.
                requireTransaction();
                jdbc.queryForObject(LOCK_SQL, new MapSqlParameterSource("lockKey", LOCK_KEY_PREFIX + instituteId),
                                Integer.class);

                // 3. What is already promised to queued and running checks.
                BigDecimal committed = jdbc.queryForObject(COMMITTED_SQL,
                                new MapSqlParameterSource("instituteId", instituteId), BigDecimal.class);
                if (committed == null) committed = BigDecimal.ZERO;

                BigDecimal required = BigDecimal.ZERO;
                for (AiEvaluationCharge charge : copies) {
                        required = required.add(quotes.get(charge).credits());
                }
                BigDecimal balance = quotes.values().stream().map(ToolEstimate::currentBalance)
                                .filter(b -> b != null).findFirst().orElse(null);
                if (balance == null) {
                        if (mode == Mode.DASHBOARD) {
                                // No balance row (never initialised): today's dashboard grades anyway.
                                log.info("[ai-credit] institute {} has no credit balance row; dashboard check skipped",
                                                instituteId);
                                return copies.stream().map(c -> reservationFor(quotes.get(c), c, limit)).toList();
                        }
                        balance = BigDecimal.ZERO;
                }

                // 4. Fit?
                BigDecimal available = balance.add(limit).subtract(committed);
                if (available.compareTo(required) < 0) {
                        log.info("[ai-credit] institute {} refused {} copies: required {}, available {} (balance {}, limit {}, committed {})",
                                        instituteId, copies.size(), required, available, balance, limit, committed);
                        throw new InsufficientCreditsException(required, available, balance, limit, committed);
                }
                return copies.stream().map(c -> reservationFor(quotes.get(c), c, limit)).toList();
        }

        /**
         * What the institute's queued and running checks were quoted (no lock): the
         * {@code committed} figure of the partner API's {@code GET /credits} (spec 7.11).
         */
        public BigDecimal committed(String instituteId) {
                if (instituteId == null || instituteId.isBlank()) {
                        return BigDecimal.ZERO;
                }
                BigDecimal committed = jdbc.queryForObject(COMMITTED_SQL,
                                new MapSqlParameterSource("instituteId", instituteId), BigDecimal.class);
                return committed == null ? BigDecimal.ZERO : committed;
        }

        // ---------------------------------------------------------------- dispatch

        /**
         * The second look, right before a claimed process is sent to ai_service. Runs
         * outside any transaction (one HTTP call).
         *
         * @param quotedCredits    the quote stored at accept; null when the row has none
         * @param rateSnapshotJson the snapshot stored at accept (tool, params, credit limit)
         * @param fallbackCharge   how to price a row that has no quote yet (dashboard rows
         *                         queued by a learner's submit); null = do not price it
         * @param apiTraffic       true for partner API rows (api_key_id set)
         */
        public DispatchCheck checkAtDispatch(String instituteId, BigDecimal quotedCredits, String rateSnapshotJson,
                        AiEvaluationCharge fallbackCharge, boolean apiTraffic) {
                Map<String, Object> snapshot = parse(rateSnapshotJson);
                BigDecimal limit = decimal(snapshot.get("credit_limit"));
                if (limit == null || limit.signum() < 0) limit = BigDecimal.ZERO;
                if (instituteId == null || instituteId.isBlank()) {
                        return new DispatchCheck(DispatchVerdict.PROCEED, quotedCredits, null, limit, null);
                }
                AiEvaluationCharge charge = chargeFrom(snapshot);
                if (charge == null) charge = fallbackCharge;
                if (charge == null) {
                        return new DispatchCheck(DispatchVerdict.PROCEED, quotedCredits, null, limit, null);
                }

                ToolEstimate estimate = creditClient.estimate(charge.toolKey(), charge.params(), instituteId, timeout);
                if (!estimate.reachable()) {
                        if (apiTraffic) {
                                log.error("[ai-credit] credit service unavailable at dispatch for institute {}; API copy back to the queue: {}",
                                                instituteId, estimate.error());
                                return new DispatchCheck(DispatchVerdict.UNAVAILABLE, quotedCredits, null, limit, null);
                        }
                        log.warn("[ai-credit] credit service unavailable at dispatch for institute {}; sending anyway (dashboard): {}",
                                        instituteId, estimate.error());
                        return new DispatchCheck(DispatchVerdict.PROCEED, quotedCredits, null, limit, null);
                }

                Reservation newQuote = null;
                BigDecimal quote = quotedCredits;
                if (quote == null && estimate.credits() != null) {
                        quote = estimate.credits();
                        newQuote = reservationFor(estimate, charge, limit);
                }
                BigDecimal balance = estimate.currentBalance();
                if (quote == null || quote.signum() <= 0) {
                        return new DispatchCheck(DispatchVerdict.PROCEED, quote, balance, limit, newQuote);
                }
                if (balance == null) {
                        if (!apiTraffic) {
                                return new DispatchCheck(DispatchVerdict.PROCEED, quote, null, limit, newQuote);
                        }
                        balance = BigDecimal.ZERO;
                }
                if (balance.add(limit).compareTo(quote) < 0 && (apiTraffic || dashboardEnforced)) {
                        return new DispatchCheck(DispatchVerdict.INSUFFICIENT, quote, balance, limit, newQuote);
                }
                return new DispatchCheck(DispatchVerdict.PROCEED, quote, balance, limit, newQuote);
        }

        // ----------------------------------------------------------------- helpers

        /**
         * The snapshot written on the process row: the rate ai_service quoted at (the C4
         * {@code rate_snapshot} fields it returned) plus what this service needs to look
         * again at dispatch - the quote params, the quote and the credit limit in force.
         * {@link #gradeRequestSnapshot} picks the C4 fields back out for ai_service.
         */
        Reservation reservationFor(ToolEstimate estimate, AiEvaluationCharge charge, BigDecimal creditLimit) {
                if (estimate == null) {
                        return Reservation.NONE;
                }
                Map<String, Object> snapshot = new LinkedHashMap<>(estimate.rateSnapshot() != null
                                ? estimate.rateSnapshot() : Map.of());
                snapshot.putIfAbsent("tool_key", charge.toolKey());
                snapshot.put("quote_params", charge.params());
                if (estimate.credits() != null) snapshot.put("quoted_credits", estimate.credits());
                if (creditLimit != null && creditLimit.signum() > 0) snapshot.put("credit_limit", creditLimit);
                String json;
                try {
                        json = objectMapper.writeValueAsString(snapshot);
                } catch (Exception e) {
                        json = null;
                }
                return new Reservation(estimate.credits(), json);
        }

        /** The fields of C4's grade-request {@code rate_snapshot}, in order. */
        static final List<String> GRADE_SNAPSHOT_FIELDS = List.of("tool_key", "flat_base_credits", "per_unit_credits",
                        "unit_field", "params", "rate_source");

        /**
         * The grade request's {@code rate_snapshot} (C4) out of a stored row snapshot, or
         * null when the row does not hold a complete rate (ai_service then prices the copy
         * itself at completion, as it always has).
         */
        public Map<String, Object> gradeRequestSnapshot(String rateSnapshotJson) {
                Map<String, Object> stored = parse(rateSnapshotJson);
                if (stored.get("tool_key") == null || stored.get("unit_field") == null
                                || stored.get("flat_base_credits") == null || stored.get("per_unit_credits") == null) {
                        return null;
                }
                Map<String, Object> out = new LinkedHashMap<>();
                for (String field : GRADE_SNAPSHOT_FIELDS) {
                        if (stored.get(field) != null) out.put(field, stored.get(field));
                }
                out.putIfAbsent("params", Map.of());
                return out;
        }

        @SuppressWarnings("unchecked")
        private AiEvaluationCharge chargeFrom(Map<String, Object> snapshot) {
                Object tool = snapshot.get("tool_key");
                if (!(tool instanceof String toolKey) || toolKey.isBlank()) {
                        return null;
                }
                Object params = snapshot.get("quote_params");
                return new AiEvaluationCharge(toolKey, params instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
        }

        private Map<String, Object> parse(String json) {
                if (json == null || json.isBlank()) {
                        return Map.of();
                }
                try {
                        Map<String, Object> map = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {
                        });
                        return map != null ? map : Map.of();
                } catch (Exception e) {
                        return Map.of();
                }
        }

        private static BigDecimal decimal(Object value) {
                if (value == null) return null;
                try {
                        return new BigDecimal(value.toString());
                } catch (NumberFormatException e) {
                        return null;
                }
        }

        private static List<Reservation> none(int n) {
                List<Reservation> out = new ArrayList<>(n);
                for (int i = 0; i < n; i++) out.add(Reservation.NONE);
                return out;
        }

        /**
         * The lock is transaction-scoped: outside a transaction it would be released the
         * moment it is taken and the check would be a race. A programming error, so loud.
         */
        private static void requireTransaction() {
                if (!TransactionSynchronizationManager.isActualTransactionActive()) {
                        throw new IllegalStateException(
                                        "AI credit reservation must run inside the transaction that inserts the process rows");
                }
        }

        private static List<String> laneNames() {
                return Arrays.stream(AiEvaluationLane.values()).map(Enum::name).toList();
        }

        private static String literals(List<String> values) {
                return values.stream().map(v -> "'" + v.replace("'", "''") + "'").collect(Collectors.joining(", "));
        }
}
