package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.service.AnnouncementDeliveryService;
import vacademy.io.notification_service.features.announcements.service.RecipientResolutionService;

import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ExpandedUserMessagesApiTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @MockBean private RecipientResolutionService recipientResolutionService;
    @MockBean private AnnouncementDeliveryService announcementDeliveryService;

    private static CustomUserDetails principal(String userId, String role) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(role));
        return new CustomUserDetails(dto);
    }

    private String createAnnouncementForSystemAlert() throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("UMsg");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("c");
        req.setContent(content);
        req.setInstituteId("INST_U");
        req.setCreatedBy("CREATOR_U");
        req.setCreatedByRole("ADMIN");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority","HIGH"))));
        var medium = new CreateAnnouncementRequest.MediumRequest();
        medium.setMediumType("PUSH_NOTIFICATION");
        medium.setConfig(Map.of("title","t","body","b"));
        req.setMediums(List.of(medium));

        var res = mockMvc.perform(post("/notification-service/v1/announcements")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString());
        return json.get("id").asText();
    }

    private String deliverAndGetFirstMessageId(String announcementId, String userId) throws Exception {
        Mockito.when(recipientResolutionService.resolveRecipientsToUsers(announcementId))
                .thenReturn(List.of(userId));
        Mockito.doNothing().when(announcementDeliveryService).deliverAnnouncement(announcementId);

        mockMvc.perform(post("/notification-service/v1/announcements/" + announcementId + "/deliver").header("clientId", "INST_U").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isOk());

        var listRes = mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "?page=0&size=5"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode page = objectMapper.readTree(listRes.getResponse().getContentAsString());
        return page.get("content").get(0).get("messageId").asText();
    }

    @Test
    @DisplayName("Unread counts, interactions, and mode fetches")
    void userMessagesFlow() throws Exception {
        String userId = "U_TARGET";
        String announcementId = createAnnouncementForSystemAlert();
        String messageId = deliverAndGetFirstMessageId(announcementId, userId);

        // Unread counts overall and by mode
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/unread-count"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/unread-count")
                        .param("modeType", "SYSTEM_ALERT"))
                .andExpect(status().isOk());

        // Mark as read
        var readReq = Map.of("recipientMessageId", messageId, "userId", userId, "interactionType", "READ");
        mockMvc.perform(post("/notification-service/v1/user-messages/interactions/read")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(readReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").exists());

        // Dismiss
        mockMvc.perform(post("/notification-service/v1/user-messages/interactions/dismiss")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("recipientMessageId", messageId, "userId", userId, "interactionType", "DISMISSED"))))
                .andExpect(status().isOk());

        // Record generic interaction
        mockMvc.perform(post("/notification-service/v1/user-messages/interactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("recipientMessageId", messageId, "userId", userId, "interactionType", "CLICKED"))))
                .andExpect(status().isOk());

        // Mode-specific fetches that should respond OK
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/system-alerts"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/dashboard-pins"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/direct-messages"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/streams"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/resources"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/community"))
                .andExpect(status().isOk());
    }
}
