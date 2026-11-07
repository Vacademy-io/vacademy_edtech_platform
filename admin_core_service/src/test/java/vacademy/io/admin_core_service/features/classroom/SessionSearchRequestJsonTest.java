package vacademy.io.admin_core_service.features.classroom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/** The classroom filters on SessionSearchRequest are server-side only: /search keeps its contract. */
class SessionSearchRequestJsonTest {

    private static final String BODY = """
            {
              "institute_id": "inst-a",
              "statuses": ["LIVE"],
              "instructor_user_ids": ["someone"],
              "instructorUserIds": ["someone"],
              "today_in_session_timezone": true,
              "todayInSessionTimezone": true
            }""";

    /** The same settings Spring MVC uses to read a request body. */
    private final ObjectMapper webMapper = Jackson2ObjectMapperBuilder.json().build();

    @Test
    void theNewFieldsCannotBeSetFromJson() throws Exception {
        SessionSearchRequest request = webMapper.readValue(BODY, SessionSearchRequest.class);
        assertEquals("inst-a", request.getInstituteId());
        assertEquals(List.of("LIVE"), request.getStatuses());
        assertNull(request.getInstructorUserIds());
        assertNull(request.getTodayInSessionTimezone());
    }

    @Test
    void theNewFieldsAreNeverWritten() throws Exception {
        SessionSearchRequest request = new SessionSearchRequest();
        request.setInstituteId("inst-a");
        request.setInstructorUserIds(List.of("someone"));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        JsonNode json = webMapper.readTree(webMapper.writeValueAsString(request));
        assertEquals("inst-a", json.get("institute_id").asText());
        assertFalse(json.has("instructor_user_ids"));
        assertFalse(json.has("instructorUserIds"));
        assertFalse(json.has("today_in_session_timezone"));
        assertFalse(json.has("todayInSessionTimezone"));
    }
}
