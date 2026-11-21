package vacademy.io.notification_service.features.chatbot_flow.enums;

public enum ChatbotNodeType {
    TRIGGER,
    SEND_TEMPLATE,
    SEND_MESSAGE,
    SEND_INTERACTIVE,
    CONDITION,
    WORKFLOW_ACTION,
    DELAY,
    HTTP_WEBHOOK,
    AI_RESPONSE,
    /** Is this WhatsApp number already a lead in the institute? Branches NEW / EXISTING. */
    CRM_LEAD_CHECK,
    /** Ask one question tied to a CRM field, wait for the reply, validate and save it on the lead. */
    ASK_FIELD,
    /** Finish: save every collected answer on the lead, optionally set its status, fire workflows. */
    SAVE_TO_CRM
}
