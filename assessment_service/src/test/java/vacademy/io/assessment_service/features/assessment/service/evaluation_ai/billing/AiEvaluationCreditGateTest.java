package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient.ToolEstimate;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.DispatchCheck;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.DispatchVerdict;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.Mode;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate.Reservation;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Credit check for AI evaluation (10.6, gate G10). The SQL needs Postgres, so this
 * pins its shape and the arithmetic around it: quote before the lock, lock then
 * committed, available = balance + limit - committed, dashboard open / API closed.
 */
class AiEvaluationCreditGateTest {

        private AiServiceCreditClient client;
        private NamedParameterJdbcTemplate jdbc;
        private AiEvaluationCreditGate gate;
        private final ObjectMapper json = new ObjectMapper();

        @BeforeEach
        void setUp() {
                client = mock(AiServiceCreditClient.class);
                jdbc = mock(NamedParameterJdbcTemplate.class);
                gate = new AiEvaluationCreditGate(client, jdbc, json, Duration.ofSeconds(2));
                TransactionSynchronizationManager.setActualTransactionActive(true);
        }

        @AfterEach
        void tearDown() {
                TransactionSynchronizationManager.setActualTransactionActive(false);
        }

        private static ToolEstimate quote(String credits, String balance) {
                Map<String, Object> snapshot = new LinkedHashMap<>();
                snapshot.put("tool_key", "copy_check_evaluation");
                snapshot.put("unit_field", "questions");
                return new ToolEstimate(true, new BigDecimal(credits), balance == null ? null : new BigDecimal(balance),
                                null, snapshot, null);
        }

        private void quotes(ToolEstimate estimate) {
                when(client.estimate(anyString(), anyMap(), anyString(), any(Duration.class))).thenReturn(estimate);
        }

        private void committed(String value) {
                when(jdbc.queryForObject(eq(AiEvaluationCreditGate.COMMITTED_SQL), any(SqlParameterSource.class),
                                eq(BigDecimal.class))).thenReturn(new BigDecimal(value));
        }

        // ------------------------------------------------------------------ SQL shape

