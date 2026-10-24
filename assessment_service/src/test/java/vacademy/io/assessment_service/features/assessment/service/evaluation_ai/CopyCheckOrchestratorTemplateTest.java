package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The checked-copy template chosen at dispatch. The usual copy (null on the
 * request) must be what every copy gets unless an assessment or institute asked
 * otherwise, and a slow admin-core must never hold a dispatch.
 */
class CopyCheckOrchestratorTemplateTest {

    private static CopyCheckOrchestratorService service(AdminCoreServiceClient adminCore) {
        CopyCheckOrchestratorService s = new CopyCheckOrchestratorService(
                null, null, null, null, null, null, null, null, null, null, null, null);
        ReflectionTestUtils.setField(s, "adminCoreServiceClient", adminCore);
        return s;
    }

    private static CopyCheckOrchestratorService.DispatchFacts facts(boolean api) {
        return new CopyCheckOrchestratorService.DispatchFacts(false, false, "inst-1", null, null, api, null);
    }

    private static String placementFor(CopyCheckOrchestratorService s, String answerMode, String onAssessment,
                                       boolean api) {
        CopyCheckGradeRequestDto request = CopyCheckGradeRequestDto.builder()
                .answerMode(answerMode).commentPlacement(onAssessment).build();
        return ReflectionTestUtils.invokeMethod(s, "commentPlacementFor", request, facts(api));
    }

    @Test
    void no_choice_anywhere_sends_the_request_unchanged() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCommentPlacement("inst-1")).thenReturn("");
        assertThat(placementFor(service(adminCore), "COPY", null, false)).isNull();
        // And with no admin-core client at all (unit wiring), the same.
        assertThat(placementFor(service(null), "COPY", null, false)).isNull();
    }

    @Test
    void institute_default_applies_to_dashboard_copies_only() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCommentPlacement("inst-1")).thenReturn("OUTSIDE");
        CopyCheckOrchestratorService s = service(adminCore);

        assertThat(placementFor(s, "COPY", null, false)).isEqualTo("OUTSIDE");
        assertThat(placementFor(s, "COPY", "INSIDE", false)).isNull();     // the assessment's choice wins
        assertThat(placementFor(s, "TYPED", null, false)).isNull();        // no copy to lay out
        assertThat(placementFor(s, "COPY", null, true)).isNull();          // partner API traffic
    }

    @Test
    void partner_api_and_typed_never_ask_admin_core() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        CopyCheckOrchestratorService s = service(adminCore);
        placementFor(s, "COPY", null, true);
        placementFor(s, "TYPED", null, false);
        verify(adminCore, never()).getAiCopyCommentPlacement(any());
    }

    @Test
    void a_hanging_admin_core_costs_a_dispatch_seconds_not_its_timeout() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCommentPlacement("inst-1")).thenAnswer(inv -> {
            Thread.sleep(10_000);
            return "OUTSIDE";
        });
        long started = System.nanoTime();
        String placement = placementFor(service(adminCore), "COPY", null, false);
        long tookMs = (System.nanoTime() - started) / 1_000_000;

        assertThat(placement).isNull();          // the usual copy
        assertThat(tookMs).isLessThan(5_000);    // waited ~3 s, not 10
    }

    @Test
    void a_failing_admin_core_is_the_usual_copy() {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.getAiCopyCommentPlacement("inst-1")).thenThrow(new IllegalStateException("down"));
        assertThat(placementFor(service(adminCore), "COPY", null, false)).isNull();
    }
}
