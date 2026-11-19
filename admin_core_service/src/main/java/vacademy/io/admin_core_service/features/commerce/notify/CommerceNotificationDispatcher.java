package vacademy.io.admin_core_service.features.commerce.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationDelivery;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.order.enums.CommerceOrderStatus;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Plans and sends the buyer's messages. Never runs inside a transaction: each database step is a
 * short transaction of its own, and nothing is sent while one is open.
 *
 * <p><b>Plan</b> (a PENDING event that is due): the kill switch, the institute's commerce feature
 * (OFF: skipped for good; UNKNOWN: asked again in 5 minutes), the shop's switch for the trigger,
 * the trigger's own rules, then either one WORKFLOW row (the institute's workflow stands in) or one
 * row per enabled channel. Two pods planning one event make the same rows once.
 *
 * <p><b>Send</b> (a PENDING delivery that is due): claimed by a compare-and-set to SENDING; only the
 * claimer sends, once. The institute's commerce feature is read again after the claim (OFF: skipped
 * for good; UNKNOWN: back to PENDING for 5 minutes, before any call). An answer that leaves the outcome unknown (a read timeout, a 5xx, a lost
 * claim) is never sent again: a buyer may miss a message, never gets two. Logs carry ids, the
 * trigger, the channel, the status and codes only.
 */
@Slf4j
@Component
public class CommerceNotificationDispatcher {

    static final Duration FEATURE_RETRY = Duration.ofMinutes(5);
    static final int[] RETRY_MINUTES = {1, 5, 15, 60};
    static final int MAX_ATTEMPTS = 5;
    static final int CLAIM_LOST_MINUTES = 10;
    public static final String SOURCE = "COMMERCE_ORDER";

    /** How a send ended. */
    public enum Result { SENT, SKIPPED, FAILED, UNKNOWN, RETRY, EXPIRED, NOT_CLAIMED, HELD }

    private final CommerceNotificationStore store;
    private final CommerceNotificationSettingRepository settings;
    private final CommerceAccessGuard accessGuard;
    private final ObjectProvider<WorkflowTriggerService> workflows;
    private final NotificationService notificationService;
    private final CommerceWhatsAppTemplateStatus templates;
    private final CommerceNotificationShopSettings shopSettings;
    private final CommerceStorefrontSettings storefrontSettings;
    private final CommerceReturnSettings returnSettings;
    private final CommerceOrderLinkTokens linkTokens;
    private final CommerceNotificationMessages messages;
    private final TransactionTemplate readOnly;
    private final boolean enabled;
    private final byte[] recipientKey;

    public CommerceNotificationDispatcher(CommerceNotificationStore store,
                                          CommerceNotificationSettingRepository settings,
                                          CommerceAccessGuard accessGuard,
                                          ObjectProvider<WorkflowTriggerService> workflows,
                                          NotificationService notificationService,
                                          CommerceWhatsAppTemplateStatus templates,
                                          CommerceNotificationShopSettings shopSettings,
                                          CommerceStorefrontSettings storefrontSettings,
                                          CommerceReturnSettings returnSettings,
                                          CommerceOrderLinkTokens linkTokens,
                                          CommerceNotificationMessages messages,
                                          PlatformTransactionManager transactionManager,
                                          @Value("${commerce.notifications.enabled:false}") boolean enabled,
                                          @Value("${commerce.order-token.secret:}") String orderTokenSecret) {
        this.store = store;
        this.settings = settings;
        this.accessGuard = accessGuard;
        this.workflows = workflows;
        this.notificationService = notificationService;
        this.templates = templates;
        this.shopSettings = shopSettings;
        this.storefrontSettings = storefrontSettings;
        this.returnSettings = returnSettings;
        this.linkTokens = linkTokens;
        this.messages = messages;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readOnly.setReadOnly(true);
        this.enabled = enabled;
        this.recipientKey = orderTokenSecret == null || orderTokenSecret.isBlank() ? null
                : sha256(("commerce-notify-recipient:" + orderTokenSecret.trim()).getBytes(StandardCharsets.UTF_8));
    }

