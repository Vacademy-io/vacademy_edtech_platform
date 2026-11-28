package vacademy.io.notification_service.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.firebase_notifications.repository.FcmTokenRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The admin-dashboard notification screens need a signed-in caller, while provider webhooks,
 * pre-login flows (OTP, unsubscribe), SSE, message replies, combot and device registration
 * stay reachable without one.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SignInRequiredRoutesTest {

    private static final String NS = "/notification-service";

    @Autowired private MockMvc mockMvc;
    @MockBean private FcmTokenRepository fcmTokenRepository;
    @MockBean private PushNotificationService pushNotificationService;

    private static final ResultMatcher REFUSED = result -> assertThat(result.getResponse().getStatus())
            .as(result.getRequest().getMethod() + " " + result.getRequest().getRequestURI()).isIn(401, 403);
    private static final ResultMatcher NOT_REFUSED = result -> assertThat(result.getResponse().getStatus())
            .as(result.getRequest().getMethod() + " " + result.getRequest().getRequestURI()).isNotIn(401, 403);

    private static RequestPostProcessor signedIn(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of("ADMIN"));
        CustomUserDetails principal = new CustomUserDetails(dto);
        return request -> {
            request.addHeader("clientId", "INST_1");
            return user(principal).postProcessRequest(request);
        };
    }

    private static final String[] SIGN_IN_ROUTES = {
            "/v1/inbox/conversations",
            "/v1/inbox/escalations",
            "/v1/channel-mapping",
            "/v1/channel-mapping/register-webhook/meta",
            "/v1/channel-mapping/verify-webhook",
            "/v1/chatbot-flow",
            "/v1/chatbot-flow/list",
            "/v1/whatsapp-templates",
            "/v1/whatsapp-templates/list",
            "/v1/templates",
            "/v1/templates/list",
            "/v1/email-verification/enabled",
            "/v1/email-verification/inst-1/verify",
            "/v1/communications/by-channel",
            "/v1/communications/user/u-1",
            "/v1/email-tracking/user/u-1",
            "/v1/email-tracking/search",
            "/v1/hub/overview",
            "/v1/hub/emails",
            "/push-notifications/send-test",
    };

    @Test
    @DisplayName("admin notification screens refuse a signed-out caller")
    void signedOutIsRefused() throws Exception {
        for (String path : SIGN_IN_ROUTES) {
            mockMvc.perform(get(NS + path)).andExpect(REFUSED);
            mockMvc.perform(post(NS + path).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(REFUSED);
        }
    }

    @Test
    @DisplayName("admin notification screens let a signed-in caller through to the handler")
    void signedInPassesTheFilter() throws Exception {
        // PATCH is mapped on none of these, so a 405 shows the request got past security
        // without running any handler.
        for (String path : SIGN_IN_ROUTES) {
            if (path.startsWith("/push-notifications")) {
                continue;
            }
            mockMvc.perform(patch(NS + path).with(signedIn("admin-1"))).andExpect(NOT_REFUSED);
        }
    }

    @Test
    @DisplayName("webhooks, pre-login flows, SSE, replies, combot and device registration stay open")
    void publicRoutesStayOpen() throws Exception {
        String[] open = {
                "/v1/webhook/whatsapp",
                "/v1/webhook/combot/test",
                "/webhook/v1/meta",
                "/webhook/v1/meta/inst-1",
                "/webhook/v1/wati/inst-1",
                "/v1/send-email-otp",
                "/v1/verify-email-otp",
                "/public/v1/email/unsubscribe",
                "/v1/sse/stream/u-1",
                "/v1/message-replies/m-1",
                "/v1/institute-settings/institute/inst-1",
                "/v1/tracking/click",
                "/v1/admin-app/x",
                "/v1/combot/send-template",
                "/v1/combot/filter-inactive-phones",
                "/push-notifications/register",
                "/push-notifications/deactivate",
        };
        for (String path : open) {
            // PATCH: reach the dispatcher without running a real handler.
            mockMvc.perform(patch(NS + path)).andExpect(NOT_REFUSED);
        }
    }

    @Test
    @DisplayName("send-test needs a platform super admin")
    void sendTestNeedsSuperAdmin() throws Exception {
        mockMvc.perform(post(NS + "/push-notifications/send-test").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"u-1\",\"instituteId\":\"INST_1\",\"title\":\"t\",\"body\":\"b\"}")
                        .with(signedIn("admin-1")))
                .andExpect(status().isForbidden());
        verifyNoInteractions(pushNotificationService);
    }

    @Test
    @DisplayName("device registration: signed out still works, signed in only for oneself")
    void registerMatchesSignedInUser() throws Exception {
        when(fcmTokenRepository.findByUserIdAndDeviceIdAndIsActiveTrue(anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(fcmTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        String forU1 = "{\"userId\":\"u-1\",\"instituteId\":\"INST_1\",\"token\":\"fcm-1\","
                + "\"platform\":\"WEB\",\"deviceId\":\"d-1\"}";

        mockMvc.perform(post(NS + "/push-notifications/register")
                        .contentType(MediaType.APPLICATION_JSON).content(forU1))
                .andExpect(status().isOk());
        mockMvc.perform(post(NS + "/push-notifications/register")
                        .contentType(MediaType.APPLICATION_JSON).content(forU1).with(signedIn("u-1")))
                .andExpect(status().isOk());
        verify(fcmTokenRepository, times(2)).save(any());

        clearInvocations(fcmTokenRepository);
        mockMvc.perform(post(NS + "/push-notifications/register")
                        .contentType(MediaType.APPLICATION_JSON).content(forU1).with(signedIn("u-2")))
                .andExpect(status().isForbidden());
        verify(fcmTokenRepository, never()).save(any());
    }
}
