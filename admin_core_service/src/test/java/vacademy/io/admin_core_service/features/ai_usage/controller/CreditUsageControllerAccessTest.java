package vacademy.io.admin_core_service.features.ai_usage.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.ai_usage.service.ConversationService;
import vacademy.io.admin_core_service.features.ai_usage.service.CreditUsageService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The AI usage endpoints return per-user usage and the text of AI conversations for the
 * clientId-header institute. The caller must be staff of THAT institute (no root bypass):
 * a learner or an outsider setting the header is refused before any data is read.
 */
@ExtendWith(MockitoExtension.class)
class CreditUsageControllerAccessTest {

    private static final String INST = "inst-1";

    @Mock private CreditUsageService service;
    @Mock private ConversationService conversationService;
    @Mock private InstituteAccessValidator validator;
    @Mock private CustomUserDetails user;

    @InjectMocks private CreditUsageController controller;

    private MockHttpServletRequest request() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.addHeader("clientId", INST);
        r.setAttribute("user", user);
        return r;
    }

    @Test
    void staffOfTheHeaderInstituteIsChecked() {
        controller.summary(request(), null, null);
        verify(validator).requireInstituteStaff(user, INST);
        verify(validator, never()).validateUserAccess(any(), any());
        verify(service).roleSummary(eq(INST), any(), any());
    }

    @Test
    void aRefusedCallerNeverReadsConversations() {
        doThrow(new ForbiddenException("no")).when(validator).requireInstituteStaff(user, INST);
        assertThrows(ForbiddenException.class, () -> controller.conversationMessages(request(), "s-1"));
        verifyNoInteractions(conversationService);
    }

    @Test
    void noUserOnTheRequestIsRefused() {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.addHeader("clientId", INST);
        doThrow(new ForbiddenException("no")).when(validator).requireInstituteStaff(null, INST);
        assertThrows(ForbiddenException.class, () -> controller.summary(r, null, null));
        verifyNoInteractions(service);
    }
}
