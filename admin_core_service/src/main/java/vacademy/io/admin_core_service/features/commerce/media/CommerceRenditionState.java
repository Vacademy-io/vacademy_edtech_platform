package vacademy.io.admin_core_service.features.commerce.media;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * The shape of {@code commerce_product_media.renditions_json}.
 *
 * <p>Keys that are numbers are rendition widths and their values are public URLs:
 * {@code {"320": "https://...", "640": "https://..."}}. Keys that start with an underscore
 * belong to the rendition job and must never reach a public response; a public reader takes
 * {@link #urls(Map)} and nothing else.
 *
 * <p>A row whose column is NULL has not been processed yet and counts as PENDING, so a row
 * written by any other path (an import, a script) is picked up without further steps.
 */
public final class CommerceRenditionState {

    public static final String KEY_STATUS = "_status";
    public static final String KEY_ATTEMPTS = "_attempts";
    public static final String KEY_ERROR = "_error";
    public static final String KEY_NEXT_ATTEMPT_AT = "_next_attempt_at";
    public static final String KEY_CLAIMED_AT = "_claimed_at";
    public static final String KEY_MEDIA_ID = "_media_id";
    public static final String KEY_PIPELINE_VERSION = "_v";

    public static final String PENDING = "PENDING";
    public static final String PROCESSING = "PROCESSING";
    public static final String READY = "READY";
    public static final String FAILED = "FAILED";
    /** The media service code for "other images are being processed". */
    public static final String BUSY = "BUSY";
    /** The media service code for a file that may not get a public copy (not this shop's product image). */
    public static final String NOT_PUBLIC = "NOT_PUBLIC";

    /** After this many tries a retryable failure becomes FAILED and waits for a person. */
    public static final int MAX_ATTEMPTS = 5;
    /** A claim older than this was left behind by a pod that stopped; the row is taken again. */
    public static final long STALE_CLAIM_SECONDS = 600;

    private static final long[] BACKOFF_SECONDS = {60, 300, 1800, 7200};

    private CommerceRenditionState() {
    }

    /** PENDING, PROCESSING, READY or FAILED. */
    public static String status(Map<String, Object> state) {
        if (state == null) {
            return PENDING;
        }
        Object status = state.get(KEY_STATUS);
        if (PENDING.equals(status) || PROCESSING.equals(status) || READY.equals(status) || FAILED.equals(status)) {
            return (String) status;
        }
        return urls(state).isEmpty() ? PENDING : READY;
    }

    /** Width to URL, ascending, without the job's own keys. Empty when there are none yet. */
    public static Map<Integer, String> urls(Map<String, Object> state) {
        if (state == null) {
            return Collections.emptyMap();
        }
        Map<Integer, String> urls = new TreeMap<>();
        for (Map.Entry<String, Object> entry : state.entrySet()) {
            Integer width = widthOf(entry.getKey());
            if (width != null && entry.getValue() instanceof String url && !url.isBlank()) {
                urls.put(width, url);
            }
        }
        return urls;
    }

    public static int attempts(Map<String, Object> state) {
        return (int) number(state, KEY_ATTEMPTS);
    }

    /** True when the job should work on a row in this state now. */
    public static boolean isDue(Map<String, Object> state, String mediaId, long nowSeconds) {
        if (state == null) {
            return true;
        }
        Object recordedFor = state.get(KEY_MEDIA_ID);
        if (recordedFor != null && !recordedFor.equals(mediaId)) {
            return true;
        }
        return switch (status(state)) {
            case PENDING -> number(state, KEY_NEXT_ATTEMPT_AT) <= nowSeconds;
            case PROCESSING -> number(state, KEY_CLAIMED_AT) < nowSeconds - STALE_CLAIM_SECONDS;
            default -> false;
        };
    }

    /** The claim a worker writes before it calls the media service. URLs of the same file are kept. */
    public static Map<String, Object> processing(Map<String, Object> current, String mediaId, long nowSeconds) {
        Map<String, Object> next = carryUrls(current, mediaId);
        next.put(KEY_STATUS, PROCESSING);
        next.put(KEY_MEDIA_ID, mediaId);
        next.put(KEY_ATTEMPTS, sameFile(current, mediaId) ? attempts(current) + 1 : 1);
        next.put(KEY_CLAIMED_AT, nowSeconds);
        return next;
    }

    public static Map<String, Object> ready(Map<String, Object> claim, String mediaId, Map<Integer, String> urls,
                                            int pipelineVersion) {
        Map<String, Object> next = new LinkedHashMap<>();
        new TreeMap<>(urls).forEach((width, url) -> next.put(String.valueOf(width), url));
        next.put(KEY_STATUS, READY);
        next.put(KEY_MEDIA_ID, mediaId);
        next.put(KEY_ATTEMPTS, attempts(claim));
        next.put(KEY_PIPELINE_VERSION, pipelineVersion);
        return next;
    }

    /**
     * What a failed try leaves behind: PENDING with a later time while tries remain and the
     * error can pass by itself, FAILED otherwise.
     */
    public static Map<String, Object> afterFailure(Map<String, Object> claim, String mediaId, String error,
                                                   boolean retryable, long nowSeconds) {
        Map<String, Object> next = carryUrls(claim, mediaId);
        int attempts = Math.max(1, attempts(claim));
        if (BUSY.equals(error)) {
            // The media service was working on other images: nothing was tried, so no try is used up.
            next.put(KEY_MEDIA_ID, mediaId);
            next.put(KEY_ATTEMPTS, attempts - 1);
            next.put(KEY_ERROR, error);
            next.put(KEY_STATUS, PENDING);
            next.put(KEY_NEXT_ATTEMPT_AT, nowSeconds + BACKOFF_SECONDS[0]);
            return next;
        }
        next.put(KEY_MEDIA_ID, mediaId);
        next.put(KEY_ATTEMPTS, attempts);
        next.put(KEY_ERROR, error);
        if (retryable && attempts < MAX_ATTEMPTS) {
            next.put(KEY_STATUS, PENDING);
            next.put(KEY_NEXT_ATTEMPT_AT, nowSeconds + backoffSeconds(attempts));
        } else {
            next.put(KEY_STATUS, FAILED);
        }
        return next;
    }

    /** Merged over a row to queue it again from the first try (the old error is removed in the statement). */
    public static Map<String, Object> requeuePatch() {
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put(KEY_STATUS, PENDING);
        patch.put(KEY_ATTEMPTS, 0);
        patch.put(KEY_NEXT_ATTEMPT_AT, 0);
        return patch;
    }

    static long backoffSeconds(int attempts) {
        int index = Math.max(0, Math.min(BACKOFF_SECONDS.length - 1, attempts - 1));
        return BACKOFF_SECONDS[index];
    }

    private static boolean sameFile(Map<String, Object> state, String mediaId) {
        return state != null && (state.get(KEY_MEDIA_ID) == null || state.get(KEY_MEDIA_ID).equals(mediaId));
    }

    private static Map<String, Object> carryUrls(Map<String, Object> state, String mediaId) {
        Map<String, Object> next = new LinkedHashMap<>();
        if (sameFile(state, mediaId)) {
            urls(state).forEach((width, url) -> next.put(String.valueOf(width), url));
        }
        return next;
    }

    private static Integer widthOf(String key) {
        if (key == null || key.isEmpty() || key.length() > 5) {
            return null;
        }
        for (int i = 0; i < key.length(); i++) {
            if (key.charAt(i) < '0' || key.charAt(i) > '9') {
                return null;
            }
        }
        int width = Integer.parseInt(key);
        return width > 0 ? width : null;
    }

    private static long number(Map<String, Object> state, String key) {
        Object value = state == null ? null : state.get(key);
        return value instanceof Number n ? n.longValue() : 0L;
    }
}
