package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** A register's own series: the register must be of the institute and of the series' location. */
class CommerceDocumentSeriesServiceRegisterTest {

    private static final String INST = "inst-1";
    private CommerceDocumentSeriesRepository seriesRepository;
    private PosRegisterRepository registers;
    private CommerceDocumentSeriesService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        seriesRepository = mock(CommerceDocumentSeriesRepository.class);
        InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
        CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
        CommerceSellerLookup sellerLookup = mock(CommerceSellerLookup.class);
        DocumentClock clock = mock(DocumentClock.class);
        when(clock.today(INST)).thenReturn(LocalDate.of(2026, 11, 18));
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder().fyStartMonth(4).build());
        when(sellerLookup.locationBelongsToInstitute(anyString(), anyString())).thenReturn(true);
        when(seriesRepository.findByInstituteIdAndPrefixAndFinancialYear(anyString(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(seriesRepository.save(any(CommerceDocumentSeries.class))).thenAnswer(inv -> {
            CommerceDocumentSeries s = inv.getArgument(0);
            s.setId("series-1");
            return s;
        });
        service = new CommerceDocumentSeriesService(seriesRepository, invoiceRepository, taxSettings, sellerLookup,
                clock, mock(CommerceAuditService.class));
        registers = mock(PosRegisterRepository.class);
        ObjectProvider<PosRegisterRepository> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registers);
        service.setRegisterRepository(provider);

        PosRegister register = new PosRegister();
        register.setId("reg-1");
        register.setInstituteId(INST);
        register.setLocationId("loc-1");
        when(registers.findByInstituteIdAndId(INST, "reg-1")).thenReturn(Optional.of(register));
        when(registers.findByInstituteIdAndId(INST, "reg-other-institute")).thenReturn(Optional.empty());
    }

    private static DocumentSeriesDTO.DocumentSeriesDTOBuilder series(String location, String register) {
        return DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("SYSTEM").channel("POS").prefix("R1")
                .locationId(location).registerId(register);
    }

    @Test
    void aRegisterOfTheInstituteAndLocationIsAccepted() {
        DocumentSeriesDTO created = service.create(INST, "user-1", series("loc-1", "reg-1").build());
        assertEquals("reg-1", created.getRegisterId());
        assertEquals("POS", created.getChannel());
    }

    @Test
    void anotherInstitutesRegisterIsRefused() {
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.create(INST, "user-1", series("loc-1", "reg-other-institute").build()));
        assertTrue(e.getMessage().startsWith("VALIDATION: register_id is not a register of this location"));
    }

    @Test
    void aRegisterOfAnotherLocationIsRefused() {
        assertThrows(InvalidRequestException.class,
                () -> service.create(INST, "user-1", series("loc-2", "reg-1").build()));
        assertThrows(InvalidRequestException.class,
                () -> service.create(INST, "user-1", series(null, "reg-1").build()));
    }

    @Test
    void aBillBookOrAnOnlineChannelCannotBeARegisterSeries() {
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "user-1",
                series("loc-1", "reg-1").kind("MANUAL_BOOK").bookFrom(1L).bookTo(100L).build()));
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "user-1",
                series("loc-1", "reg-1").channel("ONLINE").build()));
        DocumentSeriesDTO all = service.create(INST, "user-1", series("loc-1", "reg-1").channel("ALL").build());
        assertEquals("ALL", all.getChannel());
    }

    @Test
    void aSeriesWithoutARegisterIsAsBefore() {
        DocumentSeriesDTO created = service.create(INST, "user-1", series("loc-1", null).build());
        assertNull(created.getRegisterId());
    }
}
