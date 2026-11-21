package vacademy.io.media_service.rendition;

public class RenditionException extends Exception {

    private final RenditionError error;

    public RenditionException(RenditionError error, String message) {
        super(message);
        this.error = error;
    }

    public RenditionException(RenditionError error, String message, Throwable cause) {
        super(message, cause);
        this.error = error;
    }

    public RenditionError getError() {
        return error;
    }
}
