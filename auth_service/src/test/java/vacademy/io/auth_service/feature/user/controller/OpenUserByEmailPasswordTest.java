package vacademy.io.auth_service.feature.user.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The open by-email lookup answers with the account's details but never its password. */
class OpenUserByEmailPasswordTest {

    @Test
    void answerOmitsThePasswordAndKeepsTheDetailsCallersRead() throws Exception {
        UserOperationService service = mock(UserOperationService.class);
        UserDTO found = new UserDTO();
        found.setId("acc-1");
        found.setEmail("asha@example.com");
        found.setFullName("Asha Rao");
        found.setMobileNumber("919999999999");
        found.setUsername("asha");
        found.setRoles(List.of("STUDENT"));
        found.setPassword("stored-secret");
        when(service.findUserByEmail("asha@example.com")).thenReturn(found);
        OpenUserController controller = new OpenUserController();
        ReflectionTestUtils.setField(controller, "userOperationService", service);

        ResponseEntity<UserDTO> response = controller.findUserByEmail("asha@example.com");

        assertEquals(200, response.getStatusCode().value());
        JsonNode json = new ObjectMapper().valueToTree(response.getBody());
        assertTrue(json.path("password").isNull() || json.path("password").isMissingNode());
        assertEquals("acc-1", json.path("id").asText());
        assertEquals("asha@example.com", json.path("email").asText());
        assertEquals("Asha Rao", json.path("full_name").asText());
        assertEquals("919999999999", json.path("mobile_number").asText());
        assertEquals("STUDENT", json.path("roles").get(0).asText());
    }

    @Test
    void unknownEmailIsStillNotFound() {
        UserOperationService service = mock(UserOperationService.class);
        OpenUserController controller = new OpenUserController();
        ReflectionTestUtils.setField(controller, "userOperationService", service);

        ResponseEntity<UserDTO> response = controller.findUserByEmail("nobody@example.com");

        assertEquals(404, response.getStatusCode().value());
        assertNull(response.getBody());
    }
}
