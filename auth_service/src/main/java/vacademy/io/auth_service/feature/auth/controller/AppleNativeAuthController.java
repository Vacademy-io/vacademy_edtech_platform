package vacademy.io.auth_service.feature.auth.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.auth.dto.AppleNativeLoginRequestDto;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.manager.LearnerOAuth2Manager;
import vacademy.io.auth_service.feature.auth.service.AppleIdentityTokenVerifier;
import vacademy.io.common.auth.entity.OAuth2VendorToUserDetail;
import vacademy.io.common.auth.repository.OAuth2VendorToUserDetailRepository;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Native "Sign in with Apple" for the learner iOS app.
 *
 * <p>The web/Android social-login flow is a Spring OAuth2 server-side redirect
 * (CustomOAuth2SuccessHandler). iOS instead uses the native ASAuthorization
 * sheet, which returns an id_token directly to the app — so there is no browser
 * round-trip and no Universal-Link callback. The app POSTs the id_token here;
 * we verify it against Apple's JWKS and reuse the exact same token-minting path
 * the redirect flow uses ({@link LearnerOAuth2Manager#loginUserByEmail}).
 *
 * <p>Lives under {@code /auth-service/learner/v1/**}, which is permit-all in
 * {@code ApplicationSecurityConfig.ALLOWED_PATHS}.
 */
@RestController
@RequestMapping("/auth-service/learner/v1/oauth/apple")
public class AppleNativeAuthController {

    private static final Logger log = LoggerFactory.getLogger(AppleNativeAuthController.class);

    private static final String VENDOR_APPLE = "apple";

    @Autowired
    private AppleIdentityTokenVerifier appleIdentityTokenVerifier;

    @Autowired
    private LearnerOAuth2Manager learnerOAuth2Manager;

    @Autowired
    private OAuth2VendorToUserDetailService oAuth2VendorToUserDetailService;

    @Autowired
    private OAuth2VendorToUserDetailRepository oAuth2VendorToUserDetailRepository;

    @PostMapping("/native")
    public JwtResponseDto appleNativeLogin(@RequestBody AppleNativeLoginRequestDto request) throws Exception {
        if (request == null || !StringUtils.hasText(request.getIdentityToken())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "identityToken is required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }

        Jwt jwt = appleIdentityTokenVerifier.verify(request.getIdentityToken());

        String sub = jwt.getSubject();
        if (!StringUtils.hasText(sub)) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Apple identity token is missing a subject");
        }

        // Nonce: Apple echoes request.nonce VERBATIM into the id_token (OIDC), and
        // the plugin forwards our raw value unhashed, so token nonce == body nonce.
        // We do NOT hard-fail on a mismatch: the nonce is client-generated on both
        // sides, so it adds no real replay protection (the actual controls are the
        // RS256 signature + issuer + audience + exp checks in the verifier). A
        // mismatch is logged for observability only. True single-use replay
        // protection would require a server-issued nonce (tracked for P1).
        if (StringUtils.hasText(request.getNonce())) {
            String tokenNonce = jwt.getClaimAsString("nonce");
            if (StringUtils.hasText(tokenNonce) && !tokenNonce.equals(request.getNonce())) {
                log.warn("Apple id_token nonce did not match the request nonce (sub={}); continuing", sub);
            }
        }

        // Email: only the verified id_token claim is trusted. When the token
        // carries no email, the sign-in is accepted only if this Apple subject
        // is already linked to an email from an earlier sign-in.
        String tokenEmail = jwt.getClaimAsString("email");
        Object isPrivateRelay = jwt.getClaims().get("is_private_email");
        String email;

        if (StringUtils.hasText(tokenEmail)) {
            email = tokenEmail;
            // ── Account-linking policy (keyed on the stable Apple subject) ──
            // The Apple `sub` is the canonical identity for this user, independent of
            // whether they share a real email or a stable "Hide My Email" relay
            // address. We recover any email previously recorded for this sub so that:
            //   • a returning user (incl. relay users) always lands on the SAME account;
            //   • a first-time real (shared) email links to any existing account with
            //     that address (cross-provider linking with a prior Google/email signup);
            //   • a first-time relay address has no prior match, so a new account is
            //     created and bound to this sub for next time.
            // This call also upserts the (apple, sub, email) mapping — mirrors the
            // GitHub private-email recovery in CustomOAuth2SuccessHandler.
            String recoveredEmail = oAuth2VendorToUserDetailService
                    .getEmailByProviderIdAndSubject(VENDOR_APPLE, sub, tokenEmail);
            if (StringUtils.hasText(recoveredEmail)) {
                email = recoveredEmail;
            }
        } else {
            email = oAuth2VendorToUserDetailRepository.findByProviderIdAndSubject(VENDOR_APPLE, sub)
                    .map(OAuth2VendorToUserDetail::getEmailId)
                    .filter(StringUtils::hasText)
                    .orElse(null);
            if (email == null) {
                throw new VacademyException(HttpStatus.UNAUTHORIZED, "Invalid Apple identity token");
            }
        }

        if (!StringUtils.hasText(email)) {
            // Email-keyed matching: without any email we cannot match or create.
            throw new VacademyException(HttpStatus.UNAUTHORIZED,
                    "Apple did not return an email address for this account");
        }

        String fullName = resolveFullName(request, email);

        log.info("Native Apple sign-in: institute={} sub={} privateRelay={}",
                request.getInstituteId(), sub, isPrivateRelay);

        JwtResponseDto response = learnerOAuth2Manager.loginUserByEmail(
                fullName, email, request.getInstituteId(), sub, VENDOR_APPLE);

        if (response == null) {
            // null == no matching user and institute signup policy forbids auto-create
            // (e.g. manual password strategy) or no policy configured.
            throw new VacademyException(HttpStatus.UNAUTHORIZED,
                    "We couldn't find or create an account for this Apple sign-in. Please contact your administrator.");
        }
        return response;
    }

    /**
     * Composes a display name from the first-sign-in fields, falling back to the
     * email local-part (Apple returns name only on the first authorization).
     */
    private String resolveFullName(AppleNativeLoginRequestDto request, String email) {
        String given = request.getGivenName() == null ? "" : request.getGivenName().trim();
        String family = request.getFamilyName() == null ? "" : request.getFamilyName().trim();
        String composed = (given + " " + family).trim();
        if (StringUtils.hasText(composed)) {
            return composed;
        }
        if (StringUtils.hasText(request.getFullName())) {
            return request.getFullName().trim();
        }
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }
}
