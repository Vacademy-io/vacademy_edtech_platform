package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

/** A copy is written in the pen the institute has set, and a blip must not swap it. */
class CopyPenLookupTest {

    private static final Map<String, Object> SAVED = Map.of(
            "ink", "#6a1fa0", "font", "CEDARVILLE_CURSIVE", "size", "LARGE", "darkness", 70);

    private static CopyCheckOrchestratorService service(AdminCoreServiceClient adminCore) {
        CopyCheckOrchestratorService s = new CopyCheckOrchestratorService(
                null, null, null, null, null, null, null, null, null, null, null, null);;
        ReflectionTestUtils.setField(s, "adminCoreServiceClient", adminCore);
        return s;
    }

    private static CopyCheckGradeRequestDto copy() {
        return CopyCheckGradeRequestDto.builder().answerMode("COPY").build();
    }

    private static CopyCheckOrchestratorService.DispatchFacts facts(String institute, boolean api) {
        return new CopyCheckOrchestratorService.DispatchFacts(false, false, institute, null, null, api, null);
    }

    @Test
    void the_saved_pen_reaches_the_request_whole() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle("pen-a")).thenReturn(SAVED);
        Map<String, Object> pen = service(adminCore).penStyleFor(copy(), facts("pen-a", false));
        assertThat(pen).isEqualTo(SAVED);

        CopyCheckGradeRequestDto dto = copy();
        dto.setPenStyle(pen);
        String json = new ObjectMapper().writeValueAsString(dto);
        assertThat(json).contains("\"pen_style\"").contains("\"darkness\":70").contains("#6a1fa0")
                .contains("CEDARVILLE_CURSIVE");
    }

    @Test
    void a_change_applies_to_the_very_next_copy() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle("pen-b")).thenReturn(SAVED).thenReturn(Map.of("font", "KALAM"));
        CopyCheckOrchestratorService s = service(adminCore);
        assertThat(s.penStyleFor(copy(), facts("pen-b", false))).isEqualTo(SAVED);
        assertThat(s.penStyleFor(copy(), facts("pen-b", false))).isEqualTo(Map.of("font", "KALAM"));
    }

    @Test
    void a_failed_read_keeps_the_pen_last_seen_and_never_fails_the_check() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle("pen-c")).thenReturn(SAVED)
                .thenThrow(new IllegalStateException("admin-core down"));
        CopyCheckOrchestratorService s = service(adminCore);
        s.penStyleFor(copy(), facts("pen-c", false));
        assertThat(s.penStyleFor(copy(), facts("pen-c", false))).isEqualTo(SAVED);
    }

    @Test
    void removing_the_pen_is_not_undone_by_a_later_failure() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle("pen-d")).thenReturn(null)
                .thenThrow(new IllegalStateException("admin-core down"));
        CopyCheckOrchestratorService s = service(adminCore);
        assertThat(s.penStyleFor(copy(), facts("pen-d", false))).isNull();
        assertThat(s.penStyleFor(copy(), facts("pen-d", false))).isNull();
    }

    @Test
    void an_institute_never_seen_gets_the_usual_pen_when_the_read_fails() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle(anyString())).thenThrow(new IllegalStateException("down"));
        assertThat(service(adminCore).penStyleFor(copy(), facts("pen-e", false))).isNull();
    }

    @Test
    void partner_api_and_typed_answers_never_take_the_pen() throws Exception {
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.readAiCopyPenStyle(anyString())).thenReturn(SAVED);
        CopyCheckOrchestratorService s = service(adminCore);
        assertThat(s.penStyleFor(copy(), facts("pen-f", true))).isNull();
        CopyCheckGradeRequestDto typed = CopyCheckGradeRequestDto.builder().answerMode("TYPED").build();
        assertThat(s.penStyleFor(typed, facts("pen-f", false))).isNull();
    }
}
