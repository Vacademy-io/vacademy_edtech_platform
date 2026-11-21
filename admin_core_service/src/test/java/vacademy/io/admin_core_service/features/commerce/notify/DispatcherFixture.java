package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

/**
 * The dispatcher over an in-memory store that behaves like its SQL, a transaction manager that
 * really opens transactions, a real link token signer and real message builder, and mocks for
 * the rest. The send API mock fails the test when it is called inside a transaction.
 */
@SuppressWarnings("unchecked")
public class DispatcherFixture {

    public static final String INST = "inst-1";
    public static final String ORDER = "order-1";
    public static final String PHONE = "9876543210";
    public static final String EMAIL = "asha.verma@example.com";
    public static final String NAME = "Asha Verma";
    public static final String LINK_BASE = "https://shop.example.com";
    public static final String LINK_SECRET = "link-secret-for-tests";

    /** The order a message is about; change fields, then {@link #put()}. */
    public final class OrderSpec {
        public String orderNumber = "SH-000123";
        public String customerName = NAME;
        public String customerPhone = PHONE;
        public String customerEmail = EMAIL;
        public boolean phoneVerified = true;
        public String channel = "ONLINE";
        public String userId = "user-1";
        public String locale = "en";
        public BigDecimal total = new BigDecimal("1499.00");
        public String currency = "INR";
        public String cancelReason;
        public String paymentMethod = "PREPAID";
        public String status = "CONFIRMED";
        public int linkEpoch;
        public String customerId = "cust-1";

        public void put() {
            store.orders.put(ORDER, new CommerceNotificationStore.OrderFacts(ORDER, INST, orderNumber, customerName,
                    customerPhone, customerEmail, phoneVerified, channel, userId, locale, total, currency,
                    cancelReason, paymentMethod, status, linkEpoch, customerId));
        }
    }

    public final InMemoryNotificationStore store = new InMemoryNotificationStore();
    public final CommerceNotificationSettingRepository settings = mock(CommerceNotificationSettingRepository.class);
    public final CommerceAccessGuard accessGuard = mock(CommerceAccessGuard.class);
    public final ObjectProvider<WorkflowTriggerService> workflows = mock(ObjectProvider.class);
    public final WorkflowTriggerService workflowService = mock(WorkflowTriggerService.class);
    public final NotificationService notificationService = mock(NotificationService.class);
    public final CommerceWhatsAppTemplateStatus templates = mock(CommerceWhatsAppTemplateStatus.class);
    public final CommerceNotificationShopSettings shopSettings = mock(CommerceNotificationShopSettings.class);
    public final CommerceStorefrontSettings storefrontSettings = mock(CommerceStorefrontSettings.class);
    public final CommerceReturnSettings returnSettings = mock(CommerceReturnSettings.class);
    public final CommerceOrderLinkTokens linkTokens;
    public final FakeTransactions transactions = new FakeTransactions();
    public final List<UnifiedSendRequest> sent = new ArrayList<>();
    public final OrderSpec order = new OrderSpec();
    /** What the send API does with a request; by default it answers SENT. */
    public SendAnswer answer = request -> sentAnswer("SENT", true, "wamid-1", null);
    public final CommerceNotificationDispatcher dispatcher;

    /** The send API's behaviour (may throw). */
    @FunctionalInterface
    public interface SendAnswer {
        UnifiedSendResponse apply(UnifiedSendRequest request);
    }

    public DispatcherFixture() {
        this(true, LINK_SECRET);
    }

    public DispatcherFixture(boolean enabled, String linkSecret) {
        linkTokens = new CommerceOrderLinkTokens(linkSecret);
        lenient().when(settings.findByInstituteIdAndTriggerCode(anyString(), anyString())).thenReturn(Optional.empty());
        lenient().when(accessGuard.featureState(anyString(), any())).thenReturn(CommerceAccessGuard.FeatureState.ON);
        lenient().when(workflows.getIfAvailable()).thenReturn(workflowService);
        lenient().when(templates.status(anyString(), anyString(), anyString()))
                .thenReturn(CommerceWhatsAppTemplateStatus.APPROVED);
        lenient().when(templates.category(anyString(), anyString(), anyString()))
                .thenReturn(CommerceWhatsAppTemplateStatus.UTILITY);
        lenient().when(shopSettings.read(anyString())).thenReturn(CommerceNotificationShopSettings.Shop.defaults());
        lenient().when(shopSettings.linkBase(anyString(), any())).thenReturn(LINK_BASE);
        lenient().when(returnSettings.read(anyString())).thenReturn(CommerceReturnPolicy.defaults());
        lenient().when(notificationService.sendUnified(any())).thenAnswer(call -> {
            if (TransactionSynchronizationManager.isActualTransactionActive()) {
                throw new AssertionError("the send API is never called inside a transaction");
            }
            UnifiedSendRequest request = call.getArgument(0);
            sent.add(request);
            return answer.apply(request);
        });
        store.instituteNames.put(INST, "Example Shop");
        order.put();
        dispatcher = new CommerceNotificationDispatcher(store, settings, accessGuard, workflows, notificationService,
                templates, shopSettings, storefrontSettings, returnSettings, linkTokens,
                new CommerceNotificationMessages(new CommerceNotificationEmailRenderer()), transactions, enabled,
                "order-token-secret-for-tests");
    }

    public static UnifiedSendResponse sentAnswer(String status, boolean success, String messageId, String error) {
        return UnifiedSendResponse.builder().total(1).results(List.of(UnifiedSendResponse.RecipientResult.builder()
                .status(status).success(success).messageId(messageId).error(error).build())).build();
    }

    /** A settings row of the trigger (every switch on until changed). */
    public CommerceNotificationSetting setting(String trigger) {
        CommerceNotificationSetting s = new CommerceNotificationSetting();
        s.setInstituteId(INST);
        s.setTriggerCode(trigger);
        lenient().when(settings.findByInstituteIdAndTriggerCode(INST, trigger)).thenReturn(Optional.of(s));
        return s;
    }

    /** An outbox row of the order; its id. */
    public String event(String trigger, String refId) {
        return store.event(INST, ORDER, trigger, refId);
    }

    /** An outbox row, planned; its id. */
    public String planned(String trigger, String refId) {
        String id = event(trigger, refId);
        dispatcher.plan(store.row(id));
        return id;
    }

    /** The delivery of a planned event on a channel; its id. */
    public String delivery(String eventId, String channel) {
        InMemoryNotificationStore.Delivery d = store.delivery(eventId, channel);
        return d == null ? null : d.id;
    }

    public InMemoryNotificationStore.Delivery row(String deliveryId) {
        return store.deliveries.get(deliveryId);
    }
}
