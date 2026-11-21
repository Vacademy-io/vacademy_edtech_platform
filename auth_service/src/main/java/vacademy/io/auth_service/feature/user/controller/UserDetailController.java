package vacademy.io.auth_service.feature.user.controller;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.user.dto.UserBasicDetailsDto;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.dto.UserJwtUpdateDetail;
import vacademy.io.auth_service.feature.user.service.UserCredentialUpdateService;
import vacademy.io.auth_service.feature.user.service.UserDetailService;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserTopLevelDto;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

@RestController
@RequestMapping("/auth-service/v1/user-details")
public class UserDetailController {

    @Autowired
    private UserService userService;

    @Autowired
    private UserDetailService userDetailService;

    @Autowired
    private UserCredentialUpdateService userCredentialUpdateService;

    @Autowired
    private UserOperationService userOperationService;

    @Autowired
    private InstitutePolicyService institutePolicyService;

    @Autowired
    private UserAccountAccessGuard userAccountAccessGuard;

    @Autowired
    private AdminRoleGrantGuard adminRoleGrantGuard;

    @GetMapping("/by-user-id")
    public ResponseEntity<UserDTO> getUserDetailByUserId(String userId, @RequestAttribute("user") CustomUserDetails customUserDetails) {
        return ResponseEntity.ok(userService.getUserDetailsById(userId));
    }

    @PostMapping("/update")
    public ResponseEntity<String> updateUserDetails(@RequestAttribute("user") CustomUserDetails userDetails,
                                                    @RequestBody UserTopLevelDto request,
                                                    @RequestParam("userId") String userId,
                                                    @RequestParam("instituteId") String instituteId) {
        // Target, institute and role rows all come from the request, and the shared
        // UserService method checks none of them: without this anyone could set anyone's
        // email or mobile number (both log in by OTP) or make themselves ADMIN of any institute.
        userAccountAccessGuard.requireCanUpdateDetails(userDetails, instituteId, userId,
                () -> loginIdentityChanges(request, userId),
                request.getAddUserRoleRequest(), request.getDeleteUserRoleRequest());
        adminRoleGrantGuard.requireAdminToGrantAdmin(userDetails, instituteId, request.getAddUserRoleRequest());
        return ResponseEntity.ok(userService.updateUserDetails(userDetails,request,userId, instituteId));
    }

    /** Mirrors UserService.updateUserDetails, which writes any non-null email and mobile number. */
    private boolean loginIdentityChanges(UserTopLevelDto request, String userId) {
        if (request.getEmail() == null && request.getMobileNumber() == null) {
            return false;
        }
        User current = userService.getOptionalUserById(userId).orElse(null);
        if (current == null) {
            return false;
        }
        return differs(request.getEmail(), current.getEmail())
                || differs(request.getMobileNumber(), current.getMobileNumber());
    }

    private static boolean differs(String requested, String current) {
        if (requested == null) {
            return false;
        }
        String now = current == null ? "" : current.trim();
        return !requested.trim().equalsIgnoreCase(now);
    }

    @GetMapping("/get")
    public ResponseEntity<UserTopLevelDto> getUserDetails(@RequestAttribute("user") CustomUserDetails userDetails,
                                                          @RequestParam("userId") String userId,
                                                          @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(userService.getUserTopLevelDetails(userDetails,userId,instituteId));
    }
    @PostMapping("/get-basic-details")
    public ResponseEntity<List<UserBasicDetailsDto>> getUserBasicDetails(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                         @RequestBody List<String> userIds) {
        return ResponseEntity.ok(userDetailService.getUserBasicDetails(userDetails,userIds));
    }

    @GetMapping("/jwt-update-time")
    public ResponseEntity<UserJwtUpdateDetail> getUserJwtUpdateTime(@RequestAttribute("user") CustomUserDetails userDetails,@RequestParam("userId") String userId) {
        return ResponseEntity.ok(userService.getUserJwtUpdateDetail(userDetails,userId));
    }

    @PutMapping("/update-user")
    public ResponseEntity<UserDTO> updateUser(@RequestBody UserDTO userDTO, @RequestParam("userId") String userId,
                                              @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // userId comes from the query: without this anyone could set anyone's username and
        // password. Both UIs only ever send the caller's own id.
        userAccountAccessGuard.requireCanEditAccount(customUserDetails, userId);
        try {
            userDTO.setId(userId);

            // Credentials go through the one credential path, ahead of every other
            // field: it validates uniqueness (so a taken username aborts before any
            // profile write lands), evicts the old username's auth-cache entries, and
            // fans the rename out to student.username and the four assessment-database
            // copies. They are then cleared from the DTO so the generic profile update
            // below cannot write them a second time down a path that does none of that.
            // A no-op change costs one primary-key read and nothing else.
            String newUsername = userDTO.getUsername();
            String newPassword = userDTO.getPassword();
            if (StringUtils.hasText(newUsername) || StringUtils.hasText(newPassword)) {
                userCredentialUpdateService.updateCredentials(userId, newUsername, newPassword);
                userDTO.setUsername(null);
                userDTO.setPassword(null);
            }

            institutePolicyService.updateLearnerDetails(userDTO);
            UserDTO updated = userService.updateUserDetails(userDTO, userId);
            // This is the endpoint the learner "Change Password" screen calls (PUT with
            // {username, password}). If the password was changed, mirror it to any
            // WordPress LMS the learner's courses are connected to (async, best-effort).
            if (StringUtils.hasText(newPassword)) {
                institutePolicyService.syncLmsPassword(userId, updated.getEmail(), newPassword);
            }
            return ResponseEntity.ok(updated);
        } catch (VacademyException e) {
            // Preserve the status the credential path chose (510 for "username already
            // taken", which is what both UIs match on) instead of flattening it.
            throw e;
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

}
