package vacademy.io.assessment_service.features.open_evaluation.auth;

import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

/**
 * The API key behind the current partner request. The tenant always comes from here,
 * never from a request body or parameter (spec principle 7).
 */
public final class OpenApiCaller {

    private OpenApiCaller() {
    }

    /** The calling key; 401 if the request somehow reached a controller without one. */
    public static ApiKeyPrincipal require() {
        return ApiKeyAuthentication.current().orElseThrow(() -> new OpenApiException(HttpStatus.UNAUTHORIZED,
                ApiErrorCode.INVALID_API_KEY, "This endpoint needs a valid API key in the X-API-Key header."));
    }
}
