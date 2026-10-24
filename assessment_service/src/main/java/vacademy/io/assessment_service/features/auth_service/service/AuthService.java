package vacademy.io.assessment_service.features.auth_service.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.auth_service.constants.AuthServiceRoutesConstant;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.Collections;
import java.util.List;

@Service
public class AuthService {

    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);
    @Autowired
    private InternalClientUtils internalClientUtils;
    @Value("${spring.application.name}")
    private String clientName;
    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;
    @Autowired
    private ObjectMapper objectMapper;

    public List<UserWithRolesDTO> getUsersByRoles(List<String> roles, String instituteId) {

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.POST.name(),
                authServerBaseUrl,
                AuthServiceRoutesConstant.USERS_OF_ROLES + "?instituteId=" + instituteId,
                roles
        );

        if (response == null || response.getBody() == null) {
            return Collections.emptyList();
        }

        try {
            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserWithRolesDTO>>() {
            });
        } catch (Exception e) {
            // Log error for debugging
            logger.error("Failed to parse JSON response for instituteId {}: {}", instituteId, e.getMessage(), e);
            return Collections.emptyList();
        }
    }

    /** Profile (email, name) for the given user ids; empty on any failure. */
    public List<UserDTO> getUsersByIds(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Collections.emptyList();
        }
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(), authServerBaseUrl,
                    "/auth-service/internal/user/user-details-list", userIds);
            if (response == null || response.getBody() == null) {
                return Collections.emptyList();
            }
            return objectMapper.readValue(response.getBody(), new TypeReference<List<UserDTO>>() {
            });
        } catch (Exception e) {
            logger.error("Failed to fetch users {}: {}", userIds, e.getMessage());
            return Collections.emptyList();
        }
    }
}