    public boolean enabled() {
        return enabled;
    }

    private static void requireNoTransaction() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("buyer messages are planned and sent outside any transaction");
        }
    }

    // ================================================================== entry points

    /** Right after an order change commits: its due events are planned and its due messages sent. */
    public void dispatchOrder(String instituteId, String orderId) {
        requireNoTransaction();
        if (!enabled) {
            return;
        }
        for (CommerceNotificationStore.EventRow event : store.dueEventsOfOrder(instituteId, orderId)) {
            plan(event);
        }
        for (CommerceNotificationStore.DeliveryRow delivery : store.dueDeliveriesOfOrder(instituteId, orderId)) {
            send(delivery.id());
        }
    }

    // ================================================================== plan

    /** The decisions of one PENDING event; the reason it was skipped, "PLANNED", or null when it waits. */
    public String plan(CommerceNotificationStore.EventRow event) {
        requireNoTransaction();
        CommerceNotificationTrigger trigger = CommerceNotificationTrigger.of(event.triggerCode());
        if (event.expired()) {
            return skip(event, "EXPIRED");
        }
        if (!enabled) {
            return null;
        }
        if (trigger == null) {
            return skip(event, "NOT_APPLICABLE");
        }
        CommerceNotificationStore.OrderFacts order = store.order(event.instituteId(), event.orderId());
        if (order == null) {
            return skip(event, "NOT_APPLICABLE");
        }
        CommerceAccessGuard.FeatureState state = accessGuard.featureState(event.instituteId(),
                featureOf(trigger, order.channel()));
        if (state == CommerceAccessGuard.FeatureState.UNKNOWN || state == null) {
            store.retryEvent(event.id(), (int) FEATURE_RETRY.toMinutes());
            log.warn("COMMERCE_NOTIFY event {} order={} trigger={}: feature state unknown; asked again later",
                    event.id(), event.orderId(), event.triggerCode());
            return null;
        }
        if (state == CommerceAccessGuard.FeatureState.OFF) {
            return skip(event, "COMMERCE_OFF");
        }
        CommerceNotificationSetting setting = setting(event.instituteId(), trigger);
        if (setting != null && !Boolean.TRUE.equals(setting.getEnabled())) {
            return skip(event, "TRIGGER_OFF");
        }
        if (trigger == CommerceNotificationTrigger.COD_CONFIRMATION_NEEDED
                && !CommerceOrderStatus.COD_PENDING_CONFIRMATION.name().equals(order.status())) {
            return skip(event, "STALE");
        }
        if (trigger == CommerceNotificationTrigger.REFUND_PROCESSED) {
            Object method = store.refund(event.orderId(), event.refId()).get("method");
            if (!CommerceNotificationValues.refundMessaged(method == null ? null : method.toString())) {
                return skip(event, "NOT_APPLICABLE");
            }
        }
        boolean byWorkflow = false;
        WorkflowTriggerService engine = workflows.getIfAvailable();
        if (engine != null) {
            try {
                byWorkflow = engine.hasActiveWorkflow(trigger.name(), event.orderId(), event.instituteId());
            } catch (RuntimeException e) {
                // The defaults go out (the platform's precedent).
                log.warn("COMMERCE_NOTIFY event {} trigger={}: workflow lookup failed ({}); defaults apply",
                        event.id(), event.triggerCode(), e.getClass().getSimpleName());
            }
        }
        String locale = CommerceNotificationValues.messageLocale(order.locale(), baseLocale(event.instituteId()));
        List<String[]> rows = new ArrayList<>();
        if (byWorkflow) {
            rows.add(new String[] {CommerceNotificationDelivery.WORKFLOW, null});
        } else {
            if (setting == null || Boolean.TRUE.equals(setting.getWhatsappEnabled())) {
                rows.add(new String[] {CommerceNotificationDelivery.WHATSAPP, templateName(trigger, setting)});
            }
            if (setting == null || Boolean.TRUE.equals(setting.getEmailEnabled())) {
                rows.add(new String[] {CommerceNotificationDelivery.EMAIL, null});
            }
        }
        if (rows.isEmpty()) {
            return skip(event, "NO_CHANNEL");
        }
        Boolean planned = new TransactionTemplate(readOnlyManager()).execute(status -> {
            for (String[] row : rows) {
                store.insertDelivery(event.id(), event.instituteId(), event.orderId(), trigger.name(), row[0], locale,
                        row[1]);
            }
            return store.markPlanned(event.id()) == 1;
        });
        log.info("COMMERCE_NOTIFY event {} order={} trigger={} planned={} channels={}", event.id(), event.orderId(),
                event.triggerCode(), planned, rows.stream().map(r -> r[0]).toList());
        return "PLANNED";
    }

    /** The commerce feature a message of the trigger needs: POS for the bill of a POS sale, else orders. */
    static CommerceFeature featureOf(CommerceNotificationTrigger trigger, String orderChannel) {
        return trigger == CommerceNotificationTrigger.POS_BILL_ISSUED && "POS".equals(orderChannel)
                ? CommerceFeature.POS : CommerceFeature.ORDERS;
    }

    private PlatformTransactionManager readOnlyManager() {
        return readOnly.getTransactionManager();
    }

    private String skip(CommerceNotificationStore.EventRow event, String reason) {
        store.skipEvent(event.id(), reason);
        log.info("COMMERCE_NOTIFY event {} order={} trigger={} skipped code={}", event.id(), event.orderId(),
                event.triggerCode(), reason);
        return reason;
    }

    private CommerceNotificationSetting setting(String instituteId, CommerceNotificationTrigger trigger) {
        return readOnly.execute(status -> settings.findByInstituteIdAndTriggerCode(instituteId, trigger.name())
                .orElse(null));
    }

    static String templateName(CommerceNotificationTrigger trigger, CommerceNotificationSetting setting) {
        return setting != null && StringUtils.hasText(setting.getWhatsappTemplateName())
                ? setting.getWhatsappTemplateName() : trigger.templateName();
    }

    private String baseLocale(String instituteId) {
        try {
            return storefrontSettings.read(instituteId).baseLocale();
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ================================================================== send

    /** Claims and sends one delivery. */
    public Result send(String deliveryId) {
        requireNoTransaction();
        if (!enabled) {
            return Result.HELD;
        }
        CommerceNotificationStore.DeliveryRow pending = store.findDelivery(deliveryId);
        if (pending == null || !CommerceNotificationDelivery.PENDING.equals(pending.status())) {
            return Result.NOT_CLAIMED;
        }
        if (pending.expired()) {
            if (store.expirePending(deliveryId) == 1) {
                log.info("COMMERCE_NOTIFY delivery {} order={} trigger={} channel={} status=EXPIRED", deliveryId,
                        pending.orderId(), pending.triggerCode(), pending.channel());
            }
            return Result.EXPIRED;
        }
        if (store.claim(deliveryId) != 1) {
            return Result.NOT_CLAIMED;
        }
        CommerceNotificationStore.DeliveryRow d = store.findDelivery(deliveryId);
        try {
            // Planned while commerce was on; the institute may have been switched off since.
            CommerceNotificationTrigger trigger = CommerceNotificationTrigger.of(d.triggerCode());
            if (trigger != null) {
                CommerceNotificationStore.OrderFacts facts = store.order(d.instituteId(), d.orderId());
                CommerceAccessGuard.FeatureState state = accessGuard.featureState(d.instituteId(),
                        featureOf(trigger, facts == null ? null : facts.channel()));
                if (state == CommerceAccessGuard.FeatureState.OFF) {
                    return finish(d, CommerceNotificationDelivery.SKIPPED, "COMMERCE_OFF", null, null, null, null);
                }
                if (state != CommerceAccessGuard.FeatureState.ON) {
                    // Nothing was called yet: safe to ask again.
                    store.releaseClaim(d.id(), (int) FEATURE_RETRY.toMinutes(), "FEATURE_UNKNOWN");
                    log.warn("COMMERCE_NOTIFY delivery {} order={} trigger={} channel={}: feature state unknown; "
                            + "asked again later", d.id(), d.orderId(), d.triggerCode(), d.channel());
                    return Result.RETRY;
                }
            }
            if (CommerceNotificationTrigger.COD_CONFIRMATION_NEEDED.name().equals(d.triggerCode())) {
                // Planned while the order waited for the call; staff may have answered it since.
                CommerceNotificationStore.OrderFacts now = store.order(d.instituteId(), d.orderId());
                if (now == null || !CommerceOrderStatus.COD_PENDING_CONFIRMATION.name().equals(now.status())) {
                    return finish(d, CommerceNotificationDelivery.SKIPPED, "STALE", null, null, null, null);
                }
            }
            return switch (d.channel()) {
                case CommerceNotificationDelivery.WORKFLOW -> sendWorkflow(d);
                case CommerceNotificationDelivery.WHATSAPP -> sendWhatsApp(d);
                case CommerceNotificationDelivery.EMAIL -> sendEmail(d);
                default -> finish(d, CommerceNotificationDelivery.SKIPPED, "NOT_APPLICABLE", null, null, null, null);
            };
        } catch (RuntimeException e) {
            // Something of ours failed before or around the call: whether a message left is not known.
            log.error("COMMERCE_NOTIFY delivery {} order={} trigger={} channel={} failed in the sender: {}",
                    deliveryId, d.orderId(), d.triggerCode(), d.channel(), e.getClass().getSimpleName());
            return finish(d, CommerceNotificationDelivery.UNKNOWN, "OUTCOME_UNKNOWN", null, null, null, null);
        }
    }

    /** SENDING for more than ten minutes (the pod died during the call): UNKNOWN, never sent again. */
    public int reapLostClaims(int limit) {
        requireNoTransaction();
        List<CommerceNotificationStore.Lost> lost = store.reapLostClaims(CLAIM_LOST_MINUTES, limit);
        for (CommerceNotificationStore.Lost l : lost) {
            alert(l.instituteId(), l.orderId(), l.triggerCode(), l.channel(), "CLAIM_LOST");
        }
        return lost.size();
    }

    /** Everything a message of this delivery is made of, read in one short transaction. */
    record Context(CommerceNotificationTrigger trigger, CommerceNotificationStore.OrderFacts order,
                   CommerceNotificationMessages.Facts facts, CommerceNotificationSetting setting, String linkBase,
                   Map<String, Object> shipment, Map<String, Object> ret, Map<String, Object> refund) {
    }

    Context context(CommerceNotificationStore.DeliveryRow d, boolean withLink) {
        CommerceNotificationTrigger trigger = CommerceNotificationTrigger.of(d.triggerCode());
        CommerceNotificationStore.OrderFacts order = store.order(d.instituteId(), d.orderId());
        if (order == null || trigger == null) {
            return null;
        }
        CommerceNotificationShopSettings.Shop shop = shopSettings.read(d.instituteId());
        String linkBase = shopSettings.linkBase(d.instituteId(), shop);
        String link = null;
        if (withLink && linkBase != null && linkTokens.isConfigured()) {
            String token = linkTokens.issue(d.instituteId(), d.orderId(), order.linkEpoch(), trigger.tag(),
                    Duration.ofDays(shop.linkDays()));
            link = linkBase + "/order#l=" + token;
        }
        String shopName = shop.shopName().get(d.locale());
        if (!StringUtils.hasText(shopName)) {
            shopName = store.instituteName(d.instituteId());
        }
        String refId = d.refId() == null ? "" : d.refId();
        Map<String, Object> shipment = trigger == CommerceNotificationTrigger.ORDER_SHIPPED && !refId.isEmpty()
                ? store.shipment(d.orderId(), refId) : Map.of();
        Map<String, Object> ret = trigger == CommerceNotificationTrigger.RETURN_APPROVED && !refId.isEmpty()
                ? store.orderReturn(d.orderId(), refId) : Map.of();
        Map<String, Object> refund = trigger == CommerceNotificationTrigger.REFUND_PROCESSED && !refId.isEmpty()
                ? store.refund(d.orderId(), refId) : Map.of();
        String currency = order.currency();
        String amountDue = CommerceNotificationValues.money("COD".equals(order.paymentMethod())
                ? decimal(shipment.get("cod_amount")) : BigDecimal.ZERO, currency);
        Integer returnDays = null;
        if (trigger == CommerceNotificationTrigger.ORDER_DELIVERED) {
            try {
                returnDays = returnSettings.read(d.instituteId()).windowDays();
            } catch (RuntimeException e) {
                returnDays = null;
            }
        }
        List<CommerceNotificationEmailRenderer.Item> items = new ArrayList<>();
        if (trigger.itemsTable() && CommerceNotificationDelivery.EMAIL.equals(d.channel())) {
            for (Map<String, Object> line : store.itemLines(d.orderId())) {
                items.add(new CommerceNotificationEmailRenderer.Item(text(line.get("name_snapshot")),
                        text(line.get("variant_label")), itemQuantity(line),
                        CommerceNotificationValues.money(decimal(line.get("line_total")), currency)));
            }
        }
        String refundReference = text(refund.get("gateway_refund_id"));
        if (!StringUtils.hasText(refundReference)) {
            refundReference = text(refund.get("reference"));
        }
        CommerceNotificationMessages.Facts facts = new CommerceNotificationMessages.Facts(order.customerName(),
                shopName, order.orderNumber(), CommerceNotificationValues.money(order.total(), currency), link,
                text(shipment.get("carrier_name")), text(shipment.get("tracking_number")), amountDue,
                order.cancelReason(), text(ret.get("return_number")),
                refund.isEmpty() ? null : CommerceNotificationValues.money(decimal(refund.get("amount")),
                        text(refund.get("currency")) == null ? currency : text(refund.get("currency"))),
                text(refund.get("method")), returnDays, refundReference, items,
                CommerceNotificationValues.money(order.total(), currency));
        return new Context(trigger, order, facts, setting(d.instituteId(), trigger), linkBase, shipment, ret, refund);
    }

    private Result sendWhatsApp(CommerceNotificationStore.DeliveryRow d) {
        Context c = readOnly.execute(status -> context(d, false));
        if (c == null) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NOT_APPLICABLE", null, null, null, null);
        }
        String phone = CommercePhones.normalise(c.order().customerPhone());
        if (phone == null) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NO_PHONE", null, null, null, null);
        }
        String masked = CommerceMasks.phone(phone);
        String hash = recipientHash(phone);
        if (!phoneProved(c.order())) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "PHONE_NOT_VERIFIED", null, null, hash, masked);
        }
        String templateName = StringUtils.hasText(d.templateName()) ? d.templateName()
                : templateName(c.trigger(), c.setting());
        if (!CommerceWhatsAppTemplateStatus.APPROVED.equals(templates.status(d.instituteId(), templateName,
                d.locale()))) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "TEMPLATE_NOT_APPROVED", null, null, hash, masked);
        }
        // Order messages are transactional: only a template of the UTILITY category goes out.
        if (!CommerceWhatsAppTemplateStatus.isUtility(templates.category(d.instituteId(), templateName,
                d.locale()))) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "TEMPLATE_NOT_UTILITY", null, null, hash, masked);
        }
        if (c.linkBase() == null || !linkTokens.isConfigured()) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NO_SHOP_URL", null, null, hash, masked);
        }
        // The link is minted now: a retried send gets a fresh expiry.
        Context withLink = readOnly.execute(status -> context(d, true));
        Map<String, String> variables = CommerceNotificationMessages.whatsappVariables(c.trigger(), d.locale(),
                withLink.facts());
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(d.instituteId())
                .channel("WHATSAPP")
                .templateName(templateName)
                .languageCode(d.locale())
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().phone(phone).userId(c.order().userId())
                        .variables(variables).build()))
                .options(UnifiedSendRequest.SendOptions.builder().source(SOURCE).sourceId(d.id())
                        .originType("COMMERCE").originName(c.trigger().name()).build())
                .build();
        return call(d, request, hash, masked);
    }

    private Result sendEmail(CommerceNotificationStore.DeliveryRow d) {
        Context c = readOnly.execute(status -> context(d, true));
        if (c == null) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NOT_APPLICABLE", null, null, null, null);
        }
        String email = c.order().customerEmail();
        if (!CommerceEmails.deliverable(email)) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NO_EMAIL", null, null, null, null);
        }
        email = email.trim();
        String masked = CommerceMasks.email(email);
        String hash = recipientHash(email.toLowerCase(java.util.Locale.ROOT));
        CommerceNotificationEmailRenderer.Email rendered = messages.email(c.trigger(), d.locale(), c.facts(),
                c.setting());
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(d.instituteId())
                .channel("EMAIL")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().email(email).userId(c.order().userId())
                        .build()))
                .options(UnifiedSendRequest.SendOptions.builder().emailSubject(rendered.subject())
                        .emailBody(rendered.html()).emailType("UTILITY_EMAIL").source(SOURCE).sourceId(d.id())
                        .build())
                .build();
        return call(d, request, hash, masked);
    }

    private Result sendWorkflow(CommerceNotificationStore.DeliveryRow d) {
        Context c = readOnly.execute(status -> context(d, true));
        if (c == null) {
            return finish(d, CommerceNotificationDelivery.SKIPPED, "NOT_APPLICABLE", null, null, null, null);
        }
        WorkflowTriggerService engine = workflows.getIfAvailable();
        if (engine == null) {
            return finish(d, CommerceNotificationDelivery.FAILED, "WORKFLOW_ERROR", null, null, null, null);
        }
        try {
            engine.handleTriggerEvents(c.trigger().name(), d.orderId(), d.instituteId(), workflowContext(d, c));
        } catch (RuntimeException e) {
            log.warn("COMMERCE_NOTIFY delivery {} order={} trigger={} channel=WORKFLOW failed: {}", d.id(),
                    d.orderId(), d.triggerCode(), e.getClass().getSimpleName());
            return finish(d, CommerceNotificationDelivery.FAILED, "WORKFLOW_ERROR", null, null, null, null);
        }
        return finish(d, CommerceNotificationDelivery.SENT, null, null, null, null, null);
    }

    /** The keys a workflow of the trigger gets; keys that do not apply are absent. */
    Map<String, Object> workflowContext(CommerceNotificationStore.DeliveryRow d, Context c) {
        Map<String, String> values = CommerceNotificationMessages.values(c.trigger(), d.locale(), c.facts());
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("orderId", d.orderId());
        ctx.put("orderNumber", c.order().orderNumber());
        ctx.put("trigger", c.trigger().name());
        ctx.put("locale", d.locale());
        ctx.put("customerName", values.getOrDefault("customer_name",
                CommerceNotificationValues.clean(c.order().customerName(), CommerceNotificationValues.CAP_NAME,
                        CommerceNotificationValues.customerFallback(d.locale()))));
        String phone = CommercePhones.normalise(c.order().customerPhone());
        if (phone != null && phoneProved(c.order())) {
            ctx.put("customerPhone", phone);
        }
        if (CommerceEmails.deliverable(c.order().customerEmail())) {
            ctx.put("customerEmail", c.order().customerEmail().trim());
        }
        if (c.order().userId() != null) {
            ctx.put("userId", c.order().userId());
        }
        ctx.put("orderTotal", CommerceNotificationValues.money(c.order().total(), c.order().currency()));
        if (c.facts().link() != null) {
            ctx.put("orderLink", c.facts().link());
        }
        ctx.put("shopName", values.get("shop_name"));
        String refId = d.refId() == null ? "" : d.refId();
        switch (c.trigger()) {
            case ORDER_SHIPPED -> {
                ctx.put("shipmentId", refId);
                ctx.put("courier", values.get("courier"));
                ctx.put("trackingNumber", values.get("tracking_number"));
                ctx.put("amountDue", values.get("amount_due"));
            }
            case ORDER_DELIVERED, ORDER_RTO -> {
                if (!refId.isEmpty()) {
                    ctx.put("shipmentId", refId);
                }
            }
            case ORDER_CANCELLED -> ctx.put("cancelReason", values.get("cancel_reason"));
            case RETURN_APPROVED -> {
                ctx.put("returnId", refId);
                ctx.put("returnNumber", values.get("return_number"));
            }
            case REFUND_PROCESSED -> {
                ctx.put("refundId", refId);
                ctx.put("refundAmount", values.get("refund_amount"));
                ctx.put("refundMethod", values.get("refund_method"));
            }
            default -> {
            }
        }
        return ctx;
    }

    /** WhatsApp only to a phone that was proved: an OTP, or typed by staff with the buyer present. */
    static boolean phoneProved(CommerceNotificationStore.OrderFacts order) {
        return order.phoneVerified() || "ADMIN".equals(order.channel()) || "POS".equals(order.channel());
    }

    // ================================================================== the call and its answer

    private Result call(CommerceNotificationStore.DeliveryRow d, UnifiedSendRequest request, String hash,
                        String masked) {
        requireNoTransaction();
        UnifiedSendResponse response;
        try {
            response = notificationService.sendUnified(request);
        } catch (ResourceAccessException e) {
            if (causedBy(e, SocketTimeoutException.class) || !(causedBy(e, ConnectException.class)
                    || causedBy(e, UnknownHostException.class))) {
                return finish(d, CommerceNotificationDelivery.UNKNOWN, "OUTCOME_UNKNOWN", null, null, hash, masked);
            }
            return retry(d, "PLATFORM_UNREACHABLE", hash, masked);
        } catch (HttpStatusCodeException e) {
            HttpStatusCode code = e.getStatusCode();
            if (code.value() == HttpStatus.SERVICE_UNAVAILABLE.value()) {
                return retry(d, "PLATFORM_UNAVAILABLE", hash, masked);
            }
            if (code.is4xxClientError()) {
                return finish(d, CommerceNotificationDelivery.FAILED, "REQUEST_REFUSED", null, null, hash, masked);
            }
            return finish(d, CommerceNotificationDelivery.UNKNOWN, "OUTCOME_UNKNOWN", null, null, hash, masked);
        } catch (VacademyException e) {
            // An empty or unparsable answer: the platform may have sent it.
            return finish(d, CommerceNotificationDelivery.UNKNOWN, "ANSWER_UNREADABLE", null, null, hash, masked);
        } catch (RuntimeException e) {
            return finish(d, CommerceNotificationDelivery.UNKNOWN, "OUTCOME_UNKNOWN", null, null, hash, masked);
        }
        return answer(d, response, hash, masked);
    }

    private Result answer(CommerceNotificationStore.DeliveryRow d, UnifiedSendResponse response, String hash,
                          String masked) {
        UnifiedSendResponse.RecipientResult result = response == null || response.getResults() == null
                || response.getResults().isEmpty() ? null : response.getResults().get(0);
        if (result == null || result.getStatus() == null) {
            if (result != null && result.isSuccess()) {
                return finish(d, CommerceNotificationDelivery.SENT, null, null, result.getMessageId(), hash, masked);
            }
            return finish(d, CommerceNotificationDelivery.UNKNOWN, "ANSWER_UNREADABLE", null, null, hash, masked);
        }
        return switch (result.getStatus().trim().toUpperCase(java.util.Locale.ROOT)) {
            case "SENT" -> finish(d, CommerceNotificationDelivery.SENT, null, null, result.getMessageId(), hash,
                    masked);
            case "QUEUED" -> finish(d, CommerceNotificationDelivery.SENT, "QUEUED_BY_PLATFORM", null,
                    result.getMessageId(), hash, masked);
            case "SKIPPED_UNSUBSCRIBED" -> finish(d, CommerceNotificationDelivery.SKIPPED, "UNSUBSCRIBED", null, null,
                    hash, masked);
            // The platform does not write to an address that bounced or is blocklisted: nothing was sent.
            case "SKIPPED_BLOCKED" -> finish(d, CommerceNotificationDelivery.SKIPPED, "ADDRESS_BLOCKED", null, null,
                    hash, masked);
            case "BLOCKED_NO_CREDITS" -> finish(d, CommerceNotificationDelivery.FAILED, "NO_CREDITS", null, null, hash,
                    masked);
            case "FAILED" -> finish(d, CommerceNotificationDelivery.FAILED, "PROVIDER_REJECTED",
                    CommerceNotificationValues.errorDetail(result.getError()), null, hash, masked);
            default -> result.isSuccess()
                    ? finish(d, CommerceNotificationDelivery.SENT, null, null, result.getMessageId(), hash, masked)
                    : finish(d, CommerceNotificationDelivery.UNKNOWN, "ANSWER_UNREADABLE", null, null, hash, masked);
        };
    }

    private Result retry(CommerceNotificationStore.DeliveryRow d, String code, String hash, String masked) {
        int attempts = Math.max(1, d.attempts());
        if (attempts >= MAX_ATTEMPTS) {
            return finish(d, CommerceNotificationDelivery.FAILED, "RETRIES_EXHAUSTED", null, null, hash, masked);
        }
        store.retryDelivery(d.id(), RETRY_MINUTES[attempts - 1], code, hash, masked);
        log.warn("COMMERCE_NOTIFY delivery {} order={} trigger={} channel={} retry in {} min code={}", d.id(),
                d.orderId(), d.triggerCode(), d.channel(), RETRY_MINUTES[attempts - 1], code);
        return Result.RETRY;
    }

    private Result finish(CommerceNotificationStore.DeliveryRow d, String status, String code, String detail,
                          String providerMessageId, String hash, String masked) {
        boolean sent = CommerceNotificationDelivery.SENT.equals(status);
        store.finish(d.id(), status, code, detail, providerMessageId == null ? null
                : (providerMessageId.length() > 128 ? providerMessageId.substring(0, 128) : providerMessageId),
                hash, masked, sent);
        log.info("COMMERCE_NOTIFY delivery {} order={} trigger={} channel={} status={} code={}", d.id(), d.orderId(),
                d.triggerCode(), d.channel(), status, code);
        if (CommerceNotificationDelivery.FAILED.equals(status) || CommerceNotificationDelivery.UNKNOWN.equals(status)) {
            alert(d.instituteId(), d.orderId(), d.triggerCode(), d.channel(), code);
        }
        return switch (status) {
            case CommerceNotificationDelivery.SENT -> Result.SENT;
            case CommerceNotificationDelivery.SKIPPED -> Result.SKIPPED;
            case CommerceNotificationDelivery.FAILED -> Result.FAILED;
            case CommerceNotificationDelivery.EXPIRED -> Result.EXPIRED;
            default -> Result.UNKNOWN;
        };
    }

    private static void alert(String instituteId, String orderId, String trigger, String channel, String code) {
        log.error("COMMERCE_ALERT notification_failed institute={} order={} trigger={} channel={} code={}",
                instituteId, orderId, trigger, channel, code);
    }

    private static boolean causedBy(Throwable e, Class<? extends Throwable> type) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (type.isInstance(t)) {
                return true;
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return false;
    }

    // ================================================================== helpers

    /** Hex HMAC of the normalised address; never the address. Null without a secret. */
    String recipientHash(String normalised) {
        if (recipientKey == null || normalised == null) {
            return null;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(recipientKey, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(normalised.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            return null;
        }
    }

    private static byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private static BigDecimal decimal(Object value) {
        if (value instanceof BigDecimal b) {
            return b;
        }
        if (value instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        return BigDecimal.ZERO;
    }

    /**
     * The quantity cell of an email item: "2.5 m" for 25 base units of a scale-10 MTR line, the
     * stored count for a counted line.
     */
    public static String itemQuantity(Map<String, Object> line) {
        Object quantity = line.get("quantity");
        int scale = line.get("qty_scale") instanceof Number n ? n.intValue() : 1;
        if (!(quantity instanceof Number number) || !CommerceUnits.measured(scale)) {
            return text(quantity);
        }
        return CommerceUnits.shortQuantity(number.longValue(), scale, text(line.get("unit")));
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }
}
