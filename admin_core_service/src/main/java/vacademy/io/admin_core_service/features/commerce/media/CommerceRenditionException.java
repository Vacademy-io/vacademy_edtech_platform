package vacademy.io.admin_core_service.features.commerce.media;

/** The media service did not make the renditions. */
public class CommerceRenditionException extends Exception {

    private final String code;
    private final boolean retryable;

    public CommerceRenditionException(String code, boolean retryable, String message) {
        super(message);
        this.code = code;
        this.retryable = retryable;
    }

    public String getCode() {
        return code;
    }

    public boolean isRetryable() {
        return retryable;
    }
}
