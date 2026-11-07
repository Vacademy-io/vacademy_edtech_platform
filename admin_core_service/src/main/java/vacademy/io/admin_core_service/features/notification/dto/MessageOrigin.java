package vacademy.io.admin_core_service.features.notification.dto;

/**
 * Who is sending a WhatsApp message, so notification-service can show "sent by workflow X" in the
 * WhatsApp Inbox and the student's Communication tab. Travels as
 * {@code options.originType/originId/originName} on the unified send request.
 */
public record MessageOrigin(String type, String id, String name) {

    public static final String WORKFLOW = "WORKFLOW";

    public static MessageOrigin workflow(String workflowId, String workflowName) {
        return new MessageOrigin(WORKFLOW, workflowId, workflowName);
    }
}
