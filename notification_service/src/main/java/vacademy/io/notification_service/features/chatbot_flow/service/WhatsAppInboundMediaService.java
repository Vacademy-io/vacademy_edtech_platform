package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ProviderMediaCredentials;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.WatiMessageProvider;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.util.Locale;

/**
 * Fetches the photo / sticker / voice note / video / document a learner sent, so the Inbox can draw
 * it instead of "[sticker]".
 * <p>
 * The file is not public: Meta serves it behind the institute's access token (and only for about
 * 30 days), WATI behind its own. So the browser cannot be handed a URL — this fetches it
 * server-side and streams the bytes back. The token is only ever sent to the provider's own hosts.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppInboundMediaService {

    /** WhatsApp's own ceiling for a document is 100 MB; the Inbox only previews up to this. */
    static final long MAX_BYTES = 25L * 1024 * 1024;

    private final NotificationLogRepository notificationLogRepository;
    private final CombotMessageProvider combotProvider;
    private final WatiMessageProvider watiProvider;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public record MediaFile(byte[] bytes, String contentType, String filename) {}

    public MediaFile fetch(String messageId, String instituteId) {
        NotificationLog nl = notificationLogRepository.findById(messageId)
                .filter(row -> instituteId != null && instituteId.equals(row.getInstituteId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Message not found"));

        InboundWhatsAppMessage in = InboundWhatsAppMessage.parse(nl.getMessagePayload(), objectMapper);
        if (in == null || !in.hasMedia()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This message has no attachment");
        }

        return InboundWhatsAppMessage.MEDIA_SOURCE_WATI.equals(in.mediaSource())
                ? fetchFromWati(in, instituteId)
                : fetchFromMeta(in, instituteId);
    }

    /** Meta Cloud API: GET /{media-id} gives a short-lived URL, which needs the same token. */
    private MediaFile fetchFromMeta(InboundWhatsAppMessage in, String instituteId) {
        ProviderMediaCredentials creds = combotProvider.mediaCredentials(instituteId);
        if (creds == null) throw notConfigured();

        String lookupUrl = trimSlash(creds.apiUrl()) + "/" + in.mediaRef();
        JsonNode info;
        try {
            byte[] raw = download(lookupUrl, creds.token(), 64 * 1024);
            info = objectMapper.readTree(raw);
        } catch (HttpStatusCodeException e) {
            // Meta answers 400/404 once the media has aged out (≈30 days) or was never ours.
            if (e.getStatusCode().is4xxClientError()) throw expired();
            throw providerError(e);
        } catch (IOException e) {
            throw providerError(e);
        }

        String fileUrl = info.path("url").asText(null);
        if (fileUrl == null || !isMetaMediaHost(fileUrl)) {
            log.warn("Meta media lookup for {} returned no usable URL", in.mediaRef());
            throw expired();
        }
        long size = info.path("file_size").asLong(0);
        if (size > MAX_BYTES) throw tooLarge();

        try {
            byte[] bytes = download(fileUrl, creds.token(), MAX_BYTES);
            String type = info.path("mime_type").asText(in.mimeType());
            return new MediaFile(bytes, contentTypeFor(type, in.kind()), in.filename());
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().is4xxClientError()) throw expired();
            throw providerError(e);
        }
    }

    /** WATI: the webhook's showFile link, fetched with the tenant's token. */
    private MediaFile fetchFromWati(InboundWhatsAppMessage in, String instituteId) {
        ProviderMediaCredentials creds = watiProvider.mediaCredentials(instituteId);
        if (creds == null) throw notConfigured();
        if (!isWatiHost(in.mediaRef())) {
            log.warn("Refusing to send the WATI token to a non-WATI media URL");
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Attachment link is not a WATI file");
        }
        try {
            byte[] bytes = download(in.mediaRef(), creds.token(), MAX_BYTES);
            return new MediaFile(bytes, contentTypeFor(in.mimeType(), in.kind(), in.mediaRef()), in.filename());
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().is4xxClientError()) throw expired();
            throw providerError(e);
        }
    }

    /** GET with a bearer token, reading at most {@code limit} bytes. */
    private byte[] download(String url, String token, long limit) {
        // Used verbatim: the provider hands back an already-encoded, signed URL.
        URI uri = URI.create(url);
        return restTemplate.execute(uri, HttpMethod.GET,
                request -> request.getHeaders().set(HttpHeaders.AUTHORIZATION, "Bearer " + token),
                response -> {
                    long declared = response.getHeaders().getContentLength();
                    if (declared > limit) throw tooLarge();
                    try (InputStream body = response.getBody()) {
                        return readCapped(body, limit);
                    }
                });
    }

    private static byte[] readCapped(InputStream in, long limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > limit) throw tooLarge();
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    /** Meta serves media from lookaside.fbsbx.com; anything else does not get the token. */
    static boolean isMetaMediaHost(String url) {
        String host = httpsHost(url);
        return host != null && (host.equals("fbsbx.com") || host.endsWith(".fbsbx.com")
                || host.endsWith(".facebook.com") || host.endsWith(".whatsapp.net"));
    }

    static boolean isWatiHost(String url) {
        String host = httpsHost(url);
        return host != null && host.endsWith(".wati.io");
    }

    private static String httpsHost(String url) {
        try {
            URI uri = URI.create(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return null;
            return uri.getHost().toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return null;
        }
    }

    private static String contentTypeFor(String mimeType, String kind) {
        return contentTypeFor(mimeType, kind, null);
    }

    /** The provider's MIME type when it gave one; otherwise inferred from the kind / file extension. */
    static String contentTypeFor(String mimeType, String kind, String url) {
        if (mimeType != null && !mimeType.isBlank()) {
            // "audio/ogg; codecs=opus" is fine as is; browsers accept parameters.
            return mimeType;
        }
        String ext = url == null ? "" : url.toLowerCase(Locale.ROOT).replaceAll("[?#].*$", "");
        if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
        if (ext.endsWith(".png")) return "image/png";
        if (ext.endsWith(".webp")) return "image/webp";
        if (ext.endsWith(".mp4")) return "video/mp4";
        if (ext.endsWith(".opus") || ext.endsWith(".ogg")) return "audio/ogg";
        if (ext.endsWith(".mp3")) return "audio/mpeg";
        if (ext.endsWith(".pdf")) return "application/pdf";
        return switch (kind == null ? "" : kind) {
            case "sticker" -> "image/webp";
            case "image" -> "image/jpeg";
            case "video" -> "video/mp4";
            case "audio", "voice" -> "audio/ogg";
            default -> "application/octet-stream";
        };
    }

    private static String trimSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private static ResponseStatusException notConfigured() {
        return new ResponseStatusException(HttpStatus.CONFLICT,
                "WhatsApp is not configured for this institute, so the attachment cannot be fetched");
    }

    /** 410: the attachment existed but the provider no longer serves it. */
    private static ResponseStatusException expired() {
        return new ResponseStatusException(HttpStatus.GONE,
                "WhatsApp no longer has this attachment (media is kept for about 30 days)");
    }

    private static ResponseStatusException tooLarge() {
        return new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                "Attachment is too large to preview in the Inbox");
    }

    private static ResponseStatusException providerError(Exception e) {
        log.warn("Could not fetch WhatsApp media: {}", e.getMessage());
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                "WhatsApp did not return the attachment. Try again in a moment.");
    }
}
