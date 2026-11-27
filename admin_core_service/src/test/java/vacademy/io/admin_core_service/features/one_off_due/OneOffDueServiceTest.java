package vacademy.io.admin_core_service.features.one_off_due;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.AdminCreateInvoiceRequestDTO;
import vacademy.io.admin_core_service.features.invoice.dto.AdminInvoicePaymentLinkResponseDTO;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.one_off_due.entity.OneOffDue;
import vacademy.io.admin_core_service.features.one_off_due.repository.OneOffDueRepository;
import vacademy.io.admin_core_service.features.one_off_due.service.OneOffDueService;
import vacademy.io.admin_core_service.features.one_off_due.service.OneOffDueSettings;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OneOffDueServiceTest {

    private static final String INST = "inst-1";
    private static final String USER = "user-1";

    @Mock private EntityManager em;
    @Mock private OneOffDueRepository repository;
    @Mock private OneOffDueSettings settings;
    @Mock private InvoiceService invoiceService;
    @Mock private InvoiceRepository invoiceRepository;
    @Mock private PaymentSettingService paymentSettingService;
    @Mock private Query query;

    @InjectMocks private OneOffDueService service;

    @BeforeEach
    void setUp() {
        when(settings.isEnabled(INST)).thenReturn(true);
        when(paymentSettingService.getDefaultCurrency(INST)).thenReturn("INR");
        when(em.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter(anyString(), any())).thenReturn(query);
        when(query.getResultList()).thenReturn(List.of(1));
        when(repository.save(any())).thenAnswer(inv -> {
            OneOffDue d = inv.getArgument(0);
            if (d.getId() == null) d.setId("due-1");
            return d;
        });
        when(invoiceService.createAdminInvoices(any(), any(), anyBoolean())).thenReturn(List.of(
                AdminInvoicePaymentLinkResponseDTO.builder().invoiceId("inv-1").build()));
    }

    private String create(BigDecimal amount) {
        return service.create(INST, USER, null, amount, LocalDate.now().plusDays(3), "Bridge class",
                "after a long break", "REENTRY_BRIDGE", "reentry-9", null);
    }

    @Test
    void refusedWhileTheSwitchIsOff() {
        when(settings.isEnabled(INST)).thenReturn(false);
        VacademyException e = assertThrows(VacademyException.class, () -> create(BigDecimal.TEN));
        assertTrue(e.getMessage().contains("switched off"));
        verifyNoInteractions(invoiceService);
    }

    @Test
    void refusesAnAmountOfZero() {
        assertThrows(VacademyException.class, () -> create(BigDecimal.ZERO));
        verifyNoInteractions(invoiceService);
    }

    @Test
    void refusesALearnerFromAnotherInstitute() {
        when(query.getResultList()).thenReturn(List.of());
        VacademyException e = assertThrows(VacademyException.class, () -> create(BigDecimal.TEN));
        assertTrue(e.getMessage().contains("not enrolled"));
        verifyNoInteractions(invoiceService);
    }

    @Test
    void raisesASilentUntaxedInvoiceAndSavesTheRow() {
        String id = create(new BigDecimal("1500"));
        assertEquals("due-1", id);

        ArgumentCaptor<AdminCreateInvoiceRequestDTO> req = ArgumentCaptor.forClass(AdminCreateInvoiceRequestDTO.class);
        verify(invoiceService).createAdminInvoices(req.capture(), isNull(), eq(false));
        assertEquals(List.of(USER), req.getValue().getUserIds());
        assertEquals(Boolean.FALSE, req.getValue().getTaxEnabled());
        assertEquals("Bridge class", req.getValue().getLineItems().get(0).getDescription());
        assertEquals(new BigDecimal("1500.00"), req.getValue().getLineItems().get(0).getUnitPrice());

        ArgumentCaptor<OneOffDue> row = ArgumentCaptor.forClass(OneOffDue.class);
        verify(repository).save(row.capture());
        assertEquals("inv-1", row.getValue().getInvoiceId());
        assertEquals("REENTRY_BRIDGE", row.getValue().getSourceType());
        assertEquals("reentry-9", row.getValue().getSourceId());
        assertEquals("after a long break", row.getValue().getNote());
    }

    @Test
    void cannotCancelAPaidCharge() {
        OneOffDue due = new OneOffDue();
        due.setId("due-1");
        due.setInstituteId(INST);
        due.setInvoiceId("inv-1");
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setStatus("PAID");
        when(repository.findById("due-1")).thenReturn(Optional.of(due));
        when(invoiceRepository.findById("inv-1")).thenReturn(Optional.of(invoice));

        assertThrows(VacademyException.class, () -> service.cancel("due-1", INST, null, null));
        verify(invoiceService, never()).rejectInvoice(any(), any(), any(), any());
    }

    @Test
    void cannotCancelAnotherInstitutesCharge() {
        OneOffDue due = new OneOffDue();
        due.setId("due-1");
        due.setInstituteId("other");
        when(repository.findById("due-1")).thenReturn(Optional.of(due));
        assertThrows(VacademyException.class, () -> service.cancel("due-1", INST, null, null));
    }

    @Test
    void learnerListIsEmptyWhileTheSwitchIsOff() {
        when(settings.isEnabled(INST)).thenReturn(false);
        assertTrue(service.forLearner(USER, INST).getDues().isEmpty());
        verifyNoInteractions(repository);
    }
}
