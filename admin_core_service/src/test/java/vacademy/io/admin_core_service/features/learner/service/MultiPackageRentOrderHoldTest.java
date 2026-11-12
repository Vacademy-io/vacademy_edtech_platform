package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.common.dto.CustomFieldValueDTO;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A v2 rent order holds what the v1 rent request held: one RENT_PREFERENCE hold per picked book,
 * and no PURCHASE hold on the membership (its max_seats is books per period) or a charge line.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MultiPackageRentOrderHoldTest {

    private static final String INSTITUTE = "inst-1";

    @Mock private StockHoldService stockHoldService;
    @InjectMocks private MultiPackageLearnerEnrollService service;

    private static final Map<String, String> TYPES = Map.of(
            "ps-mem", "MEMBERSHIP",
            "ps-dep", "SECURITY_DEPOSIT",
            "ps-ship", "DELIVERY_CHARGE",
            "ps-book", "COURSE");

    private static LearnerPackageSessionEnrollmentItemDTO line(String packageSessionId, int quantity, String... picks) {
        LearnerPackageSessionEnrollmentItemDTO item = new LearnerPackageSessionEnrollmentItemDTO();
        item.setPackageSessionId(packageSessionId);
        item.setPlanId("plan-" + packageSessionId);
        item.setRequestedQuantity(quantity);
        if (picks.length > 0) {
            item.setRequestedBookPackageSessionIds(new ArrayList<>(Arrays.asList(picks)));
        }
        return item;
    }

    private static StockHold hold(String packageSessionId, StockHoldKind kind) {
        StockHold hold = new StockHold();
        hold.setId("hold-" + packageSessionId);
        hold.setPackageSessionId(packageSessionId);
        hold.setKind(kind.name());
        return hold;
    }

    @Test
    void aRentOrderHoldsThePicksUnderTheMembershipLineAndNothingElse() {
        when(stockHoldService.hold(eq(INSTITUTE), anyMap(), eq(StockHoldKind.RENT_PREFERENCE))).thenReturn(List.of(
                hold("book-1", StockHoldKind.RENT_PREFERENCE), hold("book-2", StockHoldKind.RENT_PREFERENCE)));

        Map<String, List<StockHold>> holds = service.holdOrderStock(INSTITUTE, List.of(
                line("ps-mem", 1, "book-1", "book-2", "book-1", " ", null),
                line("ps-dep", 1)), TYPES);

        Map<String, Integer> onePerBook = new LinkedHashMap<>();
        onePerBook.put("book-1", 1);
        onePerBook.put("book-2", 1);
        verify(stockHoldService).hold(INSTITUTE, onePerBook, StockHoldKind.RENT_PREFERENCE);
        verify(stockHoldService, never()).hold(any(), anyMap(), eq(StockHoldKind.PURCHASE));
        assertEquals(List.of("hold-book-1", "hold-book-2"),
                holds.get("ps-mem").stream().map(StockHold::getId).toList());
        assertNull(holds.get("ps-dep"));
    }

    @Test
    void aBuyOrderHoldsItsCopiesButNotItsShippingLine() {
        when(stockHoldService.hold(eq(INSTITUTE), anyMap(), eq(StockHoldKind.PURCHASE)))
                .thenReturn(List.of(hold("ps-book", StockHoldKind.PURCHASE)));

        Map<String, List<StockHold>> holds = service.holdOrderStock(INSTITUTE,
                List.of(line("ps-book", 3), line("ps-ship", 1)), TYPES);

        verify(stockHoldService).hold(INSTITUTE, Map.of("ps-book", 3), StockHoldKind.PURCHASE);
        verify(stockHoldService, never()).hold(any(), anyMap(), eq(StockHoldKind.RENT_PREFERENCE));
        assertEquals(1, holds.get("ps-book").size());
    }

    @Test
    void aPickTheOrderAlsoEnrollsIsNotHeldTwice() {
        when(stockHoldService.hold(eq(INSTITUTE), anyMap(), eq(StockHoldKind.PURCHASE))).thenReturn(List.of());

        service.holdOrderStock(INSTITUTE, List.of(line("ps-mem", 1, "ps-book"), line("ps-book", 1)), TYPES);

        verify(stockHoldService).hold(INSTITUTE, Map.of("ps-book", 1), StockHoldKind.PURCHASE);
        verify(stockHoldService, never()).hold(any(), anyMap(), eq(StockHoldKind.RENT_PREFERENCE));
    }

    @Test
    void theMembershipLineCarriesItsPicksAndBooksPreferenceLikeTheV1RentRequest() {
        LearnerPackageSessionEnrollmentItemDTO membership = line("ps-mem", 1, "book-1", "book-2");
        CustomFieldValueDTO booksPreference = new CustomFieldValueDTO();
        booksPreference.setCustomFieldId("books-preference");
        booksPreference.setValue("Book One, Book Two");
        membership.setCustomFieldValues(List.of(booksPreference));
        MultiPackageLearnerEnrollRequestDTO request = new MultiPackageLearnerEnrollRequestDTO();
        request.setInstituteId(INSTITUTE);

        LearnerEnrollRequestDTO legacy = service.mapToLegacyDTO(request, membership, 499.0);

        assertEquals(List.of("book-1", "book-2"),
                legacy.getLearnerPackageSessionEnroll().getRequestedBookPackageSessionIds());
        assertEquals(List.of("ps-mem"), legacy.getLearnerPackageSessionEnroll().getPackageSessionIds());
        assertEquals(List.of(booksPreference), legacy.getLearnerPackageSessionEnroll().getCustomFieldValues());
    }
}
