package vacademy.io.notification_service.features.chatbot_flow.engine;

import lombok.Builder;
import lombok.Data;

import java.util.Map;

@Data
@Builder
public class FlowExecutionContext {
    private String phoneNumber;
    private String instituteId;
    private String userId;
    private String businessChannelId;
    private String channelType;
    private String messageText;

    /** Incoming message type: text, button, interactive, etc. */
    private String messageType;

    /** For button replies: the button ID or payload */
    private String buttonId;
    private String buttonPayload;

    /** For list replies: the selected row ID */
    private String listReplyId;

    /** User details fetched from admin-core-service */
    private Map<String, Object> userDetails;

    /** Session-accumulated context variables */
    private Map<String, Object> sessionVariables;

    /**
     * Set by an executor that already wrote a FAILED notification_log row for the message it was
     * sending (see {@code WhatsAppSendFailureService}). The engine reads-and-clears it so it does
     * not also log the same message as delivered — one bubble per attempt in the Inbox.
     */
    @Builder.Default
    private boolean sendFailureLogged = false;

    /**
     * Provider message id (Meta wamid) returned by the send an executor just made. The engine
     * reads-and-clears it when it writes the outgoing notification_log row, so the row carries the
     * id the status webhooks join on — without it a bot reply is stuck on one grey tick forever,
     * however many delivered/read events arrive for it.
     */
    private String lastProviderMessageId;

    /**
     * What a SEND_TEMPLATE node just sent — template name, resolved body params, header media —
     * in the shape {@code WhatsAppTemplateRenderer} reads off notification_log.message_payload.
     * The engine reads-and-clears it onto the outgoing row, so the Inbox can show the message the
     * learner actually received instead of a bare "Template: name" line.
     */
    private Map<String, Object> lastTemplateSend;
    /**
     * True when the engine is handing the user's reply to the node the session was waiting on
     * (CONDITION / AI_RESPONSE / ASK_FIELD), false when the node is being reached by traversal.
     * ASK_FIELD reads it to tell "send the question" apart from "this is the answer".
     */
    @Builder.Default
    private boolean replyToWaitingNode = false;
    /**
     * Text a CRM node (CRM_LEAD_CHECK / ASK_FIELD / SAVE_TO_CRM) just sent, for the Inbox row.
     * These nodes build their message at run time, so the engine cannot read it off the node
     * config. Read-and-cleared by the engine; null means the node sent nothing this time.
     */
    private String lastSentBody;
}
