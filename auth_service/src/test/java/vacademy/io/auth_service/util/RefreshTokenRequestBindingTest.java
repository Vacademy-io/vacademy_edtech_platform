package vacademy.io.auth_service.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.RefreshTokenRequestDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Regression cover for the 2026-09-29 finding: the learner app refreshes with
 * {"refreshToken": ...} while the DTO field is "token", so the token bound as null,
 * /learner/v1/refresh-token answered 403 "expired" and the app logged the learner out.
 */
class RefreshTokenRequestBindingTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void bindsTheLearnerAppsRefreshTokenField() throws Exception {
        RefreshTokenRequestDTO dto = mapper.readValue("{\"refreshToken\":\"rt-123\"}", RefreshTokenRequestDTO.class);
        assertEquals("rt-123", dto.getToken());
    }

    @Test
    void stillBindsTheOriginalTokenField() throws Exception {
        RefreshTokenRequestDTO dto = mapper.readValue("{\"token\":\"rt-456\"}", RefreshTokenRequestDTO.class);
        assertEquals("rt-456", dto.getToken());
    }
}
