package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Every v1.3 management route authenticates with its scope before touching a service
 * (writes: counsellors:manage / agents:manage; reads: calls:read, or for a counsellor
 * human_calls:read OR counsellors:manage), and the catch-all knows the new paths.
 */
class AiCallingManagementRoutesTest {

    private static final AiCallingApiAuth.Principal P = new AiCallingApiAuth.Principal("inst-1", "key-1",
            List.of("calls:read", "counsellors:manage", "agents:manage"));
    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<String> scopes = new ArrayList<>();
    private final AiCallingApiAuth auth = mock(AiCallingApiAuth.class);
    private final CounsellorApiService counsellors = mock(CounsellorApiService.class);
    private final AgentApiService agents = mock(AgentApiService.class);
    private final InboundNumberApiService numbers = mock(InboundNumberApiService.class);
    private final PublicAiCallingManagementController controller =
            new PublicAiCallingManagementController(auth, counsellors, agents, numbers);

    AiCallingManagementRoutesTest() {
        when(auth.authenticate(any(), any())).thenAnswer(i -> {
            scopes.add(i.getArgument(1));
            return P;
        });
        when(auth.authenticateAny(any(), any(String[].class))).thenAnswer(i -> {
            Object[] args = i.getArguments();
            List<String> any = new ArrayList<>();
            for (int k = 1; k < args.length; k++) {
                if (args[k] instanceof String[] arr) any.addAll(List.of(arr));
                else any.add((String) args[k]);
            }
            scopes.add(String.join("|", any));
            return P;
        });
        Map<String, Object> body = new LinkedHashMap<>(Map.of("id", "x"));
        when(counsellors.createCounsellor(any(), any(), any())).thenReturn(new ApiIdempotencyStore.Outcome(body, false, true));
        when(counsellors.getCounsellor(any(), any())).thenReturn(body);
        when(counsellors.patchCounsellor(any(), any(), any())).thenReturn(body);
        when(counsellors.deactivateCounsellor(any(), any())).thenReturn(body);
        when(agents.createAgent(any(), any(), any())).thenReturn(new ApiIdempotencyStore.Outcome(body, false, true));
        when(agents.getAgent(any(), any())).thenReturn(body);
        when(agents.patchAgent(any(), any(), any(), any())).thenReturn(body);
        when(agents.setEnabled(any(), any(), anyBoolean())).thenReturn(body);
        when(agents.deleteAgent(any(), any())).thenReturn(body);
        when(agents.voices()).thenReturn(body);
        when(agents.getDefaultAgent(any())).thenReturn(body);
        when(agents.setDefaultAgent(any(), any())).thenReturn(body);
        when(numbers.listNumbers(any())).thenReturn(body);
        when(numbers.setNumberAgent(any(), any(), any())).thenReturn(body);
    }

