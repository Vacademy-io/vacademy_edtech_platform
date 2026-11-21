package vacademy.io.notification_service.features.announcements;

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

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UserMessagesApiTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    // Postgres-only email-stats SQL in the create response rolls the create back on H2.
    @MockBean private vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository notificationLogRepository;

    private String createAnnouncementAndReturnId() throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("MsgTest");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("hi");
        req.setContent(content);
        req.setInstituteId("INST_TEST");
        req.setCreatedBy("USER_TEST");
        req.setCreatedByRole("ADMIN");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority","LOW"))));

        var medium = new CreateAnnouncementRequest.MediumRequest();
        medium.setMediumType("PUSH_NOTIFICATION");
        medium.setConfig(Map.of("title","t","body","b"));
        req.setMediums(List.of(medium));

        var res = mockMvc.perform(post("/notification-service/v1/announcements").with(AnnouncementTestAuth.admin("INST_TEST"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
    }

    @Test
    @DisplayName("List user messages endpoint responds")
    void listUserMessages() throws Exception {
        createAnnouncementAndReturnId();
        mockMvc.perform(get("/notification-service/v1/user-messages/user/USER_TEST?page=0&size=10")
                        .with(AnnouncementTestAuth.as("INST_TEST", "USER_TEST", "STUDENT")))
                .andExpect(status().isOk());
    }
}


