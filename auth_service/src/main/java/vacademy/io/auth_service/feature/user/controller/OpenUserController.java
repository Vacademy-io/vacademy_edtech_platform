package vacademy.io.auth_service.feature.user.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Objects;
import java.util.Optional;

@RestController
@RequestMapping("/auth-service/open/user-details")
@RequiredArgsConstructor
public class OpenUserController {
    @Autowired
    private UserOperationService userOperationService;

    @PostMapping("/by-email")
    public ResponseEntity<UserDTO> findUserByEmail(@RequestParam String emailId){
        UserDTO user = userOperationService.findUserByEmail(emailId);
        if (Objects.isNull(user)){
            return ResponseEntity.notFound().build();
        }
        // Open route: the stored password is never part of this answer. The internal
        // (HMAC) by-email lookup shares findUserByEmail and is unchanged.
        user.setPassword(null);
        return ResponseEntity.ok(user);
    }

    /**
     * Look up a learner by username for the public join-link flow.
     *
     * <p>{@code instituteId} is optional: usernames are globally unique, and institutes
     * served from a shared domain have no institute_domain_routing row to resolve an id
     * from — demanding one 400'd/404'd their learners out of their own join link. Supply
     * it to scope the lookup, omit it to match on username + portal role alone.</p>
     */
    @GetMapping("/by-username")
    public ResponseEntity<UserDTO> findUserByUsername(
            @RequestParam String username,
            @RequestParam String portal,
            @RequestParam(required = false) String instituteId) {

        Optional<UserDTO> optionalUser = userOperationService.findByUserName(username, instituteId, portal);

        return optionalUser
                .map(ResponseEntity::ok)        // Return 200 OK with the user
                .orElseGet(() -> ResponseEntity.notFound().build()); // Return 404 if user not found
    }
}
