package vacademy.io.assessment_service.features.open_evaluation.credits;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.upload.EvalApiUploadStore;
import vacademy.io.assessment_service.features.open_evaluation.upload.OpenUploadService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OpenCreditsServiceTest {

    private AiServiceCreditClient client;
    private AiEvaluationCreditGate gate;
    private EvalApiUploadStore uploads;
    private OpenCreditsService service;
    private final ApiKeyPrincipal key = OpenFixtures.key().toBuilder().creditLimit(new BigDecimal("1000")).build();

    @BeforeEach
    void setUp() {
        client = mock(AiServiceCreditClient.class);
        gate = mock(AiEvaluationCreditGate.class);
        uploads = mock(EvalApiUploadStore.class);
        service = new OpenCreditsService(client, gate, uploads, mock(OpenUploadService.class),
                mock(NamedParameterJdbcTemplate.class));
        when(gate.committed("inst-1")).thenReturn(new BigDecimal("2700"));
    }

    private static AiServiceCreditClient.ToolEstimate estimate(String credits, String rateSource, Map<String, Object> params) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("tool_key", "copy_check_evaluation_api");
        snapshot.put("unit_field", "pages");
        snapshot.put("per_unit_credits", 1);
        snapshot.put("rate_source", rateSource);
        if (params != null) {
            snapshot.put("params", params);
        }
        return new AiServiceCreditClient.ToolEstimate(true, new BigDecimal(credits), new BigDecimal("18420.5"), true,
                snapshot, null);
    }

    @Test
    void credits_show_balance_limit_committed_available_and_the_rate_card() {
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 1)), eq("inst-1")))
                .thenReturn(estimate("1", "override:abc", Map.of("fixed_price", true, "typed_per_answer", 1)));

        Map<String, Object> out = service.credits(key);

        assertThat(out.get("balance")).isEqualTo(new BigDecimal("18420.5"));
        assertThat(out.get("credit_limit")).isEqualTo(1000L);
        assertThat(out.get("committed")).isEqualTo(2700L);
        assertThat(out.get("available")).isEqualTo(new BigDecimal("16720.5"));
        @SuppressWarnings("unchecked")
        Map<String, Object> card = (Map<String, Object>) out.get("rate_card");
        assertThat(card).containsEntry("tool", "copy_check_evaluation_api").containsEntry("unit", "page")
                .containsEntry("credits_per_page", 1L).containsEntry("typed_credits_per_answer", 1)
                .containsEntry("fixed_price", true).containsEntry("rate_source", "contract");
        assertThat(card.toString()).doesNotContain("abc");
    }

    @Test
    void an_unreachable_credit_service_is_503() {
        when(client.estimate(anyString(), any(), anyString())).thenReturn(AiServiceCreditClient.ToolEstimate.unreachable("401"));
        assertThatThrownBy(() -> service.credits(key))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.ENGINE_UNAVAILABLE));
    }

    @Test
    void quote_by_pages_and_typed_answers() {
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 3600)), eq("inst-1")))
                .thenReturn(estimate("3600", "global", null));
        SubmissionInputs.Quote q = new SubmissionInputs.Quote();
        q.setPages(3600L);

        Map<String, Object> out = service.quote(key, q);

        assertThat(out).containsEntry("unit", "page").containsEntry("credits_per_page", 1L).containsEntry("pages", 3600L)
                .containsEntry("total", 3600L).containsEntry("sufficient", true).containsEntry("rate_source", "standard");
        assertThat(out.get("note")).asString().contains("Fixed price");

        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("answer_mode", "TYPED", "num_answers", 900)),
                eq("inst-1"))).thenReturn(estimate("900", "global", null));
        SubmissionInputs.Quote typed = new SubmissionInputs.Quote();
        typed.setTypedAnswers(900L);
        assertThat(service.quote(key, typed)).containsEntry("unit", "answer").containsEntry("total", 900L);
    }

    @Test
    void quote_by_uploads_uses_their_exact_page_counts() {
        Instant now = Instant.now();
        when(uploads.findByIds(eq("inst-1"), anyCollection())).thenReturn(List.of(
                new EvalApiUploadStore.UploadRow("u1", "inst-1", "key-1", "f1", "a.pdf", "application/pdf", 10, null, 12,
                        "ready", null, null, now, now, now, now),
                new EvalApiUploadStore.UploadRow("u2", "inst-1", "key-1", "f2", "b.pdf", "application/pdf", 10, null, 9,
                        "ready", null, null, now, now, now, now)));
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 21)), eq("inst-1")))
                .thenReturn(estimate("21", "global", null));
        SubmissionInputs.Quote q = new SubmissionInputs.Quote();
        q.setUploadIds(List.of("u1", "u2"));

        assertThat(service.quote(key, q)).containsEntry("pages", 21L).containsEntry("total", 21L);

        q.setUploadIds(List.of("u1", "ghost"));
        assertThatThrownBy(() -> service.quote(key, q))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.UPLOAD_NOT_FOUND));
    }

    @Test
    void exactly_one_quote_input() {
        SubmissionInputs.Quote none = new SubmissionInputs.Quote();
        assertThatThrownBy(() -> service.quote(key, none)).isInstanceOf(OpenApiException.class);
        SubmissionInputs.Quote two = new SubmissionInputs.Quote();
        two.setPages(1L);
        two.setTypedAnswers(1L);
        assertThatThrownBy(() -> service.quote(key, two)).isInstanceOf(OpenApiException.class);
        SubmissionInputs.Quote zero = new SubmissionInputs.Quote();
        zero.setPages(0L);
        assertThatThrownBy(() -> service.quote(key, zero)).isInstanceOf(OpenApiException.class);
    }

    @Test
    void insufficient_when_the_quote_exceeds_what_is_available() {
        when(gate.committed("inst-1")).thenReturn(new BigDecimal("19000"));
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 400)), eq("inst-1")))
                .thenReturn(estimate("400", "global", null));
        SubmissionInputs.Quote q = new SubmissionInputs.Quote();
        q.setPages(400L);
        Map<String, Object> out = service.quote(key, q);
        assertThat(out).containsEntry("sufficient", true);

        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 500)), eq("inst-1")))
                .thenReturn(estimate("500", "global", null));
        q.setPages(500L);
        assertThat(service.quote(key, q)).containsEntry("sufficient", false);
    }

    @Test
    void exam_create_quote_gives_the_unit_rate_with_a_short_timeout() {
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("num_pages", 1)), eq("inst-1"),
                eq(OpenCreditsService.EXAM_RATE_TIMEOUT))).thenReturn(estimate("1.5", "override:abc", null));
        when(client.estimate(eq("copy_check_evaluation_api"), eq(Map.of("answer_mode", "TYPED", "num_answers", 1)),
                eq("inst-1"), eq(OpenCreditsService.EXAM_RATE_TIMEOUT))).thenReturn(estimate("2", "default", null));

        assertThat(service.examRate(key, false)).containsExactly(
                Map.entry("unit", "page"), Map.entry("credits_per_page", new BigDecimal("1.5")),
                Map.entry("rate_source", "contract"));
        assertThat(service.examRate(key, true)).containsExactly(
                Map.entry("unit", "answer"), Map.entry("credits_per_answer", 2L),
                Map.entry("rate_source", "standard"));
    }

    @Test
    void exam_create_quote_is_omitted_when_the_credit_service_is_slow_or_down() {
        when(client.estimate(anyString(), any(), anyString(), any(java.time.Duration.class)))
                .thenReturn(AiServiceCreditClient.ToolEstimate.unreachable("timeout"));
        assertThat(service.examRate(key, false)).isNull();

        when(client.estimate(anyString(), any(), anyString(), any(java.time.Duration.class)))
                .thenThrow(new IllegalStateException("boom"));
        assertThat(service.examRate(key, true)).isNull();
    }
}
