package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionFilterDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The Settings page creates AND edits a payment option through the same POST. The
 * two cases must behave differently: a create stamps the caller as creator and mints
 * a fresh id, an edit updates the stored row (and its plans) in place. Merging a
 * rebuilt entity did neither cleanly — it left the old plan ACTIVE beside the resent
 * one and dropped the creator — which is what these tests pin down.
 */
@ExtendWith(MockitoExtension.class)
class PaymentOptionServiceSaveTest {

    @Mock
    private PaymentOptionRepository paymentOptionRepository;
    @Mock
    private PaymentPlanService paymentPlanService;
    @Mock
    private PaymentPlanRepository paymentPlanRepository;
    @Mock
    private AuthService authService;

    @InjectMocks
    private PaymentOptionService service;

    private static CustomUserDetails user(String userId) {
        CustomUserDetails user = new CustomUserDetails();
        ReflectionTestUtils.setField(user, "userId", userId);
        return user;
    }

    @Test
    @DisplayName("create: client placeholder ids are dropped and the caller is stamped as creator")
    void createStampsCreatorAndClearsPlaceholderIds() {
        PaymentOptionDTO dto = PaymentOptionDTO.builder()
                .id("plan_1757600000000") // what the invite flow sends for a brand-new plan
                .name("Annual")
                .type("ONE_TIME")
                .status("ACTIVE")
                .paymentPlans(List.of(PaymentPlanDTO.builder().id("plan_x").name("Annual").status("ACTIVE").build()))
                .build();
        when(paymentOptionRepository.existsById("plan_1757600000000")).thenReturn(false);
        when(paymentOptionRepository.save(any(PaymentOption.class))).thenAnswer(inv -> {
            PaymentOption saved = inv.getArgument(0);
            saved.setId("generated-uuid");
            return saved;
        });

        PaymentOptionDTO result = service.savePaymentOption(dto, user("admin-1"));

        ArgumentCaptor<PaymentOption> captor = ArgumentCaptor.forClass(PaymentOption.class);
        verify(paymentOptionRepository).save(captor.capture());
        PaymentOption persisted = captor.getValue();
        assertEquals("admin-1", persisted.getCreatedByUserId());
        assertNull(persisted.getPaymentPlans().get(0).getId(), "plan placeholder id must not be persisted");
        assertEquals("generated-uuid", result.getId());
        assertEquals("admin-1", result.getCreatedByUserId());
        verify(paymentOptionRepository, never()).findById(anyString());
    }

    @Test
    @DisplayName("create without a caller (institute seeding) leaves the creator null")
    void createWithoutUserLeavesCreatorNull() {
        PaymentOptionDTO dto = PaymentOptionDTO.builder().name("Institute Payment Option").type("FREE").build();
        when(paymentOptionRepository.save(any(PaymentOption.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentOptionDTO result = service.savePaymentOption(dto, null);

        assertNull(result.getCreatedByUserId());
        // The FREE fallback plan is still minted for the seeded option.
        assertEquals(1, result.getPaymentPlans().size());
    }

    @Test
    @DisplayName("edit via POST updates the stored row in place and keeps the original creator")
    void editViaPostUpdatesInPlace() {
        PaymentOption stored = new PaymentOption();
        stored.setId("po-1");
        stored.setName("Old name");
        stored.setType("ONE_TIME");
        stored.setTag("DEFAULT");
        stored.setCreatedByUserId("creator-0");
        PaymentPlan storedPlan = new PaymentPlan();
        storedPlan.setId("pp-1");
        storedPlan.setPaymentOption(stored);
        stored.setPaymentPlans(new ArrayList<>(List.of(storedPlan)));

        PaymentOptionDTO edit = PaymentOptionDTO.builder()
                .id("po-1")
                .name("New name")
                .type("ONE_TIME")
                .requireApproval(true)
                .paymentPlans(List.of(PaymentPlanDTO.builder().name("New name").status("ACTIVE").build()))
                .build();
        when(paymentOptionRepository.existsById("po-1")).thenReturn(true);
        when(paymentOptionRepository.findById("po-1")).thenReturn(Optional.of(stored));
        when(paymentPlanService.editPaymentPlans(anyList(), anyList(), any(PaymentOption.class), anyBoolean()))
                .thenReturn(List.of(storedPlan));
        when(paymentOptionRepository.save(any(PaymentOption.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentOptionDTO result = service.savePaymentOption(edit, user("editor-9"));

        ArgumentCaptor<PaymentOption> captor = ArgumentCaptor.forClass(PaymentOption.class);
        verify(paymentOptionRepository).save(captor.capture());
        assertSame(stored, captor.getValue(), "must update the managed row, not merge a rebuilt copy");
        assertEquals("New name", stored.getName());
        assertEquals("DEFAULT", stored.getTag(), "an edit payload carries no tag and must not clear it");
        assertEquals("creator-0", stored.getCreatedByUserId(), "editor must not become the creator");
        assertEquals("po-1", result.getId());
        // fullPayload=true: the Settings save resends every field, so a null validity is
        // "no expiry" and must be written, unlike the partial PUT dialog.
        verify(paymentPlanService).editPaymentPlans(eq(List.of(storedPlan)), eq(edit.getPaymentPlans()), eq(stored), eq(true));
    }

    @Test
    @DisplayName("list: creator ids resolve to names in one auth_service call, and a failure degrades to null")
    void listAttachesCreatorNames() {
        PaymentOption a = new PaymentOption();
        a.setId("a");
        a.setCreatedByUserId("u1");
        PaymentOption b = new PaymentOption();
        b.setId("b");
        b.setCreatedByUserId("u1");
        PaymentOption c = new PaymentOption();
        c.setId("c");
        when(paymentOptionRepository.findPaymentOptionsWithPaymentPlansNative(
                anyBoolean(), anyList(), anyBoolean(), anyList(), any(), any(),
                anyBoolean(), anyList(), anyBoolean(), anyList(), anyBoolean(), anyBoolean(),
                // search and maxResults — both null on this path, so nullable matchers
                any(), any()))
                .thenReturn(List.of(a, b, c));
        when(authService.getUsersFromAuthServiceByUserIds(List.of("u1")))
                .thenReturn(List.of(UserDTO.builder().id("u1").fullName("Neeraj H").build()))
                .thenThrow(new VacademyException("auth down"));

        PaymentOptionFilterDTO filter = new PaymentOptionFilterDTO();
        filter.setSource("INSTITUTE");
        filter.setSourceId("inst-1");

        List<PaymentOptionDTO> first = service.getPaymentOptions(filter, null);
        assertEquals("Neeraj H", first.get(0).getCreatedByName());
        assertEquals("Neeraj H", first.get(1).getCreatedByName());
        assertNull(first.get(2).getCreatedByName());

        List<PaymentOptionDTO> second = service.getPaymentOptions(filter, null);
        assertEquals(3, second.size(), "auth_service failure must not fail the listing");
        assertNull(second.get(0).getCreatedByName());
        assertEquals("u1", second.get(0).getCreatedByUserId(), "the id still ships so the UI can fall back");
    }
}
