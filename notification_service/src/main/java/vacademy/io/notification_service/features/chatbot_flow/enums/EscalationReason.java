package vacademy.io.notification_service.features.chatbot_flow.enums;

/** Why the chatbot handed a conversation over to a human. */
public enum EscalationReason {
    /** The AI said it does not have the information (escalation marker in its reply). */
    NO_CONTEXT,
    /** The AI conversation hit its configured maxTurns ceiling. */
    MAX_TURNS,
    /** The AI call itself failed (provider error, timeout, non-2xx). */
    AI_ERROR,
    /**
     * The institute is out of AI credits (or the balance could not be confirmed), so no
     * model was called. Unlike AI_ERROR this will not clear on its own — an admin has to
     * top up — which is why it is worth telling them apart in the Inbox. Also raised when an
     * AI usage limit paused the bot (a cap the institute set; it resets on its own): the
     * escalation's error message then starts with "AI usage limit reached".
     */
    NO_CREDITS,
    /** Raised by an admin from the Inbox rather than by the bot. */
    MANUAL,
    /** A person who is already a CRM lead messaged again through a chatbot flow (CRM_LEAD_CHECK). */
    EXISTING_LEAD,
    /** The chatbot could not save the collected answers to the CRM lead (SAVE_TO_CRM). */
    CRM_SAVE_FAILED
}
