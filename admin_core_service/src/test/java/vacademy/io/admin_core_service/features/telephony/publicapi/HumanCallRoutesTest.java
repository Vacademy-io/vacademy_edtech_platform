package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Every human-call route authenticates with the scope it needs before touching the service
 * (reads: calls:read, anything that dials or writes: calls:write), and the catch-all route
 * knows the new paths (405 for a wrong method, not 404).
 */
class HumanCallRoutesTest {

    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal("inst-1", "key-1", List.of("human_calls:read", "human_calls:write"));

    private final List<String> scopes = new ArrayList<>();
    private final AiCallingApiAuth auth = mock(AiCallingApiAuth.class);
    private final HumanCallApiService humanCalls = mock(HumanCallApiService.class);
    private final PublicAiCallingApiController controller =
            new PublicAiCallingApiController(auth, null, null, null, humanCalls);

    HumanCallRoutesTest() {
        when(auth.authenticate(any(), any())).thenAnswer(i -> {
            scopes.add(i.getArgument(1));
            return P;
        });
        when(auth.authenticateAny(any(), any(String[].class))).thenAnswer(i -> {
            List<String> any = new ArrayList<>();
            for (int k = 1; k < i.getArguments().length; k++) {
                Object a = i.getArguments()[k];
                if (a instanceof String[] arr) any.addAll(List.of(arr));
                else any.add((String) a);
            }
            scopes.add(String.join("|", any));
            return P;
        });
        when(humanCalls.createHumanCall(any(), any(), any())).thenReturn(Map.of("id", "hcall_1"));
        when(humanCalls.listHumanCalls(any(), any(), any(), any(), any(), any(), any(), anyInt(), any()))
                .thenReturn(Map.of("object", "list"));
        when(humanCalls.getHumanCall(any(), any())).thenReturn(Map.of("id", "hcall_1"));
        when(humanCalls.setDisposition(any(), any(), any(), any())).thenReturn(Map.of("id", "hcall_1"));
        when(humanCalls.listDispositions(any())).thenReturn(Map.of("object", "list"));
        when(humanCalls.listCounsellors(any())).thenReturn(Map.of("object", "list"));
    }

    @Test
    void eachRouteAsksForItsScope() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        PublicAiCallingApiController.HumanCallBody body = new PublicAiCallingApiController.HumanCallBody();
        body.setCounsellorId("c-1");
        body.setPhoneNumber("+919876543210");
        assertEquals(HttpStatus.CREATED, controller.createHumanCall(r, "k", body).getStatusCode());
        controller.listHumanCalls(r, null, null, null, null, "2026-10-01T00:00:00Z", null, 25, null);
        controller.getHumanCall(r, "hcall_1");
        PublicAiCallingApiController.DispositionBody d = new PublicAiCallingApiController.DispositionBody();
        d.setKey("INTERESTED");
        controller.setDisposition(r, "hcall_1", d);
        controller.dispositions(r);
        controller.counsellors(r);
        // Human calls have their own scopes: calls:read / calls:write alone never reach them.
        // GET /counsellors also accepts counsellors:manage (v1.3).
        assertEquals(List.of("human_calls:write", "human_calls:read", "human_calls:read", "human_calls:write",
                "human_calls:read", "human_calls:read|counsellors:manage"), scopes);
    }

    @Test
    void aReplayAnswers200() {
        when(humanCalls.createHumanCall(any(), any(), any())).thenReturn(Map.of("id", "hcall_1", "idempotent_replay", true));
        PublicAiCallingApiController.HumanCallBody body = new PublicAiCallingApiController.HumanCallBody();
        assertEquals(HttpStatus.OK, controller.createHumanCall(new MockHttpServletRequest(), "k", body).getStatusCode());
    }

    @Test
    void aMissingScopeStopsTheRequestBeforeTheService() {
        when(auth.authenticate(any(), eq("human_calls:write"))).thenThrow(new AiCallingApiException(HttpStatus.FORBIDDEN,
                "insufficient_scope", "no"));
        assertThrows(AiCallingApiException.class, () -> controller.createHumanCall(new MockHttpServletRequest(), null,
                new PublicAiCallingApiController.HumanCallBody()));
        verify(humanCalls, never()).createHumanCall(any(), any(), any());
    }

    @Test
    void badDatesAreA400() {
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> controller.listHumanCalls(
                new MockHttpServletRequest(), null, null, null, null, null, "yesterday", 25, null));
        assertEquals("invalid_request", e.getCode());
    }

    @Test
    void theFallbackKnowsTheNewPaths() {
        for (String path : List.of("/human-calls", "/human-calls/hcall_1", "/human-calls/hcall_1/disposition",
                "/counsellors", "/dispositions")) {
            MockHttpServletRequest r = new MockHttpServletRequest("DELETE", "/admin-core-service/open/ai-calling/v1" + path);
            AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> controller.fallback(r));
            assertEquals("method_not_allowed", e.getCode(), path);
        }
        MockHttpServletRequest r = new MockHttpServletRequest("GET", "/admin-core-service/open/ai-calling/v1/human-calls/x/y");
        assertEquals("not_found", assertThrows(AiCallingApiException.class, () -> controller.fallback(r)).getCode());
    }
}
