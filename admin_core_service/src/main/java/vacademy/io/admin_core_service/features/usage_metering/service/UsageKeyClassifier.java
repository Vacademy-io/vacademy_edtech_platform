package vacademy.io.admin_core_service.features.usage_metering.service;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decides which institute a media object belongs to and what kind of file it is,
 * from its S3 key alone.
 *
 * <p>Institute: the first of the key's first three path segments that is an
 * institute id (most uploads are {@code <instituteId>/...} or
 * {@code <SOURCE>/<instituteId>/...}); otherwise, for a class recording
 * ({@code BBB_RECORDING/<meetingId>/...} and the like), the institute that owns the
 * live-session schedule with that meeting id. Anything else is {@link #UNASSIGNED}.
 */
public final class UsageKeyClassifier {

    public static final String UNASSIGNED = "_UNASSIGNED";

    public static final String RECORDING = "RECORDING";
    public static final String VIDEO = "VIDEO";
    public static final String AUDIO = "AUDIO";
    public static final String DOCUMENT = "DOCUMENT";
    public static final String IMAGE = "IMAGE";
    public static final String OTHER = "OTHER";

    private static final Set<String> RECORDING_PREFIXES =
            Set.of("BBB_RECORDING", "ZOOM_RECORDING", "GOOGLE_MEET_RECORDING", "AI_CALL_RECORDING");
    private static final Set<String> VIDEO_EXT = Set.of("mp4", "mov", "mkv", "webm", "m4v", "avi", "m3u8", "ts", "flv");
    private static final Set<String> AUDIO_EXT = Set.of("mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "weba");
    private static final Set<String> DOCUMENT_EXT = Set.of("pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv",
            "txt", "html", "htm", "epub", "odt", "odp", "rtf", "json", "zip");
    private static final Set<String> IMAGE_EXT = Set.of("png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "avif", "ico");

    private final Set<String> instituteIds;
    private final Map<String, String> meetingToInstitute;

    /**
     * @param instituteIds       every institute id
     * @param meetingToInstitute live-session schedule id and provider meeting id -> institute id
     */
    public UsageKeyClassifier(Set<String> instituteIds, Map<String, String> meetingToInstitute) {
        this.instituteIds = instituteIds;
        this.meetingToInstitute = meetingToInstitute;
    }

    public String instituteFor(String key) {
        if (key == null || key.isEmpty()) {
            return UNASSIGNED;
        }
        String[] segments = key.split("/", 4);
        for (int i = 0; i < Math.min(3, segments.length); i++) {
            if (instituteIds.contains(segments[i])) {
                return segments[i];
            }
        }
        if (segments.length > 1 && RECORDING_PREFIXES.contains(segments[0])) {
            String owner = meetingToInstitute.get(segments[1]);
            if (owner != null) {
                return owner;
            }
        }
        return UNASSIGNED;
    }

    public static String categoryFor(String key) {
        if (key == null || key.isEmpty()) {
            return OTHER;
        }
        int slash = key.indexOf('/');
        if (slash > 0 && RECORDING_PREFIXES.contains(key.substring(0, slash))) {
            return RECORDING;
        }
        int dot = key.lastIndexOf('.');
        if (dot < 0 || dot < key.lastIndexOf('/')) {
            return OTHER;
        }
        String ext = key.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (VIDEO_EXT.contains(ext)) return VIDEO;
        if (AUDIO_EXT.contains(ext)) return AUDIO;
        if (DOCUMENT_EXT.contains(ext)) return DOCUMENT;
        if (IMAGE_EXT.contains(ext)) return IMAGE;
        return OTHER;
    }
}
