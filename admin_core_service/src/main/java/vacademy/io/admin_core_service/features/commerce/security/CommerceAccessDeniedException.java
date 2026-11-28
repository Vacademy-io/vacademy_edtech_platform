package vacademy.io.admin_core_service.features.commerce.security;

import vacademy.io.common.exceptions.ForbiddenException;

/**
 * A commerce refusal. It is a {@link ForbiddenException}, so the shared handler answers 403;
 * the message starts with the code ({@code FEATURE_DISABLED: ...}) because the shared error
 * body has no separate code field.
 */
public class CommerceAccessDeniedException extends ForbiddenException {

    public static final String ACCESS_DENIED = "ACCESS_DENIED";
    public static final String FEATURE_DISABLED = "FEATURE_DISABLED";
    public static final String ROLE_NOT_ALLOWED = "ROLE_NOT_ALLOWED";
    public static final String LOCATION_NOT_ALLOWED = "LOCATION_NOT_ALLOWED";
    public static final String PIN_INVALID = "PIN_INVALID";
    public static final String PIN_LOCKED = "PIN_LOCKED";
    public static final String INSTITUTE_WIDE_REQUIRED = "INSTITUTE_WIDE_REQUIRED";

    private final String code;

    public CommerceAccessDeniedException(String code, String message) {
        super(code + ": " + message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
