package vacademy.io.admin_core_service.features.credits.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackAdminDTO;
import vacademy.io.admin_core_service.features.credits.entity.CreditPack;
import vacademy.io.admin_core_service.features.credits.entity.CreditPackPrice;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackPriceRepository;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CreditPackAdminServiceTest {

    @Mock CreditPackRepository packs;
    @Mock CreditPackPriceRepository prices;
    @InjectMocks CreditPackAdminService service;

    private CreditPack pack;
    private CreditPackPrice inr;

    @BeforeEach
    void setUp() {
        pack = new CreditPack();
        pack.setId("p1");
        pack.setCredits(new BigDecimal("500"));
        pack.setIsActive(true);
        inr = new CreditPackPrice();
        inr.setCurrency("INR");
        inr.setAmountMinor(46500L);
        lenient().when(packs.findById("p1")).thenReturn(Optional.of(pack));
        lenient().when(packs.save(any())).thenAnswer(i -> i.getArgument(0));
        lenient().when(prices.findByPackIdAndIsActiveTrue("p1")).thenReturn(List.of(inr));
    }

    private static CreditPackAdminDTO body(BigDecimal credits, String currency, Long minor) {
        return CreditPackAdminDTO.builder().credits(credits)
                .prices(currency == null ? null : List.of(new CreditPackAdminDTO.Price(currency, minor))).build();
    }

    @Test
    void changesCreditsPriceAndSale() {
        when(prices.findByPackIdAndCurrencyAndIsActiveTrue("p1", "INR")).thenReturn(Optional.of(inr));
        CreditPackAdminDTO in = body(new BigDecimal("600"), "inr", 55050L);
        in.setIsActive(false);
        CreditPackAdminDTO out = service.update("p1", in);
        assertEquals(new BigDecimal("600"), out.getCredits());
        assertEquals(55050L, inr.getAmountMinor());
        assertFalse(pack.getIsActive());
        verify(prices).save(inr);
    }

    @Test
    void aFieldLeftOutStaysAsItIs() {
        service.update("p1", new CreditPackAdminDTO());
        assertEquals(new BigDecimal("500"), pack.getCredits());
        assertTrue(pack.getIsActive());
        assertEquals(46500L, inr.getAmountMinor());
    }

    @Test
    void refusesAZeroPriceAndZeroCreditsAndAnUnknownCurrency() {
        assertThrows(VacademyException.class, () -> service.update("p1", body(null, "INR", 0L)));
        assertThrows(VacademyException.class, () -> service.update("p1", body(BigDecimal.ZERO, null, null)));
        when(prices.findByPackIdAndCurrencyAndIsActiveTrue("p1", "EUR")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.update("p1", body(null, "EUR", 100L)));
        assertEquals(46500L, inr.getAmountMinor());
    }

    @Test
    void anUnknownPackIsNotFound() {
        when(packs.findById("nope")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.update("nope", new CreditPackAdminDTO()));
    }
}
