package vacademy.io.notification_service.features.chatbot_flow.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What WhatsApp will actually accept as a free-form media message, checked before we hand anything
 * to a provider.
 * <p>
 * Meta allows image/video/audio/document/sticker inside the 24-hour customer service window with no
 * template and no approval, but each type has a hard size ceiling and its own caption rule. A send
 * that breaks one of them comes back as an opaque provider error ("WhatsApp rejected the message:
 * 500"), so every rule here is enforced up front and reported in the admin's own terms.
 * <p>
 * The size probe earns its keep twice over: WATI has no send-by-URL endpoint for session messages,
 * so {@code WatiMessageProvider} downloads the whole file into a byte[] before uploading it. A
 * 100 MB document would be a heap spike on a service that also runs the announcement fan-out.
 */
@Component
@Slf4j
public class WhatsAppMediaPolicy {

    public static final String IMAGE = "image";
    public static final String VIDEO = "video";
    public static final String AUDIO = "audio";
    public static final String DOCUMENT = "document";

    /** Meta's per-type ceilings for the Cloud API. */
    private static final Map<String, Long> MAX_BYTES = Map.of(
            IMAGE, 5L * 1024 * 1024,
            VIDEO, 16L * 1024 * 1024,
            AUDIO, 16L * 1024 * 1024,
            DOCUMENT, 100L * 1024 * 1024);

    /** Formats Meta accepts, quoted back to the admin when a send is refused. */
    private static final Map<String, String> ACCEPTED_FORMATS = Map.of(
            IMAGE, "JPEG or PNG",
            VIDEO, "MP4 or 3GPP, H.264 video with AAC audio and a single audio stream",
            AUDIO, "AAC, MP3, M4A, AMR or OGG/Opus",
            DOCUMENT, "PDF, Office documents or plain text");

    /** Default extension per type, used when the URL carries none — WATI reads the type off it. */
    private static final Map<String, String> DEFAULT_EXTENSION = Map.of(
            IMAGE, ".jpg",
            VIDEO, ".mp4",
            AUDIO, ".mp3",
            DOCUMENT, ".pdf");

    private static final Set<String> SUPPORTED = MAX_BYTES.keySet();

    /** Meta's caption limit for image/video/document. Audio takes no caption at all. */
    static final int MAX_CAPTION_LENGTH = 1024;

    private final RestTemplate probeClient;

    public WhatsAppMediaPolicy() {
        // Its own client, not the shared bean: a media host that hangs must not hold an inbox send
        // open, and these timeouts are deliberately shorter than any send timeout.
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(5000);
        this.probeClient = new RestTemplate(factory);
    }

    /** A media send that has passed every rule Meta enforces. */
    public record Media(String type, String url, String caption, String filename) {}

    /**
     * Normalises and validates one media send.
     *
     * @throws ResponseStatusException 400 with a message written for the admin, not for a log file
     */
    public Media validate(String mediaType, String mediaUrl, String caption, String filename) {
        String type = mediaType == null ? "" : mediaType.trim().toLowerCase(Locale.ROOT);
        if (!SUPPORTED.contains(type)) {
            throw badRequest("Unsupported media type '" + mediaType + "'. WhatsApp accepts "
                    + String.join(", ", SUPPORTED) + ".");
        }

        String url = mediaUrl == null ? "" : mediaUrl.trim();
        if (url.isBlank()) {
            throw badRequest("Media URL is required.");
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw badRequest("Media URL must be a public http(s) link that WhatsApp can download.");
        }
        assertNotInternal(url);

        // Audio messages carry no caption in WhatsApp — dropping it is kinder than refusing the
        // send, but silently keeping it would have the admin believe a caption went out.
        String cleanCaption = (caption == null || caption.isBlank()) ? null : caption.trim();
        if (AUDIO.equals(type)) {
            cleanCaption = null;
        } else if (cleanCaption != null && cleanCaption.length() > MAX_CAPTION_LENGTH) {
            throw badRequest("Caption is too long (" + cleanCaption.length() + " characters). "
                    + "WhatsApp allows " + MAX_CAPTION_LENGTH + ".");
        }

        return new Media(type, url, cleanCaption, resolveFilename(type, url, filename));
    }

    /**
     * Refuses a URL that points back inside our own network.
     * <p>
     * The Inbox send endpoint is reachable without a JWT, and on the WATI path this service fetches
     * the URL itself (WATI has no send-by-URL endpoint, so the bytes go through us) before handing
     * the file to WhatsApp. Without this an arbitrary caller could name the cloud metadata endpoint
     * or an internal service and have the response delivered to a phone number of their choosing.
     * <p>
     * Not a complete defence — a name that resolves differently on the second lookup would slip
     * past — but it closes the direct case, and a private address can never be a legitimate media
     * URL here: on the Meta path WhatsApp fetches the file from the public internet anyway.
     */
    private void assertNotInternal(String url) {
        String host;
        try {
            host = URI.create(url).getHost();
        } catch (IllegalArgumentException e) {
            throw badRequest("Media URL is not a valid link.");
        }
        if (host == null || host.isBlank()) {
            throw badRequest("Media URL is not a valid link.");
        }

        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            // Lenient on purpose. On the Meta path WhatsApp fetches the file, not us, so a host this
            // pod cannot resolve may still be perfectly reachable from Meta's side — refusing here
            // would break a send that would have worked. A name we cannot resolve is also a name we
            // cannot reach, so nothing internal is exposed by letting it through.
            log.debug("Could not resolve media host {} for internal-address check: {}", host, e.getMessage());
            return;
        }
        for (InetAddress address : addresses) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()
                    || isUniqueLocalIpv6(address)) {
                throw badRequest("Media URL must be a public link. Upload the file first, "
                        + "then send its public URL.");
            }
        }
    }

    /** fc00::/7 — the IPv6 equivalent of a private range, which isSiteLocalAddress misses. */
    private static boolean isUniqueLocalIpv6(InetAddress address) {
        byte[] bytes = address.getAddress();
        return bytes.length == 16 && (bytes[0] & 0xFE) == 0xFC;
    }

    /**
     * Rejects a file we can prove is over Meta's limit.
     * <p>
     * Deliberately inconclusive-friendly: a host that refuses HEAD, or answers without a
     * Content-Length, leaves the send to proceed. Only a length we actually read and that actually
     * exceeds the ceiling blocks it — guessing would break sends that would have worked.
     */
    public void checkSize(Media media) {
        Long limit = MAX_BYTES.get(media.type());
        if (limit == null) return;

        Long contentLength;
        try {
            ResponseEntity<Void> head = probeClient.exchange(
                    URI.create(media.url()), HttpMethod.HEAD, null, Void.class);
            HttpHeaders headers = head.getHeaders();
            long length = headers.getContentLength();
            contentLength = length > 0 ? length : null;
        } catch (Exception e) {
            log.debug("Could not size-check media {}: {}", media.url(), e.getMessage());
            return;
        }
        if (contentLength == null || contentLength <= limit) return;

        throw badRequest(capitalise(media.type()) + " is " + megabytes(contentLength)
                + " — WhatsApp's limit for " + media.type() + " is " + megabytes(limit) + ". "
                + "Accepted formats: " + ACCEPTED_FORMATS.get(media.type()) + ".");
    }

    /** The metadata stored on notification_log.message_payload so the thread can re-render it. */
    public Map<String, Object> toLogPayload(Media media) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("mediaType", media.type());
        payload.put("mediaUrl", media.url());
        if (media.filename() != null) payload.put("filename", media.filename());
        if (media.caption() != null) payload.put("caption", media.caption());
        return payload;
    }

    /**
     * Placeholder body for the conversation list, where a bare caption-less image would otherwise
     * render as an empty row.
     */
    public String summaryBody(Media media) {
        if (media.caption() != null) return media.caption();
        return switch (media.type()) {
            case IMAGE -> "📷 Photo";
            case VIDEO -> "🎥 Video";
            case AUDIO -> "🎧 Audio";
            default -> "📄 " + media.filename();
        };
    }

    /**
     * WATI has no way to declare the media type — it reads it off the uploaded file's name, so a
     * URL with no extension arrives as a document called "file". Prefer the caller's filename, then
     * the URL's own basename, and fall back to the type's default extension.
     */
    private String resolveFilename(String type, String url, String filename) {
        if (filename != null && !filename.isBlank()) {
            return withExtension(filename.trim(), type);
        }
        String path = url;
        int queryAt = path.indexOf('?');
        if (queryAt >= 0) path = path.substring(0, queryAt);
        int slashAt = path.lastIndexOf('/');
        String basename = slashAt >= 0 ? path.substring(slashAt + 1) : path;
        if (basename.isBlank()) basename = type;
        return withExtension(basename, type);
    }

    private String withExtension(String name, String type) {
        return name.contains(".") ? name : name + DEFAULT_EXTENSION.get(type);
    }

    private static String megabytes(long bytes) {
        return String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private static String capitalise(String value) {
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
