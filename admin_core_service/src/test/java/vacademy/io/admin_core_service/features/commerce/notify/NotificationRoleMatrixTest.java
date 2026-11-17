package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.notify.controller.CommerceNotificationSettingsController;
import vacademy.io.admin_core_service.features.commerce.notify.controller.CommerceOrderNotificationController;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationSettingRepository;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderAccessTokens;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiConsumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Who may call each new staff route of the buyer messages, through the controllers and the real
 * commerce guard: ADMIN, store manager (M), warehouse staff (W), accountant (Ac), cashier, a
 * learner, another institute's admin and a shopper with no staff role. "403" is the guard's
 * refusal; "ok" means the caller got past it (whatever the service answered next).
 */
@SuppressWarnings("unchecked")
class NotificationRoleMatrixTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final String ORDER = "order-1";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> CALLERS = List.of("ADMIN", "M", "W", "Ac", "cashier", "learner",
            "other-institute admin", "shopper");

    private CommerceAccessGuard guard;
    private CapabilityResolver capabilities;
    private Mocks last;

    @BeforeEach
    void setUp() {
        capabilities = mock(CapabilityResolver.class);
        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(true);
        CommerceStaffLocationRepository staffLocations = mock(CommerceStaffLocationRepository.class);
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, "user-1", LOC)).thenReturn(true);
        guard = new CommerceAccessGuard(capabilities, staffLocations);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        lenient().when(user.getUserId()).thenReturn("user-1");
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        lenient().when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    private static CustomUserDetails caller(String who) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", who.equals("other-institute admin") ? "inst-2" : INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        return switch (who) {
            case "ADMIN", "other-institute admin" -> user("ADMIN");
            case "M" -> user("COMMERCE_STORE_MANAGER");
            case "W" -> user("COMMERCE_WAREHOUSE_STAFF");
            case "Ac" -> user("COMMERCE_ACCOUNTANT");
            case "cashier" -> user("COMMERCE_POS_CASHIER");
            case "learner" -> user("STUDENT");
            default -> user();
        };
    }

    /** The routes and the mocks behind them (to check that a refused call touched nothing). */
    private record Mocks(CommerceNotificationSettingsController settings, CommerceOrderNotificationController orders,
                         JdbcTemplate jdbc, NotificationService notificationService, EngagementInternalClients client,
                         CommerceNotificationStore store, CommerceAuditService audit, CommerceRateLimiter rateLimiter,
                         CommerceOrderDeskService desk) {
    }

    private Mocks routes() {
        CommerceSetupAccess setupAccess = new CommerceSetupAccess(guard);
        CommerceNotificationSettingRepository repository = mock(CommerceNotificationSettingRepository.class);
        when(repository.findByInstituteIdAndTriggerCode(eq(INST), anyString())).thenReturn(Optional.empty());
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        CommerceWhatsAppTemplateStatus templates = mock(CommerceWhatsAppTemplateStatus.class);
        CommerceNotificationShopSettings shopSettings = mock(CommerceNotificationShopSettings.class);
        when(shopSettings.read(anyString())).thenReturn(CommerceNotificationShopSettings.Shop.defaults());
        CommerceNotificationStore store = mock(CommerceNotificationStore.class);
        when(store.revokeLinks(INST, ORDER)).thenReturn(1);
        CommerceAuditService audit = mock(CommerceAuditService.class);
        CommerceRateLimiter rateLimiter = mock(CommerceRateLimiter.class);
        NotificationService notificationService = mock(NotificationService.class);
        EngagementInternalClients client = mock(EngagementInternalClients.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        CommerceNotificationSettingsService settingsService = new CommerceNotificationSettingsService(setupAccess,
                repository, jdbc, templates, mock(ObjectProvider.class), shopSettings,
                mock(CommerceStorefrontSettings.class), mock(CommerceOrderLinkTokens.class),
                mock(CommerceNotificationDispatcher.class), mock(CommerceCheckoutSettingsService.class), audit, store,
                JSON, tm);
        CommerceNotificationTestSendService testSend = new CommerceNotificationTestSendService(setupAccess,
                rateLimiter, mock(AuthService.class), repository, templates, shopSettings, store,
                new CommerceNotificationMessages(new CommerceNotificationEmailRenderer()), notificationService, audit,
                JSON);
        CommerceNotificationTemplateSubmitService templateSubmit = new CommerceNotificationTemplateSubmitService(
                setupAccess, rateLimiter, templates, client, audit, JSON);

        CommerceOrderDeskService desk = mock(CommerceOrderDeskService.class);
        CommerceOrder order = new CommerceOrder();
        order.setId(ORDER);
        order.setInstituteId(INST);
        order.setFulfilmentLocationId(LOC);
        lenient().when(desk.readOrder(INST, ORDER)).thenReturn(order);
        lenient().when(desk.lockOrder(INST, ORDER)).thenReturn(order);
        doAnswer(call -> {
            guard.require(call.getArgument(0), call.getArgument(1), CommerceFeature.ORDERS, call.getArgument(3),
                    call.getArgument(2));
            return null;
        }).when(desk).authorize(any(), anyString(), any(), any(Set.class));
        CommerceOrderLinkService linkService = new CommerceOrderLinkService(mock(CommerceOrderLinkTokens.class),
                mock(CommerceOrderAccessTokens.class), store, desk, guard, audit, tm);
        Mocks made = new Mocks(new CommerceNotificationSettingsController(settingsService, testSend, templateSubmit),
                new CommerceOrderNotificationController(guard, desk, store, linkService), jdbc, notificationService,
                client, store, audit, rateLimiter, desk);
        last = made;
        return made;
    }

    private static JsonNode body(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private Map<String, String> matrix(BiConsumer<Mocks, CustomUserDetails> call) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String who : CALLERS) {
            CustomUserDetails user = caller(who);
            Mocks routes = routes();
            try {
                call.accept(routes, user);
                out.put(who, "ok");
            } catch (CommerceAccessDeniedException e) {
                out.put(who, "403");
            } catch (RuntimeException e) {
                out.put(who, "ok");
            }
        }
        return out;
    }

    private static Map<String, String> allowed(String... who) {
        Set<String> ok = Set.of(who);
        Map<String, String> out = new LinkedHashMap<>();
        for (String c : CALLERS) {
            out.put(c, c.equals("ADMIN") || ok.contains(c) ? "ok" : "403");
        }
        return out;
    }

    /** Every new staff route, as one call each, with the callers it lets in (ADMIN always). */
    private static Map<String, Map.Entry<BiConsumer<Mocks, CustomUserDetails>, String[]>> everyRoute() {
        Map<String, Map.Entry<BiConsumer<Mocks, CustomUserDetails>, String[]>> routes = new LinkedHashMap<>();
        routes.put("GET /notification-settings", Map.entry((r, u) -> r.settings().get(INST, u),
                new String[] {"M", "Ac"}));
        routes.put("PUT /notification-settings/triggers/{trigger}", Map.entry((r, u) -> r.settings().updateTrigger(
                "ORDER_SHIPPED", INST, body("{\"version\":0,\"enabled\":false}"), u), new String[] {"M"}));
        routes.put("PUT /notification-settings/shop", Map.entry((r, u) -> r.settings().updateShop(INST,
                body("{\"link_days\":7}"), u), new String[] {"M"}));
        routes.put("POST /notification-settings/test-send", Map.entry((r, u) -> r.settings().testSend(INST,
                body("{\"trigger\":\"ORDER_SHIPPED\",\"locale\":\"en\"}"), u), new String[] {"M"}));
        routes.put("POST /notification-settings/whatsapp-templates", Map.entry((r, u) -> r.settings()
                .whatsappTemplates(INST, body("{\"triggers\":null}"), u), new String[] {"M"}));
        routes.put("GET /orders/{id}/notifications", Map.entry((r, u) -> r.orders().notifications(ORDER, INST, u),
                new String[] {"M", "W", "Ac"}));
        routes.put("POST /orders/{id}/links/revoke", Map.entry((r, u) -> r.orders().revokeLinks(ORDER, INST, u),
                new String[] {"M"}));
        return routes;
    }

    @Test
    void everyRouteLetsInExactlyItsRoles() {
        Map<String, Map.Entry<BiConsumer<Mocks, CustomUserDetails>, String[]>> routes = everyRoute();
        assertEquals(7, routes.size());
        for (Map.Entry<String, Map.Entry<BiConsumer<Mocks, CustomUserDetails>, String[]>> route : routes.entrySet()) {
            assertEquals(allowed(route.getValue().getValue()), matrix(route.getValue().getKey()), route.getKey());
        }
    }

    @Test
    void theRoleSetsAreTheContractOnes() {
        assertEquals(Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT),
                CommerceNotificationSettingsService.READ);
        assertEquals(Set.of(CommerceRole.STORE_MANAGER), CommerceNotificationSettingsService.WRITE);
        assertEquals(Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF, CommerceRole.ACCOUNTANT),
                CommerceOrderNotificationController.READ);
    }

    @Test
    void aReaderNotAssignedToTheOrdersLocationIsRefused() {
        CustomUserDetails warehouse = caller("W");
        Mocks routes = routes();
        CommerceOrder elsewhere = new CommerceOrder();
        elsewhere.setId(ORDER);
        elsewhere.setFulfilmentLocationId("loc-2");
        when(routes.desk().readOrder(INST, ORDER)).thenReturn(elsewhere);
        CommerceAccessDeniedException e = org.junit.jupiter.api.Assertions.assertThrows(
                CommerceAccessDeniedException.class, () -> routes.orders().notifications(ORDER, INST, warehouse));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, e.getCode());
        verify(routes.store(), never()).ofOrder(anyString(), anyString(), org.mockito.ArgumentMatchers.anyInt());
    }

    /** The "commerce off" column: every route answers 403 FEATURE_DISABLED and touches nothing. */
    @Test
    void withCommerceOffEveryRouteIsRefusedForEveryMemberRole() {
        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(false);
        for (Map.Entry<String, Map.Entry<BiConsumer<Mocks, CustomUserDetails>, String[]>> route
                : everyRoute().entrySet()) {
            for (String who : List.of("ADMIN", "M", "W", "Ac")) {
                CustomUserDetails user = caller(who);
                Mocks made = routes();
                String answer;
                try {
                    route.getValue().getKey().accept(made, user);
                    answer = "ok";
                } catch (CommerceAccessDeniedException e) {
                    answer = "403 " + e.getCode();
                } catch (RuntimeException e) {
                    answer = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                assertEquals("403 FEATURE_DISABLED", answer, route.getKey() + " as " + who);
                verifyNoInteractions(last.jdbc(), last.notificationService(), last.client(), last.audit(),
                        last.rateLimiter());
                verify(last.store(), never()).revokeLinks(anyString(), anyString());
                verify(last.store(), never()).ofOrder(anyString(), anyString(), org.mockito.ArgumentMatchers.anyInt());
            }
        }
    }
}
