package vacademy.io.admin_core_service.features.payments.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A cart's order id is "MP…", which is no payment log's id. */
class RazorpayWebHookCartOrderTest {

    private static final String ORDER = "MP35a9c6c8bd5244f383019d2ae9268c19";

    private RazorpayWebHookService service;
    private PaymentLogRepository repository;
    private UserInstitutePaymentGatewayMappingService mappings;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        service = new RazorpayWebHookService();
        repository = mock(PaymentLogRepository.class);
        mappings = mock(UserInstitutePaymentGatewayMappingService.class);
        when(repository.findById(anyString())).thenReturn(Optional.empty());
        ReflectionTestUtils.setField(service, "objectMapper", objectMapper);
        ReflectionTestUtils.setField(service, "paymentLogRepository", repository);
        ReflectionTestUtils.setField(service, "userInstitutePaymentGatewayMappingService", mappings);
    }

    private static PaymentLog log(String id, UserPlan plan) {
        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setId(id);
        paymentLog.setUserId("learner");
        paymentLog.setUserPlan(plan);
        paymentLog.setPaymentSpecificData("{\"originalRequest\":{\"order_id\":\"" + ORDER + "\"},"
                + "\"childPaymentLogIds\":[\"delivery-log\"],"
                + "\"response\":{\"response_data\":{\"razorpayOrderId\":\"order_1\"}}}");
        return paymentLog;
    }

    private static UserPlan plan(String id, String optionType, boolean autoRenew) {
        UserPlan plan = new UserPlan();
        plan.setId(id);
        plan.setAutoRenewalEnabled(autoRenew);
        PaymentOption option = new PaymentOption();
        option.setType(optionType);
        plan.setPaymentOption(option);
        return plan;
    }

    private void cartOf(PaymentLog... logs) {
        when(repository.findAllByOrderIdInOriginalRequest(ORDER)).thenReturn(List.of(logs));
    }

    private void persistMandate() {
        ReflectionTestUtils.invokeMethod(service, "persistRazorpayMandate", ORDER, "learner", "inst", "token_1", "cust_1");
    }

    @Test
    void gatewayLogIsTheOneNoLogListsAsAChild_whateverOrderTheyComeBackIn() {
        PaymentLog delivery = log("delivery-log", plan("delivery-plan", "ONE_TIME", false));
        PaymentLog book = log("book-log", plan("book-plan", "ONE_TIME", false));

        cartOf(delivery, book);
        assertEquals("book-log", service.findGatewayLog(ORDER).orElseThrow().getId());

        cartOf(book, delivery);
        assertEquals("book-log", service.findGatewayLog(ORDER).orElseThrow().getId());
    }

    @Test
    void aSingleCheckoutStillResolvesByItsLogId() {
        PaymentLog single = log("single-log", plan("p", "ONE_TIME", false));
        when(repository.findById("single-log")).thenReturn(Optional.of(single));

        assertEquals(single, service.findGatewayLog("single-log").orElseThrow());
        verify(repository, never()).findAllByOrderIdInOriginalRequest(anyString());
    }

    @Test
    void unknownOrderStaysUnresolved() {
        when(repository.findAllByOrderIdInOriginalRequest(ORDER)).thenReturn(List.of());
        when(repository.findAllByOrderIdInJson(ORDER)).thenReturn(List.of());

        assertTrue(service.findGatewayLog(ORDER).isEmpty());
    }

    @Test
    void receiptLinkReachesEveryLogOfTheCartAndKeepsWhatTheyHeld() throws Exception {
        PaymentLog delivery = log("delivery-log", plan("delivery-plan", "ONE_TIME", false));
        PaymentLog book = log("book-log", plan("book-plan", "ONE_TIME", false));
        cartOf(delivery, book);

        ReflectionTestUtils.invokeMethod(service, "storeInvoiceUrl", ORDER, "https://rzp.io/i/receipt");

        for (PaymentLog paymentLog : List.of(delivery, book)) {
            JsonNode data = objectMapper.readTree(paymentLog.getPaymentSpecificData());
            JsonNode responseData = data.path("response").path("response_data");
            assertEquals("https://rzp.io/i/receipt", responseData.path("receiptUrl").asText());
            assertEquals("order_1", responseData.path("razorpayOrderId").asText());
            assertEquals("delivery-log", data.path("childPaymentLogIds").get(0).asText());
        }
        verify(repository, times(2)).save(any(PaymentLog.class));
    }

    @Test
    void aBookBoughtWithASavedCardGetsNoMandate() {
        cartOf(log("book-log", plan("book-plan", "ONE_TIME", false)),
                log("delivery-log", plan("delivery-plan", "ONE_TIME", false)));

        persistMandate();

        verify(mappings, never()).upsertMandate(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    void aSubscriptionFirstInTheCartStillGetsItsMandate() {
        cartOf(log("sub-log", plan("sub-plan", "SUBSCRIPTION", false)));

        persistMandate();

        verify(mappings).upsertMandate(eq("learner"), eq("inst"), eq("RAZORPAY"), eq("sub-plan"), any());
    }

    @Test
    void anAutoRenewingPlanStillGetsItsMandateWhateverItsOption() {
        cartOf(log("auto-log", plan("auto-plan", "ONE_TIME", true)));

        persistMandate();

        verify(mappings).upsertMandate(eq("learner"), eq("inst"), eq("RAZORPAY"), eq("auto-plan"), any());
    }
}
