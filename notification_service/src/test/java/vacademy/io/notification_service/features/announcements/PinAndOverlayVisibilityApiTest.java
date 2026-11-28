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
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.service.AnnouncementDeliveryService;
import vacademy.io.notification_service.features.announcements.service.RecipientResolutionService;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Runs the learner pin / overlay queries for real: a pin shows only inside its chosen window, and
 * switching the announcement off hides its pins and overlays.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PinAndOverlayVisibilityApiTest {

    private static final String INSTITUTE = "INST_PINS";
    private static final String BASE = "/notification-service/v1/announcements";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @MockBean private RecipientResolutionService recipientResolutionService;
    @MockBean private AnnouncementDeliveryService announcementDeliveryService;
    // The email-stats summary in the create response is Postgres-only SQL; on H2 it fails inside
    // the create transaction and rolls it back.
    @MockBean private vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository notificationLogRepository;

    private String createAndDeliver(String userId, String mode, Map<String, Object> settings) throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("Pin " + mode);
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("c");
        req.setContent(content);
        req.setInstituteId(INSTITUTE);
        req.setCreatedBy("admin-1");
        req.setCreatedByRole("ADMIN");
        req.setTimezone("UTC");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("USER");
        recipient.setRecipientId(userId);
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest(mode, settings)));
        // No schedule: creation delivers right away to the (mocked) resolved user.
        Mockito.when(recipientResolutionService.resolveRecipientsToUsers(Mockito.anyString()))
                .thenReturn(List.of(userId));

        var res = mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req))
                        .with(AnnouncementTestAuth.admin(INSTITUTE)))
                .andExpect(status().isOk())
                .andReturn();
        String id = objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
        return id;
    }

    private int count(String userId, String what) throws Exception {
        var res = mockMvc.perform(get("/notification-service/v1/user-messages/user/" + userId + "/" + what)
                        .with(AnnouncementTestAuth.as(INSTITUTE, userId, "STUDENT")))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = objectMapper.readTree(res.getResponse().getContentAsString());
        return body.size();
    }

    private static String utc(LocalDateTime t) {
        return t.withNano(0).toString();
    }

    @Test
    @DisplayName("a pin shows inside its window and not after its end")
    void pinHonoursItsWindow() throws Exception {
        // Days, not hours: the H2 clock and the test JVM may not be in UTC.
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        createAndDeliver("pin-user-1", "DASHBOARD_PIN", Map.of(
                "position", "TOP", "priority", 10,
                "pinStartTime", utc(now.minusDays(2)), "pinEndTime", utc(now.plusDays(2))));
        assertThat(count("pin-user-1", "dashboard-pins")).isEqualTo(1);

        createAndDeliver("pin-user-2", "DASHBOARD_PIN", Map.of(
                "position", "TOP", "priority", 10,
                "pinStartTime", utc(now.minusDays(3)), "pinEndTime", utc(now.minusDays(2))));
        assertThat(count("pin-user-2", "dashboard-pins")).isZero();

        createAndDeliver("pin-user-3", "DASHBOARD_PIN", Map.of(
                "position", "TOP", "priority", 10,
                "pinStartTime", utc(now.plusDays(2)), "pinEndTime", utc(now.plusDays(3))));
        assertThat(count("pin-user-3", "dashboard-pins")).isZero();
    }

    @Test
    @DisplayName("switching an announcement off hides its pin and its overlay")
    void deactivatedAnnouncementIsHidden() throws Exception {
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        String pinId = createAndDeliver("off-user", "DASHBOARD_PIN", Map.of(
                "pinStartTime", utc(now.minusDays(2)), "pinEndTime", utc(now.plusDays(2))));
        String overlayId = createAndDeliver("off-user", "APP_OVERLAY", Map.of("priority", 1));
        assertThat(count("off-user", "dashboard-pins")).isEqualTo(1);
        assertThat(count("off-user", "app-overlays")).isEqualTo(1);

        for (String id : List.of(pinId, overlayId)) {
            mockMvc.perform(put(BASE + "/" + id + "/status").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"INACTIVE\"}")
                            .with(AnnouncementTestAuth.admin(INSTITUTE)))
                    .andExpect(status().isOk());
        }

        assertThat(count("off-user", "dashboard-pins")).isZero();
        assertThat(count("off-user", "app-overlays")).isZero();
    }
}
