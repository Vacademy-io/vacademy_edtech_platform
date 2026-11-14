package vacademy.io.auth_service.feature.panel.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.*;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelChallengeService;
import vacademy.io.auth_service.feature.panel.service.PanelPairingService;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelRateLimiter;
import vacademy.io.auth_service.feature.panel.service.PanelSessionService;

/**
 * Called by panels and the phone remote with credentials in the body and no Authorization header.
 * The path is under /auth-service/public/v1/**, which the security config already permits.
 *
 * <p>The switch-off and the pairing cap are answered here, before any *Service call: the shared
 * logging aspect records every 5xx thrown through a *Service method as a failure, and a fleet of
 * panels retrying against a switched-off server would otherwise fill the error log.
 */
@RestController
@RequestMapping("/auth-service/public/v1/panel")
public class PanelPublicController {

    private final PanelPairingService pairing;
    private final PanelChallengeService challenges;
    private final PanelSessionService sessions;
    private final PanelProperties properties;
    private final PanelRateLimiter rateLimiter;

    public PanelPublicController(PanelPairingService pairing, PanelChallengeService challenges,
            PanelSessionService sessions, PanelProperties properties, PanelRateLimiter rateLimiter) {
        this.pairing = pairing;
        this.challenges = challenges;
        this.sessions = sessions;
        this.properties = properties;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/pair/start")
    public PairStartResponse pairStart(@RequestBody PairStartRequest body, HttpServletRequest request) {
        properties.requireEnabled();
        if (pairing.pendingCapReached()) {
            throw PanelApiException.busy(HttpStatus.SERVICE_UNAVAILABLE);
        }
        return pairing.start(body, rateLimiter.clientIp(request));
    }

    @PostMapping("/pair/poll")
    public PairPollResponse pairPoll(@RequestBody PairPollRequest body) {
        return pairing.poll(body);
    }

    @PostMapping("/pair/confirm")
    public StatusResponse pairConfirm(@RequestBody PairConfirmRequest body) {
        return pairing.confirm(body);
    }

    @PostMapping("/sync")
    public SyncResponse sync(@RequestBody SyncRequest body, HttpServletRequest request) {
        return sessions.sync(body, rateLimiter.clientIp(request));
    }

    @PostMapping("/challenge")
    public ChallengeResponse challenge(@RequestBody ChallengeRequest body) {
        properties.requireEnabled();
        return challenges.create(body);
    }

    @PostMapping("/challenge/poll")
    public ChallengePollResponse challengePoll(@RequestBody ChallengePollRequest body) {
        return challenges.poll(body);
    }

    @PostMapping("/challenge/info")
    public ChallengeInfoResponse challengeInfo(@RequestBody ChallengeInfoRequest body, HttpServletRequest request) {
        return challenges.info(body, rateLimiter.clientIp(request));
    }

    @PostMapping("/session/refresh")
    public SessionRefreshResponse sessionRefresh(@RequestBody SessionRefreshRequest body) {
        return sessions.refresh(body);
    }

    @PostMapping("/session/end")
    public EndedResponse sessionEnd(@RequestBody SessionEndRequest body) {
        return sessions.end(body);
    }

    @PostMapping("/session/login-password")
    public RedeemedSession loginPassword(@RequestBody LoginPasswordRequest body) {
        properties.requireEnabled();
        return sessions.loginPassword(body);
    }

    @PostMapping("/remote/nav")
    public RemoteNavResponse remoteNav(@RequestBody RemoteNavRequest body) {
        return sessions.remoteNav(body);
    }

    @PostMapping("/remote/state")
    public RemoteStateResponse remoteState(@RequestBody RemoteTokenRequest body) {
        return sessions.remoteState(body);
    }

    @PostMapping("/remote/end")
    public EndedResponse remoteEnd(@RequestBody RemoteTokenRequest body) {
        return sessions.remoteEnd(body);
    }
}
