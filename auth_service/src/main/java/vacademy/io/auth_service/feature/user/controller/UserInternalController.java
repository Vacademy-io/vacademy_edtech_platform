package vacademy.io.auth_service.feature.user.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.core.util.CsvUtil;
import vacademy.io.auth_service.feature.user.service.UserDetailService;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.auth_service.feature.user_resolution.service.UserResolutionService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/auth-service/internal/user")
public class UserInternalController {

    @Autowired
    UserService userService;

    @Autowired
    private UserDetailService userDetailService;

    @Autowired
    private UserResolutionService userResolutionService;

    @Autowired
    private UserOperationService userOperationService;

    @Autowired
    private UserRoleRepository userRoleRepository;

    @PostMapping("/create-or-get-existing-by-id")
    @Transactional
    public ResponseEntity<UserDTO> createUserOrGetExisting(@RequestBody UserDTO userDTO,
            @RequestParam(name = "instituteId", required = false) String instituteId) {
        try {
            User user = null;
            if (!StringUtils.hasText(userDTO.getId())) {
                user = userService.createUserFromUserDto(userDTO);
            } else {
                user = userService.getOptionalUserById(userDTO.getId())
                        .orElse(userService.createUserFromUserDto(userDTO));
            }
            userService.addUserRoles(instituteId, userDTO.getRoles(), user, UserRoleStatus.ACTIVE.name());
            return ResponseEntity.ok(new UserDTO(user));
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    @PostMapping("/user-details-list")
    public ResponseEntity<List<UserDTO>> getUserDetailsByIds(@RequestBody List<String> userIds) {
        List<UserDTO> users = userService.getUserDetailsByIds(userIds);
        return ResponseEntity.ok(users);
    }

    /**
     * userId -> roles held AT THIS INSTITUTE. Authorisation decisions must use this
     * rather than UserDTO.roles, which spans every institute and includes INVITED.
     */
    @GetMapping("/v1/institute-roles")
    public ResponseEntity<Map<String, List<String>>> getInstituteRoles(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("userIds") List<String> userIds) {
        return ResponseEntity.ok(userService.getInstituteRoles(instituteId, userIds));
    }

    /**
     * Role IDS (not names) the user holds ACTIVE at this institute. Per-role Display Settings are
     * keyed by role id, and roles live in this service's database, so admin_core resolves a
     * caller's custom-role settings card through here.
     */
    @GetMapping("/v1/institute-role-ids")
    public ResponseEntity<List<String>> getInstituteRoleIds(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("userId") String userId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(userRoleRepository.findActiveRoleIdsByUserIdAndInstituteId(userId, instituteId));
    }

    /**
     * Every ACTIVE holder of the given roles at an institute.
     *
     * Added for scheduled reporting: a schedule says "send to ADMINs" and the
     * reporting tick has to turn that into real addresses. Roles live in this
     * service's database, so admin_core cannot resolve them itself.
     *
     * Only ACTIVE memberships are returned — an INVITED or DISABLED user must never
     * be mailed institute data, and reports can name learners.
     */
    @GetMapping("/v1/users-by-institute-role")
    public ResponseEntity<List<UserDTO>> getUsersByInstituteAndRoles(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("roles") List<String> roles) {
        return ResponseEntity.ok(userService.getUsersByInstituteAndRoles(instituteId, roles));
    }

    @GetMapping("/user-by-id-with-password")
    public ResponseEntity<UserDTO> getUserByIdWithPassword(String userId) {
        return ResponseEntity.ok(userDetailService.getUserByIdWithPassword(userId));
    }

    @PostMapping("/get-users-of-roles-of-institute")
    public ResponseEntity<List<UserDTO>> getUsersOfRolesOfInstitute(
            @RequestBody List<String> roles,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "inactivityDays", defaultValue = "7") int inactivityDays) {

        List<UserDTO> users = userService.findUsersOfRolesOfInstitute(roles, instituteId, inactivityDays);
        return ResponseEntity.ok(users);
    }

    @PostMapping("/get-users-inactive-for-days-or-more-csv")
    public ResponseEntity<byte[]> getUsersInactiveForDaysOrMoreCsv(
            @RequestBody List<String> roles,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "inactivityDays", defaultValue = "7") int inactivityDays,
            @RequestParam(name = "sortDirection", defaultValue = "ASC") String sortDirection) {

        List<UserDTO> users = userService.findUsersInactiveForDaysOrMore(roles, instituteId, inactivityDays);
        return CsvUtil.convertUserListToCsv(users, "inactive_users.csv");
    }

    /**
     * Internal, HMAC-authenticated equivalent of the public autosuggest-users
     * endpoint. Lets other services do a free-text user search against
     * auth_service's DB (full_name / email / mobile_number) scoped to an
     * institute. Returns up to 10 matches.
     */
    @GetMapping("/autosuggest-users")
    public ResponseEntity<List<UserDTO>> autoSuggestUsersInternal(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "roles", required = false) List<String> roles,
            @RequestParam("query") String query) {
        return ResponseEntity.ok(userService.autoSuggestUsers(instituteId, roles, query));
    }

    /**
     * Substring search on full_name / email / mobile_number, optionally scoped to
     * an institute. Returns matching user IDs only — used by other services to
     * pre-fetch IDs whose profile lives here, then join against their own tables
     * (e.g. admin-core leads search). Capped at 500 ids by the underlying query.
     */
    @GetMapping("/by-email")
    public ResponseEntity<UserDTO> getUserByEmail(@RequestParam String email) {
        UserDTO user = userOperationService.findUserByEmail(email.toLowerCase().trim());
        if (user == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(user);
    }

    @GetMapping("/search-ids")
    public ResponseEntity<List<String>> searchUserIds(
            @RequestParam("query") String query,
            @RequestParam(value = "instituteId", required = false) String instituteId) {
        return ResponseEntity.ok(userResolutionService.searchUserIdsByQuery(query, instituteId));
    }

}
