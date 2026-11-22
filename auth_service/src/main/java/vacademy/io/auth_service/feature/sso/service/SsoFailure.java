package vacademy.io.auth_service.feature.sso.service;

/**
 * A sign-in that cannot finish. {@code code} goes to the learner portal as ?sso_error=<code>
 * (a fixed set the portal translates); the message is for logs and the admin test page.
 */
public class SsoFailure extends RuntimeException {

    private final String code;

    public SsoFailure(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
