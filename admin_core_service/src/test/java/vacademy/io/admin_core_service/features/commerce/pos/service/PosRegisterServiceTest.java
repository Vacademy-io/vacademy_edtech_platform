package vacademy.io.admin_core_service.features.commerce.pos.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Registers: the code and prefix rules, a location without a counter refused, the register's own
 * SYSTEM series created for each tax mode (POS channel, the register and its location), and no
 * register switched off while a session is open.
 */
class PosRegisterServiceTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final String KEY = "reg-key-0001";

    private final PosAccess access = mock(PosAccess.class);
    private final PosRegisterRepository registerRepository = mock(PosRegisterRepository.class);
    private final PosSessionRepository sessionRepository = mock(PosSessionRepository.class);
    private final StockLocationRepository locationRepository = mock(StockLocationRepository.class);
    private final CommerceStaffLocationRepository staffLocations = mock(CommerceStaffLocationRepository.class);
    private final CommerceDocumentSeriesService seriesService = mock(CommerceDocumentSeriesService.class);
    private final CommerceDocumentSeriesRepository seriesRepository = mock(CommerceDocumentSeriesRepository.class);
    private final CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
    private final CommerceSellerLookup sellerLookup = mock(CommerceSellerLookup.class);
    private final DocumentClock clock = mock(DocumentClock.class);
    private final CommerceAuditService audit = mock(CommerceAuditService.class);
    private final CommerceRequestGuard guard = mock(CommerceRequestGuard.class);
    private final PosUserNames userNames = mock(PosUserNames.class);
    private PosRegisterService service;

    private final StockLocation location = new StockLocation();
    private final CustomUserDetails manager = mock(CustomUserDetails.class);

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        service = new PosRegisterService(access, registerRepository, sessionRepository, locationRepository,
                staffLocations, seriesService, seriesRepository, taxSettings, sellerLookup, clock, audit, guard,
                userNames, mock(PlatformTransactionManager.class));
        location.setId(LOC);
        location.setInstituteId(INST);
        location.setName("Front shop");
        location.setPosEnabled(true);
        location.setStatus("ACTIVE");
        lenient().when(manager.getUserId()).thenReturn("manager-1");
        lenient().when(locationRepository.findByInstituteIdAndId(INST, LOC)).thenReturn(Optional.of(location));
        lenient().when(clock.today(INST)).thenReturn(LocalDate.of(2026, 11, 18));
        lenient().when(taxSettings.context(INST)).thenReturn(tax(TaxMode.REGULAR));
        lenient().when(registerRepository.saveAndFlush(any(PosRegister.class))).thenAnswer(call -> {
            PosRegister r = call.getArgument(0);
            if (r.getId() == null) {
                r.setId("reg-1");
            }
            return r;
        });
        lenient().when(seriesRepository.findByInstituteIdAndPrefixAndFinancialYear(anyString(), anyString(),
                anyString())).thenReturn(Optional.empty());
        lenient().when(seriesService.create(eq(INST), anyString(), any(DocumentSeriesDTO.class))).thenAnswer(call -> {
            DocumentSeriesDTO asked = call.getArgument(2);
            asked.setId("series-1");
            return asked;
        });
        lenient().when(sessionRepository.findOpenByRegisters(eq(INST), anyCollection())).thenReturn(List.of());
        lenient().when(seriesRepository.findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(anyString(),
                anyString(), anyString(), anyString())).thenReturn(List.of());
        lenient().when(userNames.names(anyCollection())).thenReturn(Map.of());
        lenient().when(guard.run(any(CommerceRequestGuard.Key.class), any(Supplier.class), any(Supplier.class)))
                .thenAnswer(call -> new CommerceRequestGuard.Outcome<>(((Supplier<Object>) call.getArgument(1)).get(),
                        false));
    }

    private static CommerceTaxContext tax(TaxMode mode) {
        return CommerceTaxContext.builder().configured(true).mode(mode).fyStartMonth(4).build();
    }

    private static PosDtos.RegisterCreateRequest create(String code, String prefix) {
        return new PosDtos.RegisterCreateRequest(KEY, LOC, code, "Front counter", prefix, null);
    }

    // ------------------------------------------------------------------ code and prefix rules

    @Test
    void theCodeIsUpperCasedAndOnlyLettersDigitsAndHyphensUpTo16() {
        assertEquals("R1-FRONT", PosRegisterService.validate(create(" r1-front ", null)).code());
        for (String bad : new String[]{"", "R 1", "R_1", "R1/2", "ABCDEFGHIJKLMNOPQ"}) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> PosRegisterService.validate(create(bad, null)), bad);
            assertTrue(e.getMessage().startsWith("VALIDATION"), e.getMessage());
        }
        assertEquals("ABCDEFGHIJKLMNOP", PosRegisterService.validate(create("abcdefghijklmnop", null)).code());
    }

    @Test
    void thePrefixFollowsTheSeriesRuleAndTheNextValueComesWithIt() {
        assertEquals("R1/A", PosRegisterService.validate(create("R1", "r1/a")).prefix());
        for (String bad : new String[]{"/R1", "-R", "TOOLONG7", "R 1"}) {
            assertThrows(InvalidRequestException.class, () -> PosRegisterService.validate(create("R1", bad)), bad);
        }
        assertThrows(InvalidRequestException.class, () -> PosRegisterService.validate(
                new PosDtos.RegisterCreateRequest(KEY, LOC, "R1", "Front", null, 5L)));
        assertThrows(InvalidRequestException.class, () -> PosRegisterService.validate(
                new PosDtos.RegisterCreateRequest(KEY, LOC, "R1", "Front", "R1", 0L)));
        assertThrows(InvalidRequestException.class, () -> PosRegisterService.validate(
                new PosDtos.RegisterCreateRequest(KEY, LOC, "R1", " ", null, null)));
    }

    // ------------------------------------------------------------------ create

    @Test
    void aLocationWithoutACounterIsRefused() {
        location.setPosEnabled(false);
        ConflictException off = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                create("R1", null)));
        assertTrue(off.getMessage().startsWith("LOCATION_NOT_POS"), off.getMessage());
        location.setPosEnabled(true);
        location.setStatus("INACTIVE");
        ConflictException inactive = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                create("R1", null)));
        assertTrue(inactive.getMessage().startsWith("LOCATION_NOT_POS"), inactive.getMessage());
        verify(registerRepository, never()).saveAndFlush(any());
        verify(access, org.mockito.Mockito.times(2)).requireAt(manager, INST, PosAccess.MANAGER, LOC);
    }

    @Test
    void aTakenCodeIsRefused() {
        when(registerRepository.existsByInstituteIdAndCode(INST, "R1")).thenReturn(true);
        ConflictException taken = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                create("r1", null)));
        assertTrue(taken.getMessage().startsWith("REGISTER_CODE_TAKEN"), taken.getMessage());
    }

    @Test
    void theRegisterSeriesFollowsTheTaxModeOfTheInstitute() {
        Map<TaxMode, String> expected = Map.of(TaxMode.REGULAR, "TAX_INVOICE", TaxMode.COMPOSITION, "BILL_OF_SUPPLY",
                TaxMode.UNREGISTERED, "INVOICE");
        for (Map.Entry<TaxMode, String> mode : expected.entrySet()) {
            org.mockito.Mockito.clearInvocations(seriesService);
            when(taxSettings.context(INST)).thenReturn(tax(mode.getKey()));
            service.create(manager, INST, create("R1", "R1"));
            ArgumentCaptor<DocumentSeriesDTO> asked = ArgumentCaptor.forClass(DocumentSeriesDTO.class);
            verify(seriesService).create(eq(INST), eq("manager-1"), asked.capture());
            DocumentSeriesDTO series = asked.getValue();
            assertEquals(mode.getValue(), series.getDocumentType(), mode.getKey().name());
            assertEquals("SYSTEM", series.getKind());
            assertEquals("POS", series.getChannel());
            assertEquals("R1", series.getPrefix());
            assertEquals("2026-27", series.getFinancialYear());
            assertEquals(LOC, series.getLocationId());
            assertEquals("reg-1", series.getRegisterId());
            assertEquals(1L, series.getNextValue());
        }
    }

    @Test
    void noPrefixMakesNoSeriesAndATakenPrefixIsRefused() {
        service.create(manager, INST, create("R1", null));
        verify(seriesService, never()).create(anyString(), anyString(), any());
        when(seriesRepository.findByInstituteIdAndPrefixAndFinancialYear(INST, "R1", "2026-27"))
                .thenReturn(Optional.of(new CommerceDocumentSeries()));
        ConflictException used = assertThrows(ConflictException.class, () -> service.create(manager, INST,
                create("R2", "R1")));
        assertTrue(used.getMessage().startsWith("SERIES_PREFIX_IN_USE"), used.getMessage());
    }

    @Test
    void aRegisterWithoutItsOwnSeriesIsWarned() {
        PosDtos.RegisterView view = service.create(manager, INST, create("R1", null)).register();
        assertTrue(view.setupWarnings().contains(PosRegisterService.WARNING_NO_REGISTER_SERIES));
        assertTrue(view.setupWarnings().contains(PosRegisterService.WARNING_NO_CREDIT_NOTE_SERIES));
    }

    // ------------------------------------------------------------------ update

    @Test
    void aRegisterIsNotSwitchedOffWhileASessionIsOpen() {
        PosRegister register = new PosRegister();
        register.setId("reg-1");
        register.setInstituteId(INST);
        register.setLocationId(LOC);
        register.setCode("R1");
        register.setName("Front");
        register.setStatus("ACTIVE");
        when(access.register(manager, INST, "reg-1", PosAccess.MANAGER)).thenReturn(register);
        when(registerRepository.findByInstituteIdAndId(INST, "reg-1")).thenReturn(Optional.of(register));
        when(sessionRepository.findOpenByRegister(INST, "reg-1")).thenReturn(Optional.of(new PosSession()));
        ConflictException open = assertThrows(ConflictException.class, () -> service.update(manager, INST, "reg-1",
                new PosDtos.RegisterUpdateRequest(KEY, null, "INACTIVE")));
        assertTrue(open.getMessage().startsWith("REGISTER_HAS_OPEN_SESSION"), open.getMessage());
        assertEquals("ACTIVE", register.getStatus());
        // A rename is fine while open.
        assertEquals("Back", service.update(manager, INST, "reg-1",
                new PosDtos.RegisterUpdateRequest(KEY, "Back", null)).register().name());
        when(sessionRepository.findOpenByRegister(INST, "reg-1")).thenReturn(Optional.empty());
        assertEquals("INACTIVE", service.update(manager, INST, "reg-1",
                new PosDtos.RegisterUpdateRequest(KEY, null, "inactive")).register().status());
        assertThrows(InvalidRequestException.class, () -> service.update(manager, INST, "reg-1",
                new PosDtos.RegisterUpdateRequest(KEY, null, "PAUSED")));
    }
}
