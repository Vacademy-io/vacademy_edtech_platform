package vacademy.io.notification_service.features.chatbot_flow.enums;

/** Lifecycle of a chatbot escalation. */
public enum EscalationStatus {
    /** A learner is still waiting for a human reply. */
    PENDING,
    /** A human has replied (or an admin dismissed it). */
    RESOLVED
}
