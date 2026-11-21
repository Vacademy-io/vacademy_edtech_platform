package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosCashMovementRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosReadRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The register's open session (who sees its money) and the session list (the cashier's name, G2). */
class PosSessionReadsTest {

    private static final String INST = "inst-1";

    private final PosAccess access = mock(PosAccess.class);
    private final PosSessionRepository sessions = mock(PosSessionRepository.class);
    private final PosRegisterRepository registers = mock(PosRegisterRepository.class);
    private final PosCashMovementRepository movements = mock(PosCashMovementRepository.class);
    private final PosReadRepository reads = mock(PosReadRepository.class);
    private final StockLocationRepository locations = mock(StockLocationRepository.class);
    private final CommerceStaffLocationRepository staff = mock(CommerceStaffLocationRepository.class);
    private final PosUserNames names = mock(PosUserNames.class);
    private PosSessionService service;
    private final PosSession open = new PosSession();
    private final PosRegister register = new PosRegister();

    @BeforeEach
    void setUp() {
        service = new PosSessionService(access, sessions, registers, movements, reads, locations, staff,
                mock(PosSettingsService.class), mock(CommerceApprovalService.class), mock(CommerceAuditService.class),
                mock(CommerceRequestGuard.class), names, mock(PlatformTransactionManager.class));
        register.setId("r-1");
        register.setCode("R1");
        register.setName("Front");
        register.setLocationId("loc-1");
        open.setId("s-1");
        open.setRegisterId("r-1");
        open.setLocationId("loc-1");
        open.setCashierUserId("cashier-1");
        open.setStatus("OPEN");
        open.setOpenedAt(new Date());
        open.setOpeningCash(new BigDecimal("500.00"));
        lenient().when(access.register(any(), eq(INST), eq("r-1"), eq(PosAccess.TILL))).thenReturn(register);
        lenient().when(sessions.findOpenByRegister(INST, "r-1")).thenReturn(Optional.of(open));
        lenient().when(sessions.findByInstituteIdAndId(INST, "s-1")).thenReturn(Optional.of(open));
        lenient().when(registers.findByInstituteIdAndId(INST, "r-1")).thenReturn(Optional.of(register));
        lenient().when(locations.findByInstituteIdAndId(anyString(), anyString())).thenReturn(Optional.empty());
        lenient().when(movements.findByInstituteIdAndSessionIdOrderByCreatedAtAscIdAsc(INST, "s-1"))
                .thenReturn(new ArrayList<>());
        lenient().when(reads.sessionOrders(INST, "s-1")).thenReturn(List.of());
        lenient().when(reads.invoicesOf(eq(INST), anyCollection())).thenReturn(List.of());
        lenient().when(reads.sessionTenders(INST, "s-1")).thenReturn(List.of());
        lenient().when(reads.sessionRefunds(INST, "s-1")).thenReturn(List.of());
        lenient().when(reads.sessionMovements(INST, "s-1")).thenReturn(List.of());
        lenient().when(reads.taxByRate(eq(INST), anyCollection())).thenReturn(List.of());
        lenient().when(reads.sessionReturns(INST, "s-1")).thenReturn(new PosDtos.ReturnsTotal(0, BigDecimal.ZERO));
        lenient().when(names.names(anyCollection())).thenReturn(Map.of("cashier-1", "First Cashier"));
    }

    private static CustomUserDetails user(String id, String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        lenient().when(user.getUserId()).thenReturn(id);
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        lenient().when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    @Test
    void s3_onlyTheSessionsCashierOrAManagerSeesItsMoneyThroughTheRegister() {
        PosDtos.SessionView own = service.current(user("cashier-1", "COMMERCE_POS_CASHIER"), INST, "r-1").session();
        assertNotNull(own.summary(), "the cashier's own drawer");
        assertEquals(0, new BigDecimal("500.00").compareTo(own.openingCash()));
        PosDtos.SessionView managers = service.current(user("manager-1", "COMMERCE_STORE_MANAGER"), INST, "r-1")
                .session();
        assertNotNull(managers.summary());

        PosDtos.SessionView other = service.current(user("cashier-2", "COMMERCE_POS_CASHIER"), INST, "r-1")
                .session();
        assertEquals("s-1", other.id());
        assertEquals("cashier-1", other.cashierUserId());
        assertEquals("First Cashier", other.cashierName());
        assertNull(other.summary(), "no takings, no expected cash");
        assertNull(other.openingCash());
        assertEquals(List.of(), other.cashMovements());
    }

    @Test
    void g2_theSessionRowsCarryTheCashiersNameFromOneBatchRead() {
        PosDtos.SessionRow a = new PosDtos.SessionRow("s-1", "OPEN", "R1", "Main", "cashier-1", new Date(), null, 2,
                new BigDecimal("900.00"), null, null);
        PosDtos.SessionRow b = new PosDtos.SessionRow("s-2", "CLOSED", "R1", "Main", "cashier-9", new Date(),
                new Date(), 1, new BigDecimal("50.00"), BigDecimal.ZERO, null);
        when(reads.sessions(eq(INST), any(), anyInt(), anyInt())).thenReturn(new PosReadRepository.SessionPage(
                List.of(a, b), 2));
        PosDtos.SessionsPage page = service.list(user("admin-1", "ADMIN"), INST, null, null, null, null, null, 0,
                50);
        assertEquals("First Cashier", page.sessions().get(0).cashierName());
        assertNull(page.sessions().get(1).cashierName(), "a name the account service did not answer stays empty");
        verify(names, times(1)).names(List.of("cashier-1", "cashier-9"));
    }
}
