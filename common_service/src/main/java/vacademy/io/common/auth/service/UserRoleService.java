package vacademy.io.common.auth.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.common.auth.entity.Permissions;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.UserRoleStatus;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class UserRoleService {

    /**
     * Role statuses that still let a user into an institute. Everything else found in
     * user_role (DISABLED, DELETED, DELETE, CANCEL, INACTIVE) means an admin took the
     * access away. INVITED counts: an invitee signs in with the emailed credentials, and
     * the first sign-in is what turns the invite ACTIVE.
     */
    public static final List<String> ACCESS_GRANTING_STATUSES =
            List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.INVITED.name());

    public static boolean grantsAccess(UserRole userRole) {
        return userRole != null && userRole.getStatus() != null
                && ACCESS_GRANTING_STATUSES.contains(userRole.getStatus());
    }

    /**
     * True when this user is (or was) staff in the institute and every one of their roles
     * there has been revoked — e.g. "Disable access" / "Delete member" on the Teams tab.
     * Learner-only users are deliberately out of scope, and so is any institute the user
     * has no rows in (cross-institute calls, requests without a clientId header).
     */
    public static boolean isStaffAccessRevoked(List<UserRole> userRoles, String instituteId) {
        if (instituteId == null || instituteId.isBlank() || "null".equals(instituteId) || userRoles == null) {
            return false;
        }
        List<UserRole> inInstitute = userRoles.stream()
                .filter(userRole -> instituteId.equals(userRole.getInstituteId()))
                .toList();
        boolean heldStaffRole = inInstitute.stream().anyMatch(userRole -> userRole.getRole() != null
                && !STUDENT_ROLE.equals(userRole.getRole().getName()));
        return heldStaffRole && inInstitute.stream().noneMatch(UserRoleService::grantsAccess);
    }

    private static final String STUDENT_ROLE = "STUDENT";

    // Method to create the map. Revoked roles are left out, so a token never carries an
    // institute the user has been disabled or removed from.
    public static Map<String, Object> createInstituteRoleMap(List<UserRole> userRoles) {
        // Create a map to hold the results
        Map<String, Object> instituteMap = new HashMap<>();

        // Group user roles by instituteId
        Map<String, List<UserRole>> rolesByInstitute = userRoles.stream()
                .filter(UserRoleService::grantsAccess)
                .collect(Collectors.groupingBy(UserRole::getInstituteId));

        // Iterate through each group and build the desired structure
        for (Map.Entry<String, List<UserRole>> entry : rolesByInstitute.entrySet()) {
            String instituteId = entry.getKey();
            List<UserRole> roles = entry.getValue();

            // Extract role names and permissions
            List<String> roleNames = roles.stream()
                    .map(userRole -> userRole.getRole().getName()) // Assuming getName() returns the role name
                    .distinct() // To avoid duplicates
                    .collect(Collectors.toList());

            List<String> permissions = roles.stream()
                    .flatMap(userRole -> userRole.getRole().getAuthorities().stream().map((Permissions::getName))) // Assuming getPermissions() returns a list of permissions
                    .distinct() // To avoid duplicates
                    .collect(Collectors.toList());

            // Todo: get other user permissions

            // Create the JSON structure
            Map<String, Object> jsonObject = new HashMap<>();
            jsonObject.put("roles", roleNames);
            jsonObject.put("permissions", permissions);

            // Put it into the main map
            instituteMap.put(instituteId, jsonObject);
        }

        return instituteMap;
    }

    // Example usage of ObjectMapper for JSON conversion (if needed)
    public String convertToJson(Map<String, Object> map) throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.writeValueAsString(map);
    }
}