package vacademy.io.auth_service.feature.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request body for the native iOS "Sign in with Apple" login.
 *
 * The learner app obtains these from the native ASAuthorization sheet via the
 * {@code @capacitor-community/apple-sign-in} plugin and POSTs them to
 * {@code /auth-service/learner/v1/oauth/apple/native}.
 *
 * Note: {@code givenName}/{@code familyName}/{@code email} are returned by Apple
 * ONLY on the very first authorization per Apple ID per app — they are null on
 * every subsequent sign-in. The {@code email} claim inside the verified
 * {@code identityToken} is the source of truth; these convenience fields are a
 * first-sign-in fallback only.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AppleNativeLoginRequestDto {

    /** Apple-issued OIDC id_token (RS256 JWT) — verified server-side against Apple's JWKS. */
    private String identityToken;

    /** Short-lived Apple authorization code (unused for P0 JWKS-only verification). */
    private String authorizationCode;

    /** Stable Apple subject id as surfaced by the plugin ({@code user}); the id_token {@code sub} is authoritative. */
    private String user;

    /** First-sign-in convenience email. Not used for sign-in: only the id_token {@code email} is trusted. */
    private String email;

    /** First-sign-in given name (null afterwards). */
    private String givenName;

    /** First-sign-in family name (null afterwards). */
    private String familyName;

    /** Optional pre-composed full name. */
    private String fullName;

    /** Nonce echoed verbatim by Apple inside the id_token (OIDC session binding;
     *  client-generated, so logged-not-enforced server-side — see controller). */
    private String nonce;

    /** Institute the learner is signing into (required — drives signup policy / session limits / theming). */
    private String instituteId;

    /** Originating platform, e.g. "ios" (informational). */
    private String platform;
}
