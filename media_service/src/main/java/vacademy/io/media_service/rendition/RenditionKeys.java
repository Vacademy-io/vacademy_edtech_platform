package vacademy.io.media_service.rendition;

import java.util.regex.Pattern;

/**
 * Where a rendition lives in the public bucket. The key depends only on the file id, the
 * pipeline version and the width, so a second run finds what the first one stored, and the
 * object can be cached for a year: when the encoding rules change, {@link #PIPELINE_VERSION}
 * changes and with it every key.
 */
public final class RenditionKeys {

    public static final String PREFIX = "COMMERCE_RENDITION/";
    /** Raise when the output for the same source would differ (sizes, quality, colour handling). */
    public static final int PIPELINE_VERSION = 1;

    private static final Pattern FILE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");

    private RenditionKeys() {
    }

    public static boolean isValidFileId(String fileId) {
        return fileId != null && FILE_ID.matcher(fileId).matches();
    }

    public static String key(String fileId, int width) {
        if (!isValidFileId(fileId)) {
            throw new IllegalArgumentException("not a file id");
        }
        if (width < 1) {
            throw new IllegalArgumentException("width must be positive");
        }
        return PREFIX + "v" + PIPELINE_VERSION + "/" + fileId + "/w" + width + ".webp";
    }
}
