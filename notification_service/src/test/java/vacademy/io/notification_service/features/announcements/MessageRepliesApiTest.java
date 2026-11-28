package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.dto.MessageReplyRequest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.Map;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MessageRepliesApiTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    // Postgres-only email-stats SQL in the create response rolls the create back on H2.
    @MockBean private vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository notificationLogRepository;

    private String createAnnouncement() throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("ReplyAnn");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("c");
        req.setContent(content);
        req.setInstituteId("INST_R");
        req.setCreatedBy("U_CREATE");
        req.setCreatedByRole("ADMIN");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("COMMUNITY", Map.of("communityType","GENERAL"))));
        var medium = new CreateAnnouncementRequest.MediumRequest();
        medium.setMediumType("PUSH_NOTIFICATION");
        medium.setConfig(Map.of("title","t","body","b"));
        req.setMediums(List.of(medium));

        var res = mockMvc.perform(post("/notification-service/v1/announcements").with(AnnouncementTestAuth.admin("INST_R"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
    }

    @Test
    @DisplayName("Create, list, update and delete replies")
    void repliesFlow() throws Exception {
        String announcementId = createAnnouncement();

        MessageReplyRequest create = new MessageReplyRequest();
        create.setAnnouncementId(announcementId);
        create.setParentMessageId(null);
        create.setUserId("U1");
        create.setUserName("User One");
        create.setUserRole("STUDENT");
        var content = new vacademy.io.notification_service.features.announcements.dto.MessageReplyRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("hello");
        create.setContent(content);

        var created = mockMvc.perform(post("/notification-service/v1/message-replies")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andReturn();
        JsonNode createdJson = objectMapper.readTree(created.getResponse().getContentAsString());
        String replyId = createdJson.get("id").asText();

        // List top-level
        mockMvc.perform(get("/notification-service/v1/message-replies/announcement/" + announcementId))
                .andExpect(status().isOk());

        // Update
        create.setUserId("U1");
        content.setContent("updated");
        mockMvc.perform(put("/notification-service/v1/message-replies/" + replyId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.content").value("updated"));

        // Stats
        mockMvc.perform(get("/notification-service/v1/message-replies/announcement/" + announcementId + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalReplies").exists());

        // Delete
        mockMvc.perform(delete("/notification-service/v1/message-replies/" + replyId)
                        .param("userId", "U1"))
                .andExpect(status().isOk());

        // User replies
        mockMvc.perform(get("/notification-service/v1/message-replies/user/U1"))
                .andExpect(status().isOk());
    }
}
