package vacademy.io.notification_service.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Page;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.analytics.service.DailyParticipationService;
import vacademy.io.notification_service.features.communication_timeline.service.CommunicationTimelineService;
import vacademy.io.notification_service.features.email_tracking.service.EmailTrackingService;
import vacademy.io.notification_service.features.hub.service.NotificationHubService;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Message history, email tracking, the notification hub, analytics and the webhook self-test
 * are for institute staff: a learner of the institute is refused, staff of the institute
 * (admin, teacher, counsellor, custom role) gets through, and the institute named in the
 * request must be the one the caller signed in to.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StaffOnlyNotificationRoutesTest {

    private static final String NS = "/notification-service";

    @Autowired private MockMvc mockMvc;
    @MockBean private CommunicationTimelineService communicationTimelineService;
    @MockBean private EmailTrackingService emailTrackingService;
    @MockBean private NotificationHubService hubService;
    @MockBean private DailyParticipationService dailyParticipationService;

    private static RequestPostProcessor signedIn(String userId, String clientId, String... roles) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(roles));
        CustomUserDetails principal = new CustomUserDetails(dto);
        return request -> {
            request.addHeader("clientId", clientId);
            return user(principal).postProcessRequest(request);
        };
    }

    @Test
    @DisplayName("a learner is refused on message history, tracking, hub, analytics and the webhook self-test")
    void learnerIsRefused() throws Exception {
        RequestPostProcessor learner = signedIn("learner-1", "INST_1", "STUDENT");
        mockMvc.perform(get(NS + "/v1/communications/by-channel").param("email", "a@example.com").with(learner))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(NS + "/v1/communications/user/someone-else").with(learner))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(NS + "/v1/email-tracking/email/a@example.com").with(learner))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(NS + "/v1/hub/overview").param("instituteId", "INST_1").with(learner))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(NS + "/analytics/daily-participation").with(learner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"institute_id\":\"INST_1\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(NS + "/v1/channel-mapping/verify-webhook").with(learner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"webhookUrl\":\"https://example.com/hook\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(communicationTimelineService, emailTrackingService, hubService, dailyParticipationService);
    }

    @Test
    @DisplayName("staff of the institute get through")
    void staffPasses() throws Exception {
        when(communicationTimelineService.getUserCommunicationsByChannel(any())).thenReturn(Page.empty());
        when(communicationTimelineService.getUserCommunications(any())).thenReturn(Page.empty());
        when(emailTrackingService.getUserEmails(any())).thenReturn(Page.empty());

        mockMvc.perform(get(NS + "/v1/communications/by-channel").param("email", "a@example.com")
                        .with(signedIn("admin-1", "INST_1", "ADMIN")))
                .andExpect(status().isOk());
        mockMvc.perform(get(NS + "/v1/communications/by-channel").param("phone", "919999999999")
                        .with(signedIn("teacher-1", "INST_1", "TEACHER")))
                .andExpect(status().isOk());
        // CRM institutes enrol counsellors as STUDENT too; any extra role counts as staff.
        mockMvc.perform(get(NS + "/v1/communications/by-channel").param("email", "a@example.com")
                        .with(signedIn("counsellor-1", "INST_1", "STUDENT", "COUNSELLOR")))
                .andExpect(status().isOk());
        mockMvc.perform(get(NS + "/v1/email-tracking/email/a@example.com")
                        .with(signedIn("admin-1", "INST_1", "ADMIN")))
                .andExpect(status().isOk());
        mockMvc.perform(get(NS + "/v1/hub/overview").param("instituteId", "INST_1")
                        .with(signedIn("admin-1", "INST_1", "ADMIN")))
                .andExpect(status().isOk());
        verify(hubService).getOverview("INST_1", 7);
        mockMvc.perform(post(NS + "/analytics/daily-participation").with(signedIn("admin-1", "INST_1", "ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"institute_id\":\"INST_1\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(get(NS + "/analytics/outgoing-templates").param("institute_id", "INST_1")
                        .with(signedIn("admin-1", "INST_1", "ADMIN")))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a learner can read their own timeline")
    void learnerReadsOwnTimeline() throws Exception {
        when(communicationTimelineService.getUserCommunications(any())).thenReturn(Page.empty());
        mockMvc.perform(get(NS + "/v1/communications/user/learner-1")
                        .with(signedIn("learner-1", "INST_1", "STUDENT")))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("another institute's id is refused")
    void otherInstituteIsRefused() throws Exception {
        RequestPostProcessor admin = signedIn("admin-1", "INST_1", "ADMIN");
        mockMvc.perform(get(NS + "/v1/hub/overview").param("instituteId", "INST_2").with(admin))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(NS + "/analytics/engagement-leaderboard").with(admin)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"institute_id\":\"INST_2\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(hubService, dailyParticipationService);
    }

    @Test
    @DisplayName("webhook self-test refuses private and metadata addresses without fetching them")
    void webhookSelfTestRefusesPrivateTargets() throws Exception {
        RequestPostProcessor admin = signedIn("admin-1", "INST_1", "ADMIN");
        for (String url : new String[]{
                "http://127.0.0.1:8072/admin-core-service/health",
                "http://169.254.169.254/latest/meta-data",
                "http://10.0.0.5/",
                "http://localhost/",
                "http://admin-core-service:8072/",
                "file:///etc/passwd"}) {
            mockMvc.perform(post(NS + "/v1/channel-mapping/verify-webhook").with(admin)
                            .contentType(MediaType.APPLICATION_JSON).content("{\"webhookUrl\":\"" + url + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.success").value(false))
                    .andExpect(jsonPath("$.message").value("Webhook URL must be a public http(s) address"));
        }
    }
}