    private static JsonNode json(String s) {
        try {
            return JSON.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void eachRouteAsksForItsScope() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        PublicAiCallingManagementController.CounsellorBody c = new PublicAiCallingManagementController.CounsellorBody();
        c.setName("Asha");
        c.setEmail("asha@school.in");
        assertEquals(HttpStatus.CREATED, controller.createCounsellor(r, "k", c).getStatusCode());
        controller.getCounsellor(r, "u-1");
        controller.patchCounsellor(r, "u-1", json("{\"name\":\"A\"}"));
        controller.deactivateCounsellor(r, "u-1");
        assertEquals(HttpStatus.CREATED, controller.createAgent(r, null, json("{\"name\":\"x\"}")).getStatusCode());
        controller.getAgent(r, "a-1");
        controller.patchAgent(r, "a-1", null, json("{\"pace\":1.1}"));
        controller.enableAgent(r, "a-1");
        controller.disableAgent(r, "a-1");
        controller.deleteAgent(r, "a-1");
        controller.voices(r);
        controller.getDefaultAgent(r);
        controller.setDefaultAgent(r, new PublicAiCallingManagementController.AgentRefBody());
        controller.listNumbers(r);
        controller.setNumberAgent(r, "n-1", new PublicAiCallingManagementController.AgentRefBody());
        assertEquals(List.of("counsellors:manage", "human_calls:read|counsellors:manage", "counsellors:manage",
                "counsellors:manage", "agents:manage", "calls:read", "agents:manage", "agents:manage",
                "agents:manage", "agents:manage", "calls:read", "calls:read", "agents:manage", "calls:read",
                "agents:manage"), scopes);
    }

    @Test
    void aMissingScopeStopsTheRequestBeforeTheService() {
        when(auth.authenticate(any(), eq("agents:manage"))).thenThrow(new AiCallingApiException(HttpStatus.FORBIDDEN,
                "insufficient_scope", "no"));
        assertThrows(AiCallingApiException.class, () -> controller.deleteAgent(new MockHttpServletRequest(), "a-1"));
        assertThrows(AiCallingApiException.class, () -> controller.setNumberAgent(new MockHttpServletRequest(), "n-1",
                new PublicAiCallingManagementController.AgentRefBody()));
        verifyNoInteractions(agents, numbers);
    }

    @Test
    void anExistingCounsellorAndAReplayAnswer200() {
        when(counsellors.createCounsellor(any(), any(), any()))
                .thenReturn(new ApiIdempotencyStore.Outcome(new LinkedHashMap<>(), false, false));
        assertEquals(HttpStatus.OK, controller.createCounsellor(new MockHttpServletRequest(), null,
                new PublicAiCallingManagementController.CounsellorBody()).getStatusCode());
        when(agents.createAgent(any(), any(), any()))
                .thenReturn(new ApiIdempotencyStore.Outcome(new LinkedHashMap<>(), true, false));
        assertEquals(HttpStatus.OK, controller.createAgent(new MockHttpServletRequest(), "k", json("{}")).getStatusCode());
    }

    @Test
    void counsellorPatchTellsAbsentFromNull() {
        CounsellorApiService.PatchInput in = PublicAiCallingManagementController.counsellorPatch(
                json("{\"airtel_extension\": null, \"active\": false}"));
        assertTrue(in.extensionSet());
        assertNull(in.airtelExtension());
        assertFalse(in.nameSet());
        assertFalse(in.mobileSet());
        assertEquals(Boolean.FALSE, in.active());
        CounsellorApiService.PatchInput camel = PublicAiCallingManagementController.counsellorPatch(
                json("{\"mobileNumber\": \"+919800000001\"}"));
        assertTrue(camel.mobileSet());
        assertEquals("+919800000001", camel.mobileNumber());
        assertThrows(AiCallingApiException.class,
                () -> PublicAiCallingManagementController.counsellorPatch(json("{\"active\": \"yes\"}")));
        assertThrows(AiCallingApiException.class,
                () -> PublicAiCallingManagementController.counsellorPatch(json("{\"name\": 5}")));
        assertThrows(AiCallingApiException.class, () -> PublicAiCallingManagementController.counsellorPatch(null));
    }

    @Test
    void theFallbackKnowsTheNewPaths() {
        PublicAiCallingApiController legacy = new PublicAiCallingApiController(auth, null, null, null, null);
        for (String path : List.of("/counsellors/u-1", "/agents/a-1", "/agents/a-1/enable", "/agents/a-1/disable",
                "/voices", "/settings/default-agent", "/numbers", "/numbers/n-1/agent")) {
            MockHttpServletRequest r = new MockHttpServletRequest("TRACE", "/admin-core-service/open/ai-calling/v1" + path);
            AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> legacy.fallback(r));
            assertEquals("method_not_allowed", e.getCode(), path);
        }
        for (String path : List.of("/agents/a-1/pause", "/numbers/n-1", "/settings/other")) {
            MockHttpServletRequest r = new MockHttpServletRequest("GET", "/admin-core-service/open/ai-calling/v1" + path);
            assertEquals("not_found", assertThrows(AiCallingApiException.class, () -> legacy.fallback(r)).getCode(), path);
        }
    }
}
