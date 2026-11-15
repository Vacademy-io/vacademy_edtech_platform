package vacademy.io.media_service.rendition;

/** Why renditions could not be made. A retryable error may succeed later without any change. */
public enum RenditionError {
    INVALID_FILE_ID(false),
    FILE_NOT_FOUND(false),
    /** The file is private by its source or key prefix; no public copy of it is ever made. */
    NOT_PUBLIC(false),
    /** The object is in neither bucket yet (an upload still in flight). */
    SOURCE_MISSING(true),
    TOO_LARGE(false),
    NOT_AN_IMAGE(false),
    /** An image, but one this pipeline does not take (animated, CMYK, damaged). */
    UNSUPPORTED_IMAGE(false),
    TOO_MANY_PIXELS(false),
    BUSY(true),
    ENCODER_UNAVAILABLE(true),
    ENCODE_FAILED(true),
    STORAGE_ERROR(true);

    private final boolean retryable;

    RenditionError(boolean retryable) {
        this.retryable = retryable;
    }

    public boolean isRetryable() {
        return retryable;
    }
}
