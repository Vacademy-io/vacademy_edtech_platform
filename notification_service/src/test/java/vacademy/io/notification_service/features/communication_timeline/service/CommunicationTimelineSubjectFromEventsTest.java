package vacademy.io.notification_service.features.communication_timeline.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Subject recovery for email rows written before the subject was stored on message_payload. */
class CommunicationTimelineSubjectFromEventsTest {

    private static NotificationLog event(String body) {
        NotificationLog e = new NotificationLog();
        e.setNotificationType("EMAIL_EVENT");
        e.setBody(body);
        return e;
    }

    @Test
    @DisplayName("reads the subject line SES recorded, exactly as it went out")
    void readsSesSubject() {
        String body = "Email Event: DELIVERY\nMessage ID: 0108-abc\nSubject: Welcome to GxAcademy.com.au\nFrom: Vet Education <info@veteducation.com.au>\nTo: a@b.com";
        assertThat(CommunicationTimelineService.subjectFromEvents(List.of(event(body))))
                .isEqualTo("Welcome to GxAcademy.com.au");
    }

    @Test
    @DisplayName("skips events without a subject line and handles CRLF")
    void skipsEventsWithoutSubject() {
        List<NotificationLog> events = List.of(
                event("Email Event: SEND\nMessage ID: x"),
                event("Email Event: OPEN\nSubject: Your Live Session has started\r\nFrom: x"));
        assertThat(CommunicationTimelineService.subjectFromEvents(events))
                .isEqualTo("Your Live Session has started");
    }

    @Test
    void noEventsMeansNoSubject() {
        assertThat(CommunicationTimelineService.subjectFromEvents(List.of())).isNull();
        assertThat(CommunicationTimelineService.subjectFromEvents(List.of(event(null)))).isNull();
    }
}
