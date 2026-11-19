package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceData;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceLineItemData;
import vacademy.io.admin_core_service.features.invoice.util.CourseTagResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The built-in invoice layout is what every institute without its own INVOICE template prints.
 * It must show that institute's own address and tax number, never one institute's details baked
 * into the shared file.
 */
class DefaultInvoiceTemplateAddressTest {

    private static final Path DEFAULT_TEMPLATE = Path.of("src/main/resources/templates/invoice/default_invoice.html");

    private InvoiceService service;
    private Map<String, Object> country;
    private Institute institute;
    private InvoiceData data;

    @BeforeEach
    void setUp() {
        service = new InvoiceService();
        InstituteSettingService settings = mock(InstituteSettingService.class);
        country = new HashMap<>(Map.of("name", "India", "code", "IN", "taxRegistrationNumber", "TAXREG-001"));
        Map<String, Object> invoiceSetting = new HashMap<>(Map.of("country", country, "currency", "INR"));
        when(settings.getSettingData(any(), eq("INVOICE_SETTING"))).thenReturn(invoiceSetting);
        ReflectionTestUtils.setField(service, "instituteSettingService", settings);
        PaymentSettingService payments = mock(PaymentSettingService.class);
        when(payments.getDefaultCurrency(any())).thenReturn("INR");
        when(payments.resolveCurrency(any(), any(String[].class))).thenReturn("INR");
        ReflectionTestUtils.setField(service, "paymentSettingService", payments);

        CustomFieldValuesRepository cfv = mock(CustomFieldValuesRepository.class);
        when(cfv.findCustomFieldsWithKeysByUserIdsAndInstitute(anyString(), anyList(), anyString()))
                .thenReturn(new ArrayList<>());
        ReflectionTestUtils.setField(service, "customFieldValuesRepository", cfv);
        CourseTagResolver tags = mock(CourseTagResolver.class);
        when(tags.tagsFor(any())).thenReturn("");
        ReflectionTestUtils.setField(service, "courseTagResolver", tags);

        institute = new Institute();
        institute.setId("inst-1");
        institute.setInstituteName("Example Academy");
        institute.setAddress("12 Example Road");
        institute.setCity("Example City");
        institute.setState("Example State");
        institute.setPinCode("400001");
        institute.setCountry("India");
        institute.setMobileNumber("9000000000");
        UserDTO user = new UserDTO();
        user.setId("u1");
        user.setFullName("Test Learner");
        user.setEmail("learner@example.com");
        PaymentPlan plan = new PaymentPlan();
        plan.setName("Annual Plan");
        data = InvoiceData.builder()
                .user(user).institute(institute).paymentPlan(plan)
                .invoiceNumber("INV-0001")
                .invoiceDate(LocalDateTime.of(2026, 11, 6, 9, 0))
                .paymentDate(LocalDateTime.of(2026, 11, 6, 9, 5))
                .currency("INR")
                .totalAmount(new BigDecimal("401.00")).subtotal(new BigDecimal("401.00"))
                .taxAmount(BigDecimal.ZERO)
                .lineItems(List.of(
                        InvoiceLineItemData.builder().itemType("PLAN").description("Course")
                                .quantity(1).unitPrice(new BigDecimal("401.00")).amount(new BigDecimal("401.00"))
                                .build()))
                .build();
    }

    private String render() throws Exception {
        Method m = InvoiceService.class.getDeclaredMethod("replaceTemplatePlaceholders", String.class, InvoiceData.class);
        m.setAccessible(true);
        return (String) m.invoke(service, Files.readString(DEFAULT_TEMPLATE), data);
    }

    @Test
    @DisplayName("the shared template carries no hardcoded address, tax number or country note")
    void noInstituteDetailsBakedIn() throws Exception {
        String template = Files.readString(DEFAULT_TEMPLATE);
        // Every line of the institute's address block is a placeholder, never literal text.
        int start = template.indexOf("<div class=\"company-address\">");
        String addressBlock = template.substring(start, template.indexOf("</div>", start));
        java.util.regex.Matcher line = java.util.regex.Pattern.compile("<p>(.*?)</p>").matcher(addressBlock);
        int lines = 0;
        while (line.find()) {
            lines++;
            assertTrue(line.group(1).matches("\\{\\{[a-z_]+\\}\\}"), "literal text in the address block: " + line.group(1));
        }
        assertTrue(lines > 0, addressBlock);
        // The tax number row and the footer carry no fixed registration number or country note.
        assertFalse(template.matches("(?s).*\\d{2} \\d{3} \\d{3} \\d{3}.*"), "a fixed tax number is baked in");
        assertFalse(template.contains("footer-note\">"), "a fixed footer note is baked in");
    }

    @Test
    @DisplayName("prints the institute's own full address and tax number")
    void printsOwnAddressAndTaxNumber() throws Exception {
        String html = render();
        assertTrue(html.contains("<p>12 Example Road<br/>Example City, Example State - 400001<br/>India</p>"), html);
        assertTrue(html.contains("Tax Reg. No:"), html);
        assertTrue(html.contains("TAXREG-001"), html);
        assertFalse(html.contains("{{"), "unfilled token left in the PDF");
        assertFalse(html.contains("TPL_IF"), html);
    }

    @Test
    @DisplayName("no tax number and no address: those rows disappear instead of printing blank")
    void blankDetailsLeaveNoEmptyRows() throws Exception {
        country.put("taxRegistrationNumber", "");
        institute.setAddress(null);
        institute.setCity(null);
        institute.setState(null);
        institute.setPinCode(null);
        institute.setCountry(null);
        String html = render();
        assertFalse(html.contains("Tax Reg. No:"), html);
        int start = html.indexOf("<div class=\"company-address\">");
        String addressBlock = html.substring(start, html.indexOf("</div>", start));
        assertFalse(addressBlock.contains("<p></p>"), addressBlock);
        assertTrue(addressBlock.contains("<p>9000000000</p>"), addressBlock);
        assertFalse(html.contains("{{"), "unfilled token left in the PDF");
        assertFalse(html.contains("TPL_IF"), html);
    }

    @Test
    @DisplayName("an admin's Institute Address edit replaces the street line on the full address")
    void adminAddressEditIsUsed() throws Exception {
        data.setOverrides(new HashMap<>(Map.of("institute_address", "Unit 5, Corrected Street")));
        String html = render();
        assertTrue(html.contains("<p>Unit 5, Corrected Street<br/>Example City, Example State - 400001<br/>India</p>"),
                html);
        assertFalse(html.contains("12 Example Road"), html);
    }

    @Test
    @DisplayName("the filled default template still builds a PDF")
    void buildsPdf() throws Exception {
        Method pdf = InvoiceService.class.getDeclaredMethod("generatePdfFromHtml", String.class);
        pdf.setAccessible(true);
        byte[] bytes = (byte[]) pdf.invoke(service, render());
        assertTrue(bytes.length > 1000);
        assertEquals("%PDF", new String(bytes, 0, 4));
    }

    @Test
    @DisplayName("address lines are escaped, and a country already typed into the street is not repeated")
    void addressHtml() {
        assertEquals("A &amp; B Lane<br/>Sample Town - 111001",
                InvoiceService.instituteAddressHtml("A & B Lane", "Sample Town", null, "111001", null));
        assertEquals("1 Main St, Sample Town 111001, India",
                InvoiceService.instituteAddressHtml("1 Main St, Sample Town 111001, India", "Sample Town", null, "111001", "India"));
        assertEquals("", InvoiceService.instituteAddressHtml(null, null, null, null, null));
    }
}
