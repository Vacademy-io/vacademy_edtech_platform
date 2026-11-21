package vacademy.io.auth_service.feature.panel.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.service.PanelChallengeService;
import vacademy.io.auth_service.feature.panel.service.PanelPairingService;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Called from a staff member's phone or browser with a Bearer token and no clientId header. Who may do
 * what is decided from user_role for the institute in question, never from JWT authorities.
 */
@RestController
@RequestMapping("/auth-service/v1/panel")
public class PanelTeacherController {

    private final PanelPairingService pairing;
    private final PanelChallengeService challenges;
    private final PanelSessionService sessions;
    private final PanelRateLimiter rateLimiter;

    public PanelTeacherController(PanelPairingService pairing, PanelChallengeService challenges,
            PanelSessionService sessions, PanelRateLimiter rateLimiter) {
        this.pairing = pairing;
        this.challenges = challenges;
        this.sessions = sessions;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/pair/preview")
    public PairPreviewResponse pairPreview(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody PairPreviewRequest body) {
        return pairing.preview(user, body);
    }

    @PostMapping("/challenge/describe")
    public ChallengeDescribeResponse describe(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody ChallengeDescribeRequest body) {
        return challenges.describe(user, body);
    }

    @PostMapping("/challenge/approve")
    public Object approve(@RequestAttribute("user") CustomUserDetails user,
            @RequestBody ChallengeApproveRequest body, HttpServletRequest request) {
        return challenges.approve(user, body, rateLimiter.clientIp(request));
    }

    @GetMapping("/my-session")
    public ResponseEntity<MySessionResponse> mySession(@RequestAttribute("user") CustomUserDetails user) {
        return sessions.mySession(user).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/my-session/end")
    public EndedResponse mySessionEnd(@RequestAttribute("user") CustomUserDetails user) {
        return sessions.mySessionEnd(user);
    }
}
