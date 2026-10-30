package vacademy.io.notification_service.features.engagement_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * What became of each engine action's message. An action with no outgoing WhatsApp/email row
 * (in-app, task, nothing sent yet, or a send path that stamps no correlation id) is absent from
 * {@code actions}: absence means "no signal", not "failed".
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportSignalsResponse {

    /** False while aws.inbound.email.enabled is off: email replies are then not observable at all. */
    private boolean inboundEmailEnabled;

    /** action id (echoed from the request) → signals. */
    private Map<String, ActionSignals> actions;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ActionSignals {
        /** WHATSAPP or EMAIL. */
        private String channel;
        /** Phone digits with country code (WhatsApp) or email address. */
        private String recipient;
        /** Epoch millis of the outgoing row. */
        private Long sentAt;
        /**
         * SENT / DELIVERED / READ / FAILED from the status webhooks, or FAILED for a WhatsApp send
         * the provider rejected outright. Null = no verdict seen (WATI, email, or not yet).
         */
        private String deliveryStatus;
        private String deliveryErrorCode;
        /** META / COMBOT / WATI from the send payload; null when the send path did not record it. */
        private String provider;
        /** WhatsApp template name and language from the send payload; null for a free-form message. */
        private String templateName;
        private String templateLanguage;
        /** MARKETING / UTILITY / AUTHENTICATION from notification_template; null when unknown. */
        private String templateCategory;
        /** Meta pricing from the status webhook (V39); all null when none was seen. */
        private String pricingType;
        private String pricingCategory;
        private Boolean pricingBillable;
        private String pricingModel;
        /** Email only (null for WhatsApp). All false when no event was recorded. */
        private EmailEvents emailEvents;
        /** Email only: any EMAIL_EVENT exists for this email row (tracking is on for it). */
        private boolean emailTracked;
        /**
         * Epoch millis of the first reply. WhatsApp: first inbound message from the same phone, same
         * institute, in (sentAt, sentAt + window]. Email: first INBOUND_EMAIL linked to this email
         * row, only while inbound email is enabled.
         */
        private Long firstReplyAt;
        /** Email only: the subject line from the send payload, which the report groups email by in place of a template name. */
        private String subject;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EmailEvents {
        private boolean delivered;
        private boolean opened;
        private boolean clicked;
        private boolean bounced;
        private boolean complained;
    }
}
