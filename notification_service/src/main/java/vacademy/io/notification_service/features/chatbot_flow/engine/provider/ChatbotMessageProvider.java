package vacademy.io.notification_service.features.chatbot_flow.engine.provider;

import java.util.Map;

/**
 * Provider abstraction for sending WhatsApp messages.
 * Implementations handle the API differences between Meta, WATI, and COMBOT.
 */
public interface ChatbotMessageProvider {

    boolean supports(String channelType);

    /**
     * Send a template message.
     * @param phone recipient phone number
     * @param templatePayload provider-agnostic payload with keys:
     *   templateName, languageCode, bodyParams (List<String>),
     *   headerConfig ({type, url, filename}), buttonConfig ([{type, index, urlSuffix/payload}])
     * @param instituteId for credential resolution
     * @param businessChannelId phone_number_id for this institute
     * @return the provider-assigned message id (Meta wamid / Com.bot queue_id), or null if the
     *   provider response carries none. Callers that don't need per-message status attribution
     *   may ignore it; the send/read ledger (notification_log.source_id) depends on it.
     */
    String sendTemplate(String phone, Map<String, Object> templatePayload,
                        String instituteId, String businessChannelId);

    /**
     * Send an interactive message (buttons or list). Session window required.
     * @param phone recipient phone number
     * @param interactivePayload provider-agnostic payload with keys:
     *   interactiveType (button|list), header, body, footer, buttons, sections
     * @param instituteId for credential resolution
     * @param businessChannelId phone_number_id for this institute
     * @return the provider-assigned message id, or null (see {@link #sendTemplate}).
     */
    String sendInteractive(String phone, Map<String, Object> interactivePayload,
                           String instituteId, String businessChannelId);

    /**
     * Send a plain text message. Session window required.
     * Used by AI_RESPONSE and SEND_MESSAGE nodes.
     * @return the provider-assigned message id, or null (see {@link #sendTemplate}).
     */
    String sendText(String phone, String text, String instituteId, String businessChannelId);

    /**
     * Send a media message (image, video, document, audio). Session window required.
     * Used by SEND_MESSAGE node for rich content without templates.
     *
     * @param mediaType "image", "video", "document", "audio"
     * @param mediaUrl  publicly accessible URL of the media file
     * @param caption   optional caption (not supported for audio)
     * @param filename  optional filename (for documents)
     * @return the provider-assigned message id, or null (see {@link #sendTemplate}). The Inbox
     *   stores it on notification_log.source_id so the delivered/read webhooks land on THIS row
     *   rather than the most recent outbound to the same phone.
     */
    String sendMedia(String phone, String mediaType, String mediaUrl, String caption,
                     String filename, String instituteId, String businessChannelId);
}
