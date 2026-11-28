package vacademy.io.admin_core_service.features.commerce.pos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Names of staff for the counter's answers (cashier of a session, the managers who can approve).
 * One remote call per answer, never inside a transaction; a failure gives no names, never an
 * error.
 */
@Slf4j
@Component
public class PosUserNames {

    private final AuthService authService;

    public PosUserNames(AuthService authService) {
        this.authService = authService;
    }

    /** Full names by user id; absent for a user the account service did not answer. */
    public Map<String, String> names(Collection<String> userIds) {
        List<String> ids = userIds == null ? List.of()
                : new LinkedHashSet<>(userIds).stream().filter(Objects::nonNull).toList();
        Map<String, String> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(ids);
            if (users != null) {
                for (UserDTO user : users) {
                    if (user != null && user.getId() != null && user.getFullName() != null) {
                        out.put(user.getId(), user.getFullName());
                    }
                }
            }
        } catch (RuntimeException e) {
            log.warn("POS: staff names could not be read ({})", e.getClass().getSimpleName());
        }
        return out;
    }
}
