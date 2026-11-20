package vacademy.io.admin_core_service.features.commerce.accounts;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadController;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadService;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementController;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementService;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockController;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockPreviewContributor;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockService;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommercePeriodLockRepository.LockRow;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierController;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SensitiveRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.StatusRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierSensitiveService;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierService;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceStaffController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceStaffService;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffPinRequest;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.when;

/**
 * Every WP-60a route × every caller (institute ADMIN, location-limited and institute-wide manager
 * and accountant, warehouse staff with and without a scope row, cashier, learner, shopper, another
 * institute's ADMIN) × the accounts feature on and off, through the real {@link CommerceAccessGuard}
 * and the real controllers (the reveal and the period-lock services check access themselves and are
 * real here too). A refusal must carry the expected code and reach nothing behind the guard; a pass
 * must reach the service.
 */
class AccountsRoleMatrixTest {

    private static final String INST = "inst-acc";
    private static final String OTHER = "inst-other";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 20);
    private static final String ACCESS_DENIED = CommerceAccessDeniedException.ACCESS_DENIED;
    private static final String FEATURE_DISABLED = CommerceAccessDeniedException.FEATURE_DISABLED;
    private static final String ROLE_NOT_ALLOWED = CommerceAccessDeniedException.ROLE_NOT_ALLOWED;
    private static final String WIDE_REQUIRED = CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED;
    private static final String PASS = "PASS";

    private final Set<String> grantedFeatures = new HashSet<>();
    private final Set<String> wideUsers = new HashSet<>();

    private CommerceAccessGuard guard;
    private CommerceStaffLocationRepository staffLocations;
    private CommerceStaffScopeRepository scopes;
    // Everything behind the guard, mocked; a pass must touch one of these.
    private CommerceFieldCipher cipher;
    private CommerceSupplierSecretRepository secretRepository;
    private CommerceSupplierRepository supplierRepository;
    private SupplierService supplierService;
    private SupplierStatementService statementService;
    private AccountHeadService headService;
    private CommerceStaffService staffService;
    private CommercePeriodLockRepository lockRepository;
    private CommerceRequestGuard requestGuard;
    private CommerceApprovalService approvalService;
    private CommerceAuditService auditService;
    private PeriodLockPreviewContributor contributor;

    private AccountsMeController me;
    private SupplierController suppliers;
    private SupplierStatementController statements;
    private AccountHeadController heads;
    private PeriodLockController periodLocks;
    private CommerceStaffController staff;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        CapabilityResolver resolver = mock(CapabilityResolver.class);
        when(resolver.isFeatureGranted(anyString(), anyString()))
                .thenAnswer(inv -> grantedFeatures.contains(inv.getArgument(0) + "|" + inv.getArgument(1)));
        staffLocations = mock(CommerceStaffLocationRepository.class);
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(anyString(), anyString(), anyString()))
                .thenReturn(true);
        scopes = mock(CommerceStaffScopeRepository.class);
        when(scopes.existsByInstituteIdAndUserIdAndAllLocationsTrue(anyString(), anyString()))
                .thenAnswer(inv -> wideUsers.contains(inv.getArgument(1)));
        guard = new CommerceAccessGuard(resolver, staffLocations);
        guard.setStaffScopeRepository(scopes);

        cipher = mock(CommerceFieldCipher.class);
        secretRepository = mock(CommerceSupplierSecretRepository.class);
        supplierRepository = mock(CommerceSupplierRepository.class);
        CommerceSupplier supplier = new CommerceSupplier();
        supplier.setId("sup-1");
        supplier.setInstituteId(INST);
        when(supplierRepository.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(supplier));
        supplierService = mock(SupplierService.class);
        statementService = mock(SupplierStatementService.class);
        headService = mock(AccountHeadService.class);
        staffService = mock(CommerceStaffService.class);
        lockRepository = mock(CommercePeriodLockRepository.class);
        LockRow locked = () -> TODAY.minusDays(30);
        when(lockRepository.readForUpdate(anyString())).thenReturn(List.of(locked));
        when(lockRepository.findByInstituteId(anyString())).thenReturn(Optional.empty());
        requestGuard = mock(CommerceRequestGuard.class);
        when(requestGuard.run(any(), any(), any())).thenAnswer(inv ->
                new CommerceRequestGuard.Outcome<>(((Supplier<Object>) inv.getArgument(1)).get(), false));
        approvalService = mock(CommerceApprovalService.class);
        auditService = mock(CommerceAuditService.class);
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(TODAY);

        me = new AccountsMeController(guard, cipher, secretRepository);
        suppliers = new SupplierController(guard, supplierService,
                new SupplierSensitiveService(guard, supplierRepository, secretRepository, cipher, auditService, tx));
        statements = new SupplierStatementController(guard, statementService);
        heads = new AccountHeadController(guard, headService);
        contributor = mock(PeriodLockPreviewContributor.class);
        when(contributor.kind()).thenReturn("TEST_KIND");
        periodLocks = new PeriodLockController(new PeriodLockService(lockRepository, guard, clock, requestGuard,
                approvalService, auditService, mock(JdbcTemplate.class), tx, List.of(contributor)));
        staff = new CommerceStaffController(guard, staffService, mock(StockLocationService.class));
    }

    @AfterEach
    void clearHeader() {
        RequestContextHolder.resetRequestAttributes();
    }

    // ------------------------------------------------------------------ callers

    /** A caller: who they are, the header they send, and what the guard should know about them. */
    private record Caller(String name, CustomUserDetails user, String header, boolean admin, boolean manager,
                          boolean accountant, boolean anyCommerceRole, boolean wide, boolean member) {
    }

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setFullName("Test " + id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private List<Caller> callers() {
        wideUsers.clear();
        wideUsers.add("mgr-wide");
        wideUsers.add("acc-wide");
        wideUsers.add("wh-scoped");   // a scope row on warehouse staff counts for nothing
        List<Caller> out = new ArrayList<>();
        out.add(new Caller("ADMIN", user("admin", "ADMIN"), INST, true, false, false, false, true, true));
        out.add(new Caller("M limited", user("mgr-limited", "COMMERCE_STORE_MANAGER"), INST, false, true, false, true,
                false, true));
        out.add(new Caller("M wide", user("mgr-wide", "COMMERCE_STORE_MANAGER"), INST, false, true, false, true, true,
                true));
        out.add(new Caller("Ac limited", user("acc-limited", "COMMERCE_ACCOUNTANT"), INST, false, false, true, true,
                false, true));
        out.add(new Caller("Ac wide", user("acc-wide", "COMMERCE_ACCOUNTANT"), INST, false, false, true, true, true,
                true));
        out.add(new Caller("W", user("wh", "COMMERCE_WAREHOUSE_STAFF"), INST, false, false, false, true, false, true));
        out.add(new Caller("W with scope row", user("wh-scoped", "COMMERCE_WAREHOUSE_STAFF"), INST, false, false, false,
                true, false, true));
        out.add(new Caller("C", user("ca", "COMMERCE_POS_CASHIER"), INST, false, false, false, true, false, true));
        out.add(new Caller("learner", user("learner", "STUDENT"), INST, false, false, false, false, false, true));
        out.add(new Caller("shopper", user("shopper"), INST, false, false, false, false, false, false));
        out.add(new Caller("other institute ADMIN", user("other-admin", "ADMIN"), OTHER, true, false, false, false,
                true, false));
        return out;
    }

    // ------------------------------------------------------------------ routes

    private enum Roles { ANY_STAFF, ACCOUNTS_STAFF, ADMIN_ONLY, PIN }

    private enum Scope { ANY_LOCATION, INSTITUTE_WIDE, UNLOCK }

    /** One route: who it lets in, and the call; the call answers normally when the guard passes. */
    private record Route(String name, Roles roles, Scope scope, Runnable call, Object[] behind) {
    }

    private CustomUserDetails current;

    private List<Route> routes() {
        List<Route> out = new ArrayList<>();
        out.add(new Route("GET /accounts/me", Roles.ANY_STAFF, Scope.ANY_LOCATION,
                () -> me.me(current, INST), new Object[0]));   // answers from the guard alone
        out.add(new Route("GET /accounts/encryption-status", Roles.ADMIN_ONLY, Scope.ANY_LOCATION,
                () -> me.encryptionStatus(current, INST), new Object[]{cipher, secretRepository}));
        out.add(new Route("GET /staff/scope", Roles.ADMIN_ONLY, Scope.ANY_LOCATION,
                () -> staff.scope(current, INST, "acc-limited"), new Object[]{staffService}));
        out.add(new Route("PUT /staff/scope", Roles.ADMIN_ONLY, Scope.ANY_LOCATION, () -> {
            CommerceStaffController.StaffScopeRequest request = new CommerceStaffController.StaffScopeRequest();
            request.setUserId("acc-limited");
            request.setAllLocations(true);
            staff.setScope(current, INST, request);
        }, new Object[]{staffService}));
        out.add(new Route("GET /staff/pin", Roles.PIN, Scope.ANY_LOCATION,
                () -> staff.pinStatus(current, INST), new Object[]{staffService}));
        out.add(new Route("PUT /staff/pin", Roles.PIN, Scope.ANY_LOCATION, () -> {
            StaffPinRequest request = new StaffPinRequest();
            request.setPin("905172");
            staff.setPin(current, INST, request);
        }, new Object[]{staffService}));
        out.add(new Route("GET /suppliers", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.list(current, INST, null, null, null, false, 0, 20), new Object[]{supplierService}));
        out.add(new Route("GET /suppliers/lookup", Roles.ANY_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.lookup(current, INST, "Test"), new Object[]{supplierService}));
        out.add(new Route("GET /suppliers/groups", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.groups(current, INST), new Object[]{supplierService}));
        out.add(new Route("POST /suppliers", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.create(current, INST, new SupplierRequest()), new Object[]{supplierService}));
        out.add(new Route("GET /suppliers/{id}", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.get(current, INST, "sup-1"), new Object[]{supplierService}));
        out.add(new Route("PUT /suppliers/{id}", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.update(current, INST, "sup-1", new SupplierRequest()), new Object[]{supplierService}));
        out.add(new Route("POST /suppliers/{id}/status", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> suppliers.setStatus(current, INST, "sup-1", new StatusRequest()), new Object[]{supplierService}));
        out.add(new Route("POST /suppliers/{id}/sensitive", Roles.ACCOUNTS_STAFF, Scope.INSTITUTE_WIDE, () -> {
            SensitiveRequest request = new SensitiveRequest();
            request.setField("pan");
            suppliers.sensitive(current, INST, "sup-1", request);
        }, new Object[]{supplierRepository, secretRepository, auditService}));
        out.add(new Route("GET /suppliers/{id}/statement", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> statements.statement(current, INST, "sup-1", null, null), new Object[]{statementService}));
        out.add(new Route("GET /account-heads", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> heads.list(current, INST, null, null), new Object[]{headService}));
        out.add(new Route("POST /account-heads", Roles.ACCOUNTS_STAFF, Scope.INSTITUTE_WIDE,
                () -> heads.create(current, INST, new HeadRequest()), new Object[]{headService}));
        out.add(new Route("PUT /account-heads/{id}", Roles.ACCOUNTS_STAFF, Scope.INSTITUTE_WIDE,
                () -> heads.update(current, INST, "head-1", new HeadRequest()), new Object[]{headService}));
        out.add(new Route("GET /period-lock", Roles.ACCOUNTS_STAFF, Scope.ANY_LOCATION,
                () -> periodLocks.read(current, INST), new Object[]{lockRepository}));
        out.add(new Route("GET /period-lock/preview", Roles.ACCOUNTS_STAFF, Scope.INSTITUTE_WIDE,
                () -> periodLocks.preview(current, INST, TODAY.minusDays(10)), new Object[]{contributor}));
        out.add(new Route("PUT /period-lock (lock)", Roles.ACCOUNTS_STAFF, Scope.INSTITUTE_WIDE, () -> {
            PeriodLockRequest request = new PeriodLockRequest();
            request.setClientRequestId("lock-key-0001");
            request.setLockedThrough(TODAY.minusDays(10));
            periodLocks.change(current, INST, request);
        }, new Object[]{requestGuard, lockRepository, auditService}));
        out.add(new Route("PUT /period-lock (unlock)", Roles.ACCOUNTS_STAFF, Scope.UNLOCK, () -> {
            PeriodLockRequest request = new PeriodLockRequest();
            request.setClientRequestId("unlock-key-0001");
            request.setLockedThrough(null);
            request.setReason("Reopen the month");
            request.setApproval(new Approval(current.getUserId(), "905172"));
            periodLocks.change(current, INST, request);
        }, new Object[]{approvalService, auditService}));   // the role check follows the read of the lock row
        return out;
    }

    /** What the guard must answer for this caller on this route, given the features granted. */
    private String expected(Route route, Caller caller, boolean accountsOn, boolean posOn) {
        if (!caller.member()) {
            return ACCESS_DENIED;
        }
        if (route.roles() == Roles.PIN) {
            // requireEither(POS, manager; ACCOUNTS, manager): the first side's refusal is the answer.
            boolean managerish = caller.admin() || caller.manager();
            if ((posOn || accountsOn) && managerish) {
                return PASS;
            }
            return posOn ? ROLE_NOT_ALLOWED : FEATURE_DISABLED;
        }
        if (!accountsOn) {
            return FEATURE_DISABLED;
        }
        boolean roleOk = caller.admin() || switch (route.roles()) {
            case ANY_STAFF -> caller.anyCommerceRole();
            case ACCOUNTS_STAFF -> caller.manager() || caller.accountant();
            default -> false;
        };
        if (!roleOk) {
            return ROLE_NOT_ALLOWED;
        }
        if (route.scope() != Scope.ANY_LOCATION && !caller.wide()) {
            return WIDE_REQUIRED;
        }
        if (route.scope() == Scope.UNLOCK && !caller.admin() && !caller.manager()) {
            return ROLE_NOT_ALLOWED;   // unlock is manager-only, after the institute-wide check
        }
        return PASS;
    }

    private static int invocations(Object[] mocks) {
        int n = 0;
        for (Object m : mocks) {
            n += mockingDetails(m).getInvocations().size();
        }
        return n;
    }

    private int runMatrix(boolean accountsOn, boolean posOn) {
        grantedFeatures.clear();
        if (accountsOn) {
            grantedFeatures.add(INST + "|" + CommerceFeature.ACCOUNTS.key());
        }
        if (posOn) {
            grantedFeatures.add(INST + "|" + CommerceFeature.POS.key());
        }
        int cells = 0;
        List<String> wrong = new ArrayList<>();
        for (Caller caller : callers()) {
            for (Route route : routes()) {
                MockHttpServletRequest request = new MockHttpServletRequest();
                request.addHeader("clientId", caller.header());
                RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
                current = caller.user();
                int before = invocations(route.behind());
                String want = expected(route, caller, accountsOn, posOn);
                String got;
                try {
                    route.call().run();
                    got = PASS;
                } catch (CommerceAccessDeniedException e) {
                    got = e.getCode();
                } catch (RuntimeException e) {
                    got = "OTHER " + e;
                }
                int reached = invocations(route.behind()) - before;
                if (!want.equals(got)) {
                    wrong.add(caller.name() + " on " + route.name() + ": expected " + want + ", got " + got);
                } else if (PASS.equals(want) && reached == 0 && route.behind().length > 0) {
                    wrong.add(caller.name() + " on " + route.name() + ": passed the guard but reached nothing");
                } else if (!PASS.equals(want) && reached > 0) {
                    wrong.add(caller.name() + " on " + route.name() + ": refused " + got + " but reached the service");
                }
                cells++;
            }
        }
        if (!wrong.isEmpty()) {
            fail(wrong.size() + " cells wrong (accounts " + accountsOn + ", POS " + posOn + "):\n"
                    + String.join("\n", wrong));
        }
        return cells;
    }

    // ------------------------------------------------------------------ tests

    @Test
    void everyRouteEveryCallerWithAccountsOn() {
        assertEquals(11 * 22, runMatrix(true, true));
    }

    @Test
    void everyRouteEveryCallerWithAccountsOff() {
        assertEquals(11 * 22, runMatrix(false, true));
    }

    @Test
    void pinRoutesOpenUnderAccountsWithoutPos() {
        assertEquals(11 * 22, runMatrix(true, false));
    }

    @Test
    void nothingOpensWithBothFeaturesOff() {
        assertEquals(11 * 22, runMatrix(false, false));
    }

    @Test
    void gate14TokensAreRefusedOnEveryRoute() {
        grantedFeatures.add(INST + "|" + CommerceFeature.ACCOUNTS.key());
        grantedFeatures.add(INST + "|" + CommerceFeature.POS.key());
        Map<String, String> outsiders = new LinkedHashMap<>();
        outsiders.put("learner", ROLE_NOT_ALLOWED);
        outsiders.put("shopper", ACCESS_DENIED);
        outsiders.put("other institute ADMIN", ACCESS_DENIED);
        int refused = 0;
        for (Caller caller : callers()) {
            String want = outsiders.get(caller.name());
            if (want == null) {
                continue;
            }
            for (Route route : routes()) {
                MockHttpServletRequest request = new MockHttpServletRequest();
                request.addHeader("clientId", caller.header());
                RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
                current = caller.user();
                try {
                    route.call().run();
                    fail(caller.name() + " passed " + route.name());
                } catch (CommerceAccessDeniedException e) {
                    assertEquals(want, e.getCode(), caller.name() + " on " + route.name());
                    refused++;
                }
            }
        }
        assertEquals(3 * 22, refused);
        // The other institute's ADMIN under its own header for its own institute: accounts is off there.
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", OTHER);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        CustomUserDetails otherAdmin = user("other-admin", "ADMIN");
        for (CommerceFeature feature : List.of(CommerceFeature.ACCOUNTS)) {
            CommerceAccessDeniedException e = org.junit.jupiter.api.Assertions.assertThrows(
                    CommerceAccessDeniedException.class, () -> me.me(otherAdmin, OTHER));
            assertEquals(FEATURE_DISABLED, e.getCode(), feature.key());
        }
        CommerceAccessDeniedException e = org.junit.jupiter.api.Assertions.assertThrows(
                CommerceAccessDeniedException.class, () -> suppliers.get(otherAdmin, OTHER, "sup-1"));
        assertEquals(FEATURE_DISABLED, e.getCode());
        assertTrue(mockingDetails(supplierService).getInvocations().isEmpty(), "no outsider reached the service");
    }

    @Test
    void theLocationBypassOfWideStaffIsForAccountsOnly() {
        grantedFeatures.add(INST + "|" + CommerceFeature.ACCOUNTS.key());
        grantedFeatures.add(INST + "|" + CommerceFeature.INVENTORY.key());
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(anyString(), anyString(), anyString()))
                .thenReturn(false);
        wideUsers.add("acc-wide");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        CustomUserDetails wideAc = user("acc-wide", "COMMERCE_ACCOUNTANT");
        CustomUserDetails limitedAc = user("acc-limited", "COMMERCE_ACCOUNTANT");
        guard.require(wideAc, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF, "loc-9");
        CommerceAccessDeniedException stock = org.junit.jupiter.api.Assertions.assertThrows(
                CommerceAccessDeniedException.class,
                () -> guard.require(wideAc, INST, CommerceFeature.INVENTORY, AccountsAccess.ACCOUNTS_STAFF, "loc-9"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, stock.getCode());
        CommerceAccessDeniedException limited = org.junit.jupiter.api.Assertions.assertThrows(
                CommerceAccessDeniedException.class,
                () -> guard.require(limitedAc, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF, "loc-9"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, limited.getCode());
    }
}
