package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What a learner actually sent, read back from the raw webhook JSON stored on an incoming
 * notification_log row.
 * <p>
 * The stored body is only a summary — "[sticker]", "[reaction: 👍]", or nothing at all — because
 * each webhook path wrote whatever it could at the time. The payload on the row is the provider's
 * own JSON, in one of three shapes:
 * <ul>
 *   <li>a single Meta Cloud API message object (Com.bot / Meta path, {@code CombotWebhookService});</li>
 *   <li>the whole Meta webhook envelope, {@code entry[].changes[].value.messages[]}
 *       ({@code WebhookEventProcessor});</li>
 *   <li>a WATI event ({@code eventType}, {@code type}, {@code text}, {@code data}).</li>
 * </ul>
 * This reads all three into one shape the Inbox can draw. It never throws: a payload it cannot
 * read yields {@code null}, and the caller keeps showing the stored body.
 */
public record InboundWhatsAppMessage(
        /** text, image, video, audio, voice, sticker, document, location, contacts, reaction,
         *  reply (a tapped button / list row), unsupported, template_sent, template_failed, or
         *  the provider's own type word for anything else. */
        String kind,
        /** Words the learner typed: text body, media caption, or the tapped button/list title. */
        String text,
        /** META: the Cloud API media id. WATI: the showFile URL. Null when there is no media. */
        String mediaRef,
        /** META or WATI — which API {@link #mediaRef} has to be fetched from. */
        String mediaSource,
        String mimeType,
        String filename,
        /** Reaction emoji. Blank on a reaction means the learner removed an earlier one. */
        String emoji,
        /** Provider message id (wamid) a reaction points at. */
        String reactedToProviderId,
        Double latitude,
        Double longitude,
        String locationName,
        String locationAddress,
        /** Display names on a shared contact card. */
        List<String> contactNames,
        /** WATI templateMessageFailed: the provider's reason, and its code. */
        String failedDetail,
        String failedCode) {

    public static final String MEDIA_SOURCE_META = "META";
    public static final String MEDIA_SOURCE_WATI = "WATI";

    public static final String KIND_REACTION = "reaction";
    public static final String KIND_TEMPLATE_SENT = "template_sent";
    public static final String KIND_TEMPLATE_FAILED = "template_failed";

    /** Kinds that carry a file the Inbox can fetch and draw. */
    private static final List<String> MEDIA_KINDS =
            List.of("image", "video", "audio", "voice", "sticker", "document");

    public boolean hasMedia() {
        return mediaRef != null && !mediaRef.isBlank() && MEDIA_KINDS.contains(kind);
    }

    public boolean isReaction() {
        return KIND_REACTION.equals(kind);
    }

    /**
     * WATI reports the institute's OWN template sends (and their failures) on the same webhook as
     * learner messages, and they were logged as incoming. They are ours, so they belong on the
     * right-hand side of the thread.
     */
    public boolean isOwnTemplateEvent() {
        return KIND_TEMPLATE_SENT.equals(kind) || KIND_TEMPLATE_FAILED.equals(kind);
    }

    /** Parse a stored payload; null when it is absent or in no shape we know. */
    public static InboundWhatsAppMessage parse(String payloadJson, ObjectMapper mapper) {
        if (payloadJson == null || payloadJson.isBlank() || !payloadJson.trim().startsWith("{")) {
            return null;
        }
        try {
            JsonNode root = mapper.readTree(payloadJson);
            if (root == null || !root.isObject()) return null;

            if (root.has("eventType") || root.has("whatsappMessageId") || root.has("waId")) {
                return fromWati(root);
            }
            JsonNode message = root.path("entry").path(0).path("changes").path(0)
                    .path("value").path("messages").path(0);
            if (message.isObject()) return fromMeta(message);
            if (root.hasNonNull("type")) return fromMeta(root);
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private static InboundWhatsAppMessage fromMeta(JsonNode m) {
        String type = lower(text(m, "type"));
        if (type == null) return null;

        Builder b = new Builder(type);
        switch (type) {
            case "text" -> b.text = text(m.path("text"), "body");
            case "image", "video", "sticker", "document", "audio" -> {
                JsonNode media = m.path(type);
                b.mediaRef = text(media, "id");
                b.mediaSource = MEDIA_SOURCE_META;
                b.mimeType = text(media, "mime_type");
                b.filename = text(media, "filename");
                b.text = text(media, "caption");
                if ("audio".equals(type) && media.path("voice").asBoolean(false)) b.kind = "voice";
            }
            case "reaction" -> {
                b.emoji = text(m.path("reaction"), "emoji");
                b.reactedToProviderId = text(m.path("reaction"), "message_id");
            }
            case "location" -> readLocation(m.path("location"), b);
            case "contacts" -> {
                for (JsonNode c : m.path("contacts")) {
                    String name = text(c.path("name"), "formatted_name");
                    if (name != null) b.contactNames.add(name);
                }
            }
            case "button" -> {
                b.kind = "reply";
                b.text = text(m.path("button"), "text");
            }
            case "interactive" -> {
                JsonNode i = m.path("interactive");
                b.kind = "reply";
                b.text = firstNonBlank(text(i.path("button_reply"), "title"),
                        text(i.path("list_reply"), "title"));
                if (b.text == null && i.has("nfm_reply")) b.kind = "form_response";
            }
            default -> {
                // order, system, unsupported, ... — the kind alone is what the Inbox can say.
            }
        }
        return b.build();
    }

    private static InboundWhatsAppMessage fromWati(JsonNode m) {
        String event = text(m, "eventType");
        String type = lower(text(m, "type"));
        if (event != null && event.startsWith("templateMessageFailed")) {
            Builder b = new Builder(KIND_TEMPLATE_FAILED);
            b.failedDetail = text(m, "failedDetail");
            b.failedCode = text(m, "failedCode");
            return b.build();
        }
        if (event != null && event.startsWith("templateMessageSent")) {
            Builder b = new Builder(KIND_TEMPLATE_SENT);
            b.text = text(m, "text");
            return b.build();
        }
        if (type == null) return null;

        Builder b = new Builder(type);
        switch (type) {
            case "text" -> b.text = text(m, "text");
            case "image", "video", "sticker", "document", "audio", "voice" -> {
                b.mediaRef = text(m, "data");
                b.mediaSource = MEDIA_SOURCE_WATI;
                // WATI puts the caption in "text" — and for a document, sometimes the whole
                // message the learner forwarded with it.
                b.text = text(m, "text");
                if ("document".equals(type)) b.filename = filenameFromUrl(b.mediaRef);
            }
            case "reaction" -> {
                b.emoji = text(m, "text");
                b.reactedToProviderId = text(m, "replyContextId");
            }
            case "location" -> {
                // WATI has carried location both as a nested object and as "lat,lng" text.
                readLocation(m.path("location"), b);
                if (b.latitude == null) b.text = text(m, "text");
            }
            case "contacts" -> {
                for (JsonNode c : m.path("messageContact")) {
                    String name = text(c.path("name"), "formatted_name");
                    if (name != null) b.contactNames.add(name);
                }
            }
            case "button", "interactive" -> {
                b.kind = "reply";
                b.text = firstNonBlank(text(m.path("buttonReply"), "text"),
                        text(m.path("interactiveButtonReply"), "title"),
                        text(m.path("listReply"), "title"),
                        text(m, "text"));
            }
            default -> b.text = text(m, "text");
        }
        return b.build();
    }

    private static void readLocation(JsonNode loc, Builder b) {
        if (!loc.isObject()) return;
        if (loc.hasNonNull("latitude") && loc.hasNonNull("longitude")) {
            b.latitude = loc.path("latitude").asDouble();
            b.longitude = loc.path("longitude").asDouble();
        }
        b.locationName = text(loc, "name");
        b.locationAddress = text(loc, "address");
    }

    /** "…showFile?fileName=data/documents/abc.pdf" → "abc.pdf". */
    static String filenameFromUrl(String url) {
        if (url == null) return null;
        int q = url.indexOf("fileName=");
        String path = q >= 0 ? url.substring(q + "fileName=".length()) : url;
        int amp = path.indexOf('&');
        if (amp >= 0) path = path.substring(0, amp);
        int slash = path.lastIndexOf('/');
        String name = slash >= 0 ? path.substring(slash + 1) : path;
        return name.isBlank() ? null : name;
    }

    private static String text(JsonNode node, String field) {
        if (node == null || !node.isObject()) return null;
        JsonNode v = node.get(field);
        if (v == null || v.isNull() || v.isContainerNode()) return null;
        String s = v.asText();
        return s.isBlank() ? null : s;
    }

    private static String lower(String s) {
        return s == null ? null : s.toLowerCase(Locale.ROOT);
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v;
        return null;
    }

    private static final class Builder {
        String kind;
        String text;
        String mediaRef;
        String mediaSource;
        String mimeType;
        String filename;
        String emoji;
        String reactedToProviderId;
        Double latitude;
        Double longitude;
        String locationName;
        String locationAddress;
        final List<String> contactNames = new ArrayList<>();
        String failedDetail;
        String failedCode;

        Builder(String kind) {
            this.kind = kind;
        }

        InboundWhatsAppMessage build() {
            return new InboundWhatsAppMessage(kind, text, mediaRef, mediaSource, mimeType, filename,
                    emoji, reactedToProviderId, latitude, longitude, locationName, locationAddress,
                    List.copyOf(contactNames), failedDetail, failedCode);
        }
    }
}
