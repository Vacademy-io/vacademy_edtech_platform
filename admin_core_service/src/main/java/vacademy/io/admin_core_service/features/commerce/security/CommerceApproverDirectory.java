package vacademy.io.admin_core_service.features.commerce.security;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Who can approve an action at a location with a PIN, for the PIN dialog of the stock screens:
 * users with a {@code commerce_staff_pin} row who are ADMIN, or STORE_MANAGER assigned to the
 * location. The same rule as the counter's approvers list and as
 * {@link CommerceApprovalService#approve}. Roles and names are read from the account service
 * outside any transaction; a failure there answers an empty list, never an error.
 */
@Slf4j
@Component
public class CommerceApproverDirectory {

    /** One approver: the user id the PIN dialog sends back, and the name it shows. */
    public record Approver(String userId, String fullName) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    private final AuthService authService;
    private final TransactionTemplate readOnly;

    public CommerceApproverDirectory(AuthService authService, PlatformTransactionManager transactionManager) {
        this.authService = authService;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    public List<Approver> approvers(String instituteId, String locationId) {
        record Candidates(List<String> withPin, Set<String> atLocation) {
        }
        Candidates candidates = readOnly.execute(status -> new Candidates(pinHolders(instituteId),
                staffAt(instituteId, locationId)));
        if (candidates == null || candidates.withPin().isEmpty()) {
            return List.of();
        }
        Map<String, List<String>> roles;
        try {
            roles = authService.getInstituteRoles(instituteId, candidates.withPin());
        } catch (RuntimeException e) {
            log.warn("Stock: the approvers' roles could not be read ({})", e.getClass().getSimpleName());
            return List.of();
        }
        if (roles == null) {
            return List.of();
        }
        List<String> approvers = new ArrayList<>();
        for (String userId : candidates.withPin()) {
            List<String> held = roles.get(userId);
            if (held == null) {
                continue;
            }
            boolean admin = held.stream().anyMatch("ADMIN"::equalsIgnoreCase);
            boolean manager = held.stream().anyMatch(CommerceRole.STORE_MANAGER.authority()::equalsIgnoreCase);
            if (admin || (manager && candidates.atLocation().contains(userId))) {
                approvers.add(userId);
            }
        }
        Map<String, String> names = names(approvers);
        List<Approver> out = new ArrayList<>();
        for (String userId : approvers) {
            out.add(new Approver(userId, names.getOrDefault(userId, "")));
        }
        out.sort(Comparator.comparing(Approver::fullName, String.CASE_INSENSITIVE_ORDER));
        return out;
    }

    private Map<String, String> names(List<String> userIds) {
        Map<String, String> out = new HashMap<>();
        if (userIds.isEmpty()) {
            return out;
        }
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(userIds);
            if (users != null) {
                for (UserDTO user : users) {
                    if (user != null && user.getId() != null && user.getFullName() != null) {
                        out.put(user.getId(), user.getFullName());
                    }
                }
            }
        } catch (RuntimeException e) {
            log.warn("Stock: approver names could not be read ({})", e.getClass().getSimpleName());
        }
        return out;
    }

    private List<String> pinHolders(String instituteId) {
        List<String> out = new ArrayList<>();
        for (Object value : entityManager.createNativeQuery(
                        "SELECT user_id FROM commerce_staff_pin WHERE institute_id = :instituteId ORDER BY user_id")
                .setParameter("instituteId", instituteId).getResultList()) {
            out.add(value == null ? null : value.toString());
        }
        return out;
    }

    private Set<String> staffAt(String instituteId, String locationId) {
        Set<String> out = new HashSet<>();
        if (locationId == null || locationId.isBlank()) {
            return out;
        }
        for (Object value : entityManager.createNativeQuery("""
                        SELECT user_id FROM commerce_staff_location
                        WHERE institute_id = :instituteId AND location_id = :locationId
                        """)
                .setParameter("instituteId", instituteId).setParameter("locationId", locationId).getResultList()) {
            out.add(value == null ? null : value.toString());
        }
        return out;
    }
}
