package vacademy.io.admin_core_service.features.site_assistant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import vacademy.io.admin_core_service.features.site_assistant.controller.DemoGuideInternalController;
import vacademy.io.admin_core_service.features.site_assistant.controller.SiteAssistantErrorAdvice;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantLeadService;
import vacademy.io.common.auth.filter.InternalAuthFilter;
import vacademy.io.common.auth.service.ClientAuthenticationService;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The demo guide's lead endpoint: HMAC guard, the DEMO_GUIDE source type and the shared error envelope. */
class DemoGuideInternalControllerTest {

    static final String LEADS = "/admin-core-service/internal/demo-guide/v1/leads";
    static final String BODY = """
            {"institute_id":"inst-1","kind":"SALES","campaign_id":"aud-9","full_name":"Asha",
             "phone":"+91 98765 43210","summary":"Runs a coaching academy; watched the fees tour.",
             "custom_fields":{"conversation_id":"5b1e9f0a-0000-4000-8000-000000000001","organisation":"Asha Classes"}}
            """;

    SiteAssistantLeadService leads;
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        leads = mock(SiteAssistantLeadService.class);
        ClientAuthenticationService clients = mock(ClientAuthenticationService.class);
        when(clients.validateClient("ai_service", "good-signature")).thenReturn(true);
        InternalAuthFilter filter = new InternalAuthFilter();
        ReflectionTestUtils.setField(filter, "clientAuthenticationService", clients);
        mvc = MockMvcBuilders.standaloneSetup(new DemoGuideInternalController(leads))
                .setControllerAdvice(new SiteAssistantErrorAdvice())
                .addFilters(filter)
                .build();
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void theRouteIsUnderTheHmacGuardedInternalPrefix() throws Exception {
        String base = DemoGuideInternalController.class.getAnnotation(RequestMapping.class).value()[0];
        assertTrue(base.startsWith("/admin-core-service/internal/"), base);
        mvc.perform(post(LEADS).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
        mvc.perform(post(LEADS).header("clientName", "ai_service").header("Signature", "forged")
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(leads);
    }

    @Test
    void aLeadIsSubmittedWithTheDemoGuideSourceType() throws Exception {
        when(leads.submit(any(), eq("DEMO_GUIDE")))
                .thenReturn(new SiteAssistantLeadService.Outcome("received", "resp-1"));
        mvc.perform(post(LEADS).header("clientName", "ai_service").header("Signature", "good-signature")
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("received"))
                .andExpect(jsonPath("$.lead_ref").value("resp-1"));
        verify(leads).submit(argThat(l -> "inst-1".equals(l.instituteId()) && "aud-9".equals(l.campaignId())
                && "5b1e9f0a-0000-4000-8000-000000000001".equals(l.customFields().get("conversation_id"))),
                eq("DEMO_GUIDE"));
        verify(leads, never()).submit(any());
    }

    @Test
    void anInvalidBodyAnswersTheCatalogueApiErrorEnvelope() throws Exception {
        mvc.perform(post(LEADS).header("clientName", "ai_service").header("Signature", "good-signature")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"institute_id\":\"inst-1\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));
    }
}
