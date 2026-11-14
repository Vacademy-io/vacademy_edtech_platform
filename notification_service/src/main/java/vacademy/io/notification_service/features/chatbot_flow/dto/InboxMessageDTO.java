package vacademy.io.notification_service.features.chatbot_flow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InboxMessageDTO {
    private String id;
    private String body;
    private String direction;     // OUTGOING or INCOMING
    /** When the message was sent/received. Jackson emits Instant as ISO-8601 with trailing Z. */
    private Instant timestamp;
    private String source;        // COMBOT, WATI, META
    private String senderName;
    private String status;        // notification_type raw value

    // --- Template-send context (only present on outgoing template messages) ---
    /** Name of the WhatsApp template this message was sent from, e.g. "launchoffer". */
    private String templateName;
    /** Meta's category for that template: MARKETING, UTILITY or AUTHENTICATION. Null when unknown. */
    private String templateCategory;
    /** Sending provider recorded on the log: META, WATI, COMBOT, ... */
    private String provider;
    /** SUCCESS or FAILED — whether the provider accepted the send. */
    private String deliveryStatus;
    /** Provider rejection reason, when deliveryStatus == FAILED. */
    private String error;
    /** Template header type: NONE, TEXT, IMAGE, VIDEO, DOCUMENT. */
    private String headerType;
    /** Actual media URL for an IMAGE/VIDEO/DOCUMENT header, so the UI can display the attachment. */
    private String headerMediaUrl;
    /** The template's buttons (links, quick replies), drawn under the message like WhatsApp does. */
    private List<InboxTemplateButtonDTO> buttons;
    /** Who sent it — a workflow or a chatbot flow, with its name. Outgoing only; null when unknown. */
    private MessageOriginDTO origin;

    /**
     * What we tried to send on a failed non-template message: text, interactive, media, template.
     * Present only alongside {@code deliveryStatus == FAILED}.
     */
    private String attemptedType;

    // --- Free-form media (an image/video/audio/document sent from the Inbox, not via a template) ---
    /** image, video, audio or document. Null on a plain text message. */
    private String mediaType;
    /** Public URL of the attachment, for the UI to render inline. */
    private String mediaUrl;
    /** Original filename — what a document bubble shows, and what WATI derived the type from. */
    private String mediaFilename;

    // --- What a learner sent, read from the provider's raw webhook (incoming only) ---
    /**
     * text, image, video, audio, voice, sticker, document, location, contacts, reaction, reply,
     * form_response, unsupported, ... Null when the row carries no readable payload.
     */
    private String messageKind;
    /**
     * True when the learner's attachment can be fetched through
     * {@code GET /inbox/messages/{id}/media}. The file lives with WhatsApp/WATI behind the
     * institute's token, so there is no public URL to hand the browser.
     */
    private Boolean mediaFetchable;
    /** Reaction emoji; blank means the learner took an earlier reaction back. */
    private String reactionEmoji;
    /** Id of the message in this thread the reaction is on, when we have it on record. */
    private String reactedToMessageId;
    /** A short excerpt of that message, for a reaction whose target is not on screen. */
    private String reactedToPreview;
    private Double latitude;
    private Double longitude;
    private String locationName;
    private String locationAddress;
    /** Names on a shared contact card. */
    private List<String> contactNames;
}
