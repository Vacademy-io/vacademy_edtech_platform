package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The attendance report is scoped to one institute purely by instituteId, so the
 * snake_case wire name the admin dashboard sends has to land on that field.
 */
class AttendanceFilterRequestTest {

    // Mirrors Spring Boot's auto-configured mapper: JSR-310 registered, unknown
    // properties ignored rather than fatal.
    private final ObjectMapper mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    @Test
    void bindsInstituteIdFromSnakeCaseBody() throws Exception {
        String body = """
                {
                  "institute_id": "35675130-7c65-41d6-a869-0811d2e1753e",
                  "name": "",
                  "start_date": "2020-01-01",
                  "end_date": "2026-09-07",
                  "batch_ids": null,
                  "live_session_ids": null
                }
                """;

        AttendanceFilterRequest req = mapper.readValue(body, AttendanceFilterRequest.class);

        assertEquals("35675130-7c65-41d6-a869-0811d2e1753e", req.getInstituteId());
        assertNull(req.getBatchIds());
        assertNull(req.getLiveSessionIds());
    }

    @Test
    void instituteIdIsNullWhenOmitted() throws Exception {
        String body = """
                {"name": "", "start_date": "2020-01-01", "end_date": "2026-09-07"}
                """;

        AttendanceFilterRequest req = mapper.readValue(body, AttendanceFilterRequest.class);

        assertNull(req.getInstituteId(), "an old client omitting institute_id must be rejected, not silently unscoped");
    }

    @Test
    void camelCaseInstituteIdIsNotAccepted() throws Exception {
        String body = """
                {"instituteId": "35675130-7c65-41d6-a869-0811d2e1753e"}
                """;

        AttendanceFilterRequest req = mapper.readValue(body, AttendanceFilterRequest.class);

        assertNull(req.getInstituteId(), "wire format is snake_case; camelCase must not bind");
    }
}