        @Test
        void theLockIsATransactionScopedAdvisoryLockPerInstitute() {
                assertThat(AiEvaluationCreditGate.LOCK_SQL).contains("pg_advisory_xact_lock(hashtext(:lockKey))");
                quotes(quote("3", "100"));
                committed("0");

                gate.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(10)), BigDecimal.ZERO, Mode.DASHBOARD);

                ArgumentCaptor<SqlParameterSource> params = ArgumentCaptor.forClass(SqlParameterSource.class);
                verify(jdbc).queryForObject(eq(AiEvaluationCreditGate.LOCK_SQL), params.capture(), eq(Integer.class));
                assertThat(((MapSqlParameterSource) params.getValue()).getValue("lockKey")).isEqualTo("ai_credit:inst-1");
        }

        @Test
        void committedSumsTheQuotesOfEveryQueuedAndRunningCheckOfTheInstitute() {
                String sql = AiEvaluationCreditGate.COMMITTED_SQL;
                assertThat(sql).contains("SUM(c.q)").contains("p.institute_id = :instituteId")
                                .contains("p.status = 'PENDING'").contains("'COPY'").contains("'TYPED'");
                for (String status : AiEvaluationStatusEnum.ACTIVE) {
                        assertThat(sql).contains("'" + status + "'");
                }
                assertThat(sql).doesNotContain("'COMPLETED'").doesNotContain("'FAILED'").doesNotContain("'CANCELLED'");
        }

        // ------------------------------------------------------------------ prequote

        @Test
        void aPrequoteTakenBeforeTheTransactionIsUsedWithoutAskingAgain() {
                quotes(quote("28", "100"));
                committed("0");
                TransactionSynchronizationManager.setActualTransactionActive(false);
                AiEvaluationCreditGate.Prequote early = gate.prequote("inst-1",
                                List.of(AiEvaluationCharge.apiHandwritten(28)));
                verify(client, times(1)).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
                TransactionSynchronizationManager.setActualTransactionActive(true);

                List<Reservation> r = gate.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(28)),
                                BigDecimal.ZERO, Mode.API, early);

                assertThat(r.get(0).quotedCredits()).isEqualByComparingTo("28");
                verify(client, times(1)).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
        }

        @Test
        void aPrequoteForAnotherChargeOrInstituteIsIgnored() {
                quotes(quote("12", "100"));
                committed("0");
                AiEvaluationCreditGate.Prequote early = gate.prequote("inst-1",
                                List.of(AiEvaluationCharge.apiHandwritten(28)));

                gate.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(12)), BigDecimal.ZERO, Mode.API, early);
                gate.reserve("inst-2", List.of(AiEvaluationCharge.apiHandwritten(28)), BigDecimal.ZERO, Mode.API, early);

                verify(client, times(3)).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
        }

        @Test
        void aFailedPrequoteRefusesAnApiCopyWithoutASecondWait() {
                quotes(ToolEstimate.unreachable("timeout"));
                AiEvaluationCreditGate.Prequote early = gate.prequote("inst-1",
                                List.of(AiEvaluationCharge.apiHandwritten(28)));

                assertThatThrownBy(() -> gate.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(28)),
                                BigDecimal.ZERO, Mode.API, early)).isInstanceOf(CreditCheckUnavailableException.class);
                verify(client, times(1)).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
        }

        // ------------------------------------------------------------------ accept

        @Test
        void copiesThatFitAreReservedAtTheirQuoteAndOnePriceIsQuotedOnce() throws Exception {
                quotes(quote("3", "100"));
                committed("40");
                AiEvaluationCharge charge = AiEvaluationCharge.dashboard(10);

                List<Reservation> reserved = gate.reserve("inst-1", List.of(charge, charge, charge), BigDecimal.ZERO,
                                Mode.DASHBOARD);

                assertThat(reserved).hasSize(3).allSatisfy(r -> assertThat(r.quotedCredits()).isEqualByComparingTo("3"));
                verify(client, times(1)).estimate(eq("copy_check_evaluation"), eq(Map.of("num_questions", 10)),
                                eq("inst-1"), any(Duration.class));
                Map<?, ?> snapshot = json.readValue(reserved.get(0).rateSnapshotJson(), Map.class);
                assertThat(snapshot.get("tool_key")).isEqualTo("copy_check_evaluation");
                assertThat(snapshot.get("quote_params")).isEqualTo(Map.of("num_questions", 10));
                assertThat(snapshot.containsKey("credit_limit")).isFalse();
        }

        @Test
        void exactlyEnoughIsEnoughButOneCreditShortIsNot() {
                quotes(quote("3", "10"));
                committed("4");
                // 10 - 4 = 6 available, 2 x 3 = 6 required: fits.
                assertThat(gate.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(1), AiEvaluationCharge.dashboard(1)),
                                BigDecimal.ZERO, Mode.DASHBOARD)).hasSize(2);

                committed("5");
                assertThatThrownBy(() -> gate.reserve("inst-1",
                                List.of(AiEvaluationCharge.dashboard(1), AiEvaluationCharge.dashboard(1)),
                                BigDecimal.ZERO, Mode.DASHBOARD))
                                .isInstanceOfSatisfying(InsufficientCreditsException.class, e -> {
                                        assertThat(e.getStatus().value()).isEqualTo(402);
                                        assertThat(e.getCode()).isEqualTo("insufficient_credits");
                                        assertThat(e.getMessage()).contains("needs 6 credits").contains("5 are available");
                                        assertThat(e.getRequired()).isEqualByComparingTo("6");
                                        assertThat(e.getAvailable()).isEqualByComparingTo("5");
                                        assertThat(e.getBalance()).isEqualByComparingTo("10");
                                        assertThat(e.getCommitted()).isEqualByComparingTo("5");
                                        assertThat(e.getCreditLimit()).isEqualByComparingTo("0");
                                });
        }

        @Test
        void aContractCreditLimitExtendsWhatIsAvailableAndTravelsInTheSnapshot() throws Exception {
                quotes(quote("12", "0"));
                committed("0");

                List<Reservation> reserved = gate.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(12)),
                                new BigDecimal("500"), Mode.API);

                assertThat(reserved.get(0).quotedCredits()).isEqualByComparingTo("12");
                Map<?, ?> snapshot = json.readValue(reserved.get(0).rateSnapshotJson(), Map.class);
                assertThat(new BigDecimal(snapshot.get("credit_limit").toString())).isEqualByComparingTo("500");
                verify(client).estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 12)), eq("inst-1"),
                                any(Duration.class));
        }

        @Test
        void theDashboardFailsOpenWhenTheCreditServiceCannotAnswer() {
                quotes(ToolEstimate.unreachable("401 Unauthorized"));

                List<Reservation> reserved = gate.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(10)),
                                BigDecimal.ZERO, Mode.DASHBOARD);

                assertThat(reserved).hasSize(1);
                assertThat(reserved.get(0).quotedCredits()).isNull();
                verify(jdbc, never()).queryForObject(eq(AiEvaluationCreditGate.LOCK_SQL), any(SqlParameterSource.class),
                                eq(Integer.class));
        }

        @Test
        void apiTrafficFailsClosedWhenTheCreditServiceCannotAnswer() {
                quotes(ToolEstimate.unreachable("timeout"));

                assertThatThrownBy(() -> gate.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(3)),
                                BigDecimal.ZERO, Mode.API))
                                .isInstanceOfSatisfying(CreditCheckUnavailableException.class, e -> {
                                        assertThat(e.getStatus().value()).isEqualTo(503);
                                        assertThat(e.getCode()).isEqualTo("engine_unavailable");
                                        assertThat(e.getRetryAfterSeconds()).isEqualTo(30);
                                });
        }

        @Test
        void anInstituteWithNoBalanceRowGradesOnTheDashboardButNotOnTheApi() {
                quotes(quote("3", null));
                committed("0");

                assertThat(gate.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(10)), BigDecimal.ZERO,
                                Mode.DASHBOARD)).hasSize(1);
                assertThatThrownBy(() -> gate.reserve("inst-1", List.of(AiEvaluationCharge.apiTyped(3)), BigDecimal.ZERO,
                                Mode.API)).isInstanceOf(InsufficientCreditsException.class);
                // ... unless its contract allows an overdraft.
                assertThat(gate.reserve("inst-1", List.of(AiEvaluationCharge.apiTyped(3)), BigDecimal.TEN, Mode.API))
                                .hasSize(1);
        }

        @Test
        void outsideATransactionTheLockWouldBeUselessSoItRefusesToRun() {
                TransactionSynchronizationManager.setActualTransactionActive(false);
                quotes(quote("3", "100"));

                assertThatThrownBy(() -> gate.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(10)),
                                BigDecimal.ZERO, Mode.DASHBOARD)).isInstanceOf(IllegalStateException.class);
        }

        @Test
        void nothingToQueueAsksNobody() {
                assertThat(gate.reserve("inst-1", List.of(), BigDecimal.ZERO, Mode.API)).isEmpty();
                verify(client, never()).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
        }

        @Test
        void theDashboardKillSwitchStillQuotesButNeverRefusesWhileTheApiStaysEnforced() {
                AiEvaluationCreditGate relaxed = new AiEvaluationCreditGate(client, jdbc, json, Duration.ofSeconds(2), false);
                quotes(quote("3", "0"));
                committed("0");

                List<Reservation> reserved = relaxed.reserve("inst-1", List.of(AiEvaluationCharge.dashboard(10)),
                                BigDecimal.ZERO, Mode.DASHBOARD);
                assertThat(reserved.get(0).quotedCredits()).isEqualByComparingTo("3");
                assertThat(relaxed.checkAtDispatch("inst-1", new BigDecimal("3"), null, AiEvaluationCharge.dashboard(10),
                                false).verdict()).isEqualTo(DispatchVerdict.PROCEED);

                assertThatThrownBy(() -> relaxed.reserve("inst-1", List.of(AiEvaluationCharge.apiHandwritten(3)),
                                BigDecimal.ZERO, Mode.API)).isInstanceOf(InsufficientCreditsException.class);
                assertThat(relaxed.checkAtDispatch("inst-1", new BigDecimal("3"), null, AiEvaluationCharge.dashboard(10),
                                true).verdict()).isEqualTo(DispatchVerdict.INSUFFICIENT);
        }

        // ------------------------------------------------------------- snapshot

        @Test
        void theGradeRequestGetsTheC4RateOnlyWhenTheRowHoldsACompleteOne() throws Exception {
                String partial = json.writeValueAsString(Map.of("tool_key", "copy_check_evaluation_api",
                                "unit_field", "pages", "quote_params", Map.of("num_pages", 4)));
                assertThat(gate.gradeRequestSnapshot(partial)).isNull();
                assertThat(gate.gradeRequestSnapshot(null)).isNull();

                Map<String, Object> full = new LinkedHashMap<>();
                full.put("tool_key", "copy_check_evaluation_api");
                full.put("flat_base_credits", 0);
                full.put("per_unit_credits", 1);
                full.put("unit_field", "pages");
                full.put("params", Map.of("fixed_price", true, "typed_per_answer", 1));
                full.put("rate_source", "override:abc");
                full.put("quote_params", Map.of("num_pages", 4));
                full.put("credit_limit", 500);
                Map<String, Object> sent = gate.gradeRequestSnapshot(json.writeValueAsString(full));

                assertThat(sent).containsOnlyKeys("tool_key", "flat_base_credits", "per_unit_credits", "unit_field",
                                "params", "rate_source");
                assertThat(sent.get("rate_source")).isEqualTo("override:abc");
        }

        // ------------------------------------------------------------- dispatch

        @Test
        void atDispatchABalanceThatNoLongerCoversTheQuoteFailsIt() throws Exception {
                quotes(quote("3", "2"));
                String snapshot = json.writeValueAsString(Map.of("tool_key", "copy_check_evaluation",
                                "quote_params", Map.of("num_questions", 10)));

                DispatchCheck check = gate.checkAtDispatch("inst-1", new BigDecimal("3"), snapshot, null, false);

                assertThat(check.verdict()).isEqualTo(DispatchVerdict.INSUFFICIENT);
                assertThat(check.newQuote()).isNull();
                verify(client).estimate(eq("copy_check_evaluation"), eq(Map.of("num_questions", 10)), eq("inst-1"),
                                any(Duration.class));
        }

        @Test
        void atDispatchTheCreditLimitFromAcceptStillCounts() throws Exception {
                quotes(quote("12", "-100"));
                String snapshot = json.writeValueAsString(Map.of("tool_key", "copy_check_evaluation_api",
                                "quote_params", Map.of("num_pages", 12), "credit_limit", 500));

                assertThat(gate.checkAtDispatch("inst-1", new BigDecimal("12"), snapshot, null, true).verdict())
                                .isEqualTo(DispatchVerdict.PROCEED);
        }

        @Test
        void atDispatchAnUnreachableCreditServiceSendsADashboardCopyAndRequeuesAnApiOne() {
                quotes(ToolEstimate.unreachable("503"));

                assertThat(gate.checkAtDispatch("inst-1", BigDecimal.ONE, null, AiEvaluationCharge.dashboard(1), false)
                                .verdict()).isEqualTo(DispatchVerdict.PROCEED);
                assertThat(gate.checkAtDispatch("inst-1", BigDecimal.ONE, null, AiEvaluationCharge.dashboard(1), true)
                                .verdict()).isEqualTo(DispatchVerdict.UNAVAILABLE);
        }

        @Test
        void aRowQueuedWithoutAQuoteIsPricedAtDispatchAndTheQuoteHandedBack() {
                quotes(quote("5", "100"));

                DispatchCheck check = gate.checkAtDispatch("inst-1", null, null, AiEvaluationCharge.dashboard(20), false);

                assertThat(check.verdict()).isEqualTo(DispatchVerdict.PROCEED);
                assertThat(check.newQuote()).isNotNull();
                assertThat(check.newQuote().quotedCredits()).isEqualByComparingTo("5");
                assertThat(check.newQuote().rateSnapshotJson()).contains("\"num_questions\":20");
        }

        @Test
        void aRowWithNothingToPriceItByIsSentWithoutAsking() {
                DispatchCheck check = gate.checkAtDispatch("inst-1", null, null, null, false);

                assertThat(check.verdict()).isEqualTo(DispatchVerdict.PROCEED);
                verify(client, never()).estimate(anyString(), anyMap(), anyString(), any(Duration.class));
        }
}
