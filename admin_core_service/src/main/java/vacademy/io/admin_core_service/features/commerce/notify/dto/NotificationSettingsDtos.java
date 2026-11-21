package vacademy.io.admin_core_service.features.commerce.notify.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;

import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * The bodies and answers of the buyer-message settings ({@code /commerce/v1/notification-settings})
 * and of an order's message list. Snake case on the wire. No answer carries a whole phone number
 * or e-mail address: only their masked forms.
 */
public final class NotificationSettingsDtos {

    private NotificationSettingsDtos() {
    }

    // ================================================================== GET /notification-settings

    /** {@code { "shop": ..., "triggers": [nine rows] }}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SettingsView {
        private ShopView shop;
        private List<TriggerView> triggers;
    }

    /** The shop-wide values. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ShopView {
        /** As stored; null = not set (one verified website is then used, see the candidates). */
        private String linkBaseUrl;
        /** {@code https://<host>} of every verified website of the institute. */
        private List<String> linkBaseCandidates;
        private Integer linkDays;
        /** {@code {"hi": ..., "en": ...}}; null = the institute's name. */
        private Map<String, String> shopName;
        private String shopNameDefault;
        private String baseLocale;
        private Boolean linkSecretConfigured;
        private Boolean sendingEnabled;
    }

    /** One trigger as staff see it: switches, the WhatsApp template and the email texts. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TriggerView {
        private String trigger;
        private Boolean enabled;
        private Boolean emailEnabled;
        private Boolean whatsappEnabled;
        /** An active workflow of the institute takes this trigger over (the default message stands down). */
        private Boolean handledByWorkflow;
        /** Send it back with the next change (0 while nothing was changed). */
        private Integer version;
        /** The placeholders a text of this trigger may use. */
        private List<String> variables;
        private WhatsAppView whatsapp;
        private EmailView email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class WhatsAppView {
        private String templateName;
        private String defaultTemplateName;
        /** Per language: APPROVED, PENDING, REJECTED, DRAFT, MISSING or UNKNOWN. */
        private Map<String, String> status;
        /** Per language: the default text (WhatsApp texts are approved by Meta and not edited here). */
        private Map<String, String> text;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EmailView {
        /** Per language: the subject in force (the shop's own or the default). */
        private Map<String, String> subject;
        /** Per language: the body in force (the shop's own or the default). */
        private Map<String, String> body;
        /** Per language: whether the shop changed the subject or the body. */
        private Map<String, Boolean> overridden;
    }

    // ================================================================== PUT bodies

    /**
     * {@code PUT /notification-settings/triggers/{trigger}}. Every key is optional except
     * {@code version}; a key left out keeps its value; {@code whatsapp_template_name: null} and
     * {@code email.<lang>: null} go back to the defaults.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TriggerUpdate {
        private Integer version;
        private Boolean enabled;
        private Boolean emailEnabled;
        private Boolean whatsappEnabled;
        /** Another approved template of the institute; it gets the same named variables. */
        private String whatsappTemplateName;
        /**
         * Per language ({@code hi}, {@code en}): plain text, placeholders only from {@code variables}.
         * These messages are about one order: no offers or advertising.
         */
        private Map<String, EmailText> email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EmailText {
        /** At most 150 characters, one line; null = the default. */
        private String subject;
        /** At most 2000 characters; null = the default. */
        private String body;
    }

    /** {@code PUT /notification-settings/shop}: keys optional, null resets. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ShopUpdate {
        private String linkBaseUrl;
        private Integer linkDays;
        private Map<String, String> shopName;
    }

    // ================================================================== test send

    /** {@code POST /notification-settings/test-send}. No recipient: it goes to the caller's own contacts. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TestSendRequest {
        private String trigger;
        private String locale;
        /** EMAIL, WHATSAPP. */
        private List<String> channels;
    }

    /** One channel of a test send. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TestSendResult {
        private String channel;
        /** SENT, SKIPPED or FAILED. */
        private String status;
        private String code;
        private String recipientMasked;
    }

    /** {@code { "results": [...] }}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TestSendAnswer {
        private List<TestSendResult> results;
    }

    // ================================================================== WhatsApp templates

    /** {@code POST /notification-settings/whatsapp-templates}: null triggers = all nine. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TemplateSubmitRequest {
        private List<String> triggers;
        private List<String> locales;
    }

    /** One template of the action. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TemplateSubmitItem {
        private String trigger;
        private String locale;
        private String templateName;
        private String status;
        /** CREATED_AND_SUBMITTED, EXISTS, PROVIDER_NOT_SUPPORTED or PROVIDER_ERROR. */
        private String code;
        /** PROVIDER_NOT_SUPPORTED only: the body to create in the provider's own screens. */
        private String text;
        /** PROVIDER_NOT_SUPPORTED only: the variable of each position of {@code text}. */
        private List<String> variableNames;
    }

    /** {@code { "items": [...] }}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TemplateSubmitAnswer {
        private List<TemplateSubmitItem> items;
    }

    // ================================================================== an order's messages

    /** One message of an order: never the address, only its masked form. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DeliveryView {
        private String trigger;
        private String channel;
        private String status;
        private String code;
        private String locale;
        private String recipientMasked;
        /** ISO-8601 instant. */
        private String createdAt;
        /** ISO-8601 instant, or null. */
        private String sentAt;

        public static DeliveryView of(CommerceNotificationStore.DeliveryView row) {
            return DeliveryView.builder().trigger(row.triggerCode()).channel(row.channel()).status(row.status())
                    .code(row.code()).locale(row.locale()).recipientMasked(row.recipientMasked())
                    .createdAt(instant(row.createdAt())).sentAt(instant(row.sentAt())).build();
        }

        public static List<DeliveryView> of(List<CommerceNotificationStore.DeliveryView> rows) {
            return rows == null ? List.of() : rows.stream().map(DeliveryView::of).toList();
        }

        private static String instant(Date date) {
            return date == null ? null : date.toInstant().toString();
        }
    }

    /** {@code { "items": [...] }}, newest first. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DeliveryList {
        private List<DeliveryView> items;
    }
}
