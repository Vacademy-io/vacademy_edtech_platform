package vacademy.io.auth_service.feature.user.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.auth_service.feature.user.service.UserCredentialUpdateService;
import vacademy.io.common.auth.dto.*;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/auth-service/v1/user")
@Validated
public class UserController {

    @Autowired
    UserService userService;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserCredentialUpdateService userCredentialUpdateService;

    @Autowired
    private UserAccountAccessGuard userAccountAccessGuard;

    // API to create user
    @PostMapping("/internal/create-user")
    @Transactional
    public ResponseEntity<UserDTO> createUser(@RequestBody UserDTO userDTO,
            @RequestParam("instituteId") String instituteId) {
        try {
            User user = authService.createUser(userDTO, instituteId, true);
            return ResponseEntity.ok(new UserDTO(user));
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    @PostMapping("/internal/create-user-or-get-existing")
    @Transactional
    public ResponseEntity<UserDTO> createUserOrGetExisting(@RequestBody UserDTO userDTO,
            @RequestParam(name = "instituteId", required = false) String instituteId,
            @RequestParam(name = "isNotify", required = false, defaultValue = "true") boolean isNotify) {
        try {
            User user = authService.createUser(userDTO, instituteId, isNotify);
            UserDTO res = new UserDTO(user, userDTO);
            res.setPassword(user.getPassword());
            return ResponseEntity.ok(res);
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    @PostMapping("/internal/create-or-get-existing-learner")
    @Transactional
    public ResponseEntity<UserDTO> createOrGetExistingLearner(@RequestBody UserDTO userDTO,
            @RequestParam(name = "instituteId", required = false) String instituteId,
            @RequestParam(name = "isNotify", required = false, defaultValue = "true") boolean isNotify,
            @RequestParam(name = "loginUrl", required = false) String loginUrl) {
        try {
            User user = authService.createUserForLearnerEnrollment(userDTO, instituteId, isNotify, loginUrl);
            UserDTO res = new UserDTO(user, userDTO);
            res.setPassword(user.getPassword());
            return ResponseEntity.ok(res);
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    /**
     * Internal profile update used by admin_core (learner profile edit, lead
     * merge). Those callers send a whole UserDTO, so a username can ride along —
     * and if it differs from the stored one this is a rename. Route it through
     * {@link UserCredentialUpdateService} first so it fans out to the
     * denormalized copies instead of silently drifting; unchanged usernames are
     * a no-op there, which is the common case for these callers.
     */
    @PutMapping("/internal/update-user")
    public ResponseEntity<UserDTO> updateUser(@RequestBody UserDTO userDTO, @RequestParam("userId") String userId) {
        try {
            if (StringUtils.hasText(userDTO.getUsername())) {
                userCredentialUpdateService.updateCredentials(userId, userDTO.getUsername(), null);
                userDTO.setUsername(null);
            }
            return ResponseEntity.ok(userService.updateUserDetails(userDTO, userId));
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    // API to fetch user details correspond to user id
    @GetMapping("/internal/v1/details/{userId}")
    public ResponseEntity<UserDTO> getUserDetailsById(@PathVariable String userId) {
        UserDTO user = userService.getUserDetailsById(userId);
        return ResponseEntity.ok(user);
    }

    // API to fetch user details corresspond to List of user Id
    @GetMapping("/internal/user-details-list")
    public ResponseEntity<List<UserDTO>> getUserDetailsByIds(@RequestBody List<String> userIds) {
        List<UserDTO> users = userService.getUserDetailsByIds(userIds);
        return ResponseEntity.ok(users);
    }

    // API to remove role from user
    @DeleteMapping("/v1/user-role")
    public ResponseEntity<String> removeRoleFromUser(@RequestBody UserRoleRequestDTO userRoleRequestDTO,
            @RequestAttribute("user") CustomUserDetails user) {

        // Extract userId from CustomUserDetails if needed for further business logic
        String extractedUserId = user.getUserId();

        userService.removeRoleFromUser(userRoleRequestDTO);
        return ResponseEntity.ok("Role removed from user successfully.");
    }

    @PostMapping("/users-by-institute-id-and-roles")
    public ResponseEntity<List<UserWithRolesDTO>> getUsersByInstituteId(@RequestParam("instituteId") String instituteId,
            @RequestBody List<String> roles, @RequestAttribute("user") CustomUserDetails user) {
        List<UserWithRolesDTO> users = userService.getUserDetailsByInstituteId(instituteId, roles, user);
        return ResponseEntity.ok(users);
    }

    @GetMapping("/user-credentials/{userId}")
    public ResponseEntity<UserCredentials> getUserCredentials(@PathVariable String userId,
            @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // Returns the stored password: only the user, staff of their institute, or a super-admin.
        userAccountAccessGuard.requireCanViewCredentials(customUserDetails, userId);
        return ResponseEntity.ok(userService.getUserCredentials(userId, customUserDetails));
    }

    @PostMapping("/internal/users-credential")
    public ResponseEntity<List<UserCredentials>> getUsersCredentials(@RequestBody List<String> userIds) {
        return ResponseEntity.ok(userService.getUsersCredentials(userIds));
    }

    @PostMapping("/users-credential")
    public ResponseEntity<List<UserCredentials>> getUsersCredentials(@RequestBody List<String> userIds,
            @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // Plaintext passwords: only for the ids the caller may see one by one through
        // user-credentials/{userId}; the rest are left out of the list (the UI shows its
        // "not found" placeholder for them).
        List<String> allowed = new ArrayList<>(userAccountAccessGuard.loginsCallerMayView(customUserDetails, userIds));
        if (allowed.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(userService.getUsersCredentials(allowed));
    }

    @PostMapping("/internal/update/details")
    public ResponseEntity<String> updateUserDetails(@RequestBody UserTopLevelDto request,
            @RequestParam("userId") String userId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(userService.updateUserDetails(null, request, userId, instituteId));
    }

    @GetMapping("/internal/get/details")
    public ResponseEntity<UserTopLevelDto> getUserDetails(@RequestParam("userId") String userId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(userService.getUserTopLevelDetails(null, userId, instituteId));
    }

    @PostMapping("/get-users-of-roles-of-institute")
    public ResponseEntity<List<UserDTO>> getUsersOfRolesOfInstitute(
            @RequestBody List<String> roles,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "inactivityDays", defaultValue = "7") int inactivityDays) {

        List<UserDTO> users = userService.findUsersOfRolesOfInstitute(roles, instituteId, inactivityDays);
        return ResponseEntity.ok(users);
    }

    @PostMapping("/internal/create-multiple-users")
    @Transactional
    public ResponseEntity<List<UserDTO>> createMultipleUsers(@RequestBody List<UserDTO> userDTOs,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(name = "isNotify", required = false, defaultValue = "true") boolean isNotify) {
        try {
            List<UserDTO> users = authService.createMultipleUsers(userDTOs, instituteId, isNotify);
            return ResponseEntity.ok(users);
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    @GetMapping("/autosuggest-users")
    public ResponseEntity<List<UserDTO>> autoSuggestUsers(@RequestParam("instituteId") String instituteId,
            @RequestParam(value = "roles", required = false) List<String> roles,
            @RequestParam("query") String query) {
        return ResponseEntity.ok(userService.autoSuggestUsers(instituteId, roles, query));
    }

    @PostMapping("/internal/users-with-children")
    public ResponseEntity<List<ParentWithChildDTO>> getUsersWithChildren(
            @RequestBody List<String> userIds) {
        return ResponseEntity.ok(userService.getUsersWithChildren(userIds));
    }

    @GetMapping("/internal/user-by-mobile")
    public ResponseEntity<UserDTO> getUserByMobileNumber(@RequestParam String mobileNumber) {
        Optional<UserDTO> userOpt = authService.getUserByMobileNumber(mobileNumber);
        return userOpt.map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // Links two EXISTING users as parent/child (guardian-linking feature).
    @PostMapping("/internal/link-parent-child")
    @Transactional
    public ResponseEntity<String> linkParentChild(@RequestBody ParentChildLinkRequestDTO request) {
        try {
            authService.linkParentChild(request.getParentUserId(), request.getStudentUserId());
            return ResponseEntity.ok("Linked");
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    // All children linked to a single parent (multi-child aware).
    @GetMapping("/internal/children-of-parent")
    public ResponseEntity<List<UserDTO>> getChildrenOfParent(@RequestParam("parentUserId") String parentUserId) {
        return ResponseEntity.ok(authService.getChildrenOfParent(parentUserId));
    }

    // Institute-wide guardian backfill: creates a synthetic parent for each
    // child that does not already have one linked.
    @PostMapping("/internal/backfill-parents")
    @Transactional
    public ResponseEntity<BackfillParentsResultDTO> backfillParents(
            @RequestBody List<BackfillParentItemDTO> items,
            @RequestParam("instituteId") String instituteId) {
        try {
            return ResponseEntity.ok(authService.backfillParents(items, instituteId));
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

}
