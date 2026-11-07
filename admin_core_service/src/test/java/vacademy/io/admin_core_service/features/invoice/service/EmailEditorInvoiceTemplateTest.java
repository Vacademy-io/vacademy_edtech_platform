package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceData;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceLineItemData;
import vacademy.io.admin_core_service.features.invoice.util.CourseTagResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Templates built in the email editor (MJML) use customer-details names and a single item row
 * rather than {{user_name}} and the pre-rendered {{line_items}} block. They must fill completely
 * and still survive the strict XHTML step of the PDF build.
 */
class EmailEditorInvoiceTemplateTest {

    private static final String TEMPLATE = "<!doctype html><html><head><style>"
            + "@media only screen and (min-width:480px){.col{width:100% !important;}}</style></head><body>"
            + "<div class=\"col\"><p>INVOICE {{invoice_number}} issued {{date_issued}} ABN {{abn}}</p>"
            + "<p>{{customer_name}} &lt;{{customer_email}}&gt; - {{job_title}} at {{practice_name}}, "
            + "{{state}}, {{customer_country}}</p>"
            + "<table><tr><td>{{invoice_item_description}}{{#if invoice_item_tag}}<br/><i>{{invoice_item_tag}}</i>{{/if}}</td>"
            + "<td>{{qty}}</td><td>{{unit_price}}</td><td>{{amount}}</td></tr></table>"
            + "<p>Total {{total}} Balance Due {{balance_due}} Paid {{date_paid}}</p></div></body></html>";

    private InvoiceService service;
    private CourseTagResolver tags;
    private InvoiceData data;

    @BeforeEach
    void setUp() {
        service = new InvoiceService();
        InstituteSettingService settings = mock(InstituteSettingService.class);
        Map<String, Object> country = new HashMap<>(Map.of("name", "Australia", "code", "AU",
                "taxRegistrationNumber", "12 345 678 901"));
        Map<String, Object> invoiceSetting = new HashMap<>(Map.of("country", country, "currency", "AUD"));
        when(settings.getSettingData(any(), eq("INVOICE_SETTING"))).thenReturn(invoiceSetting);
        ReflectionTestUtils.setField(service, "instituteSettingService", settings);

        CustomFieldValuesRepository cfv = mock(CustomFieldValuesRepository.class);
        List<Object[]> rows = new ArrayList<>();
        // [sourceId, customFieldId, fieldKey, fieldName, fieldType, value, sourceType]
        rows.add(new Object[] {"u1", "cf1", "practice_name_x", "Clinic Name", "TEXT", "Bohle Vet", "USER"});
        rows.add(new Object[] {"u1", "cf2", "job_title_x", "Job Title", "DROPDOWN", "Veterinarian", "USER"});
        rows.add(new Object[] {"u1", "cf3", "state_x", "State", "TEXT", "QLD", "USER"});
        rows.add(new Object[] {"u1", "cf4", "country_x", "Country", "DROPDOWN", "New Zealand", "USER"});
        when(cfv.findCustomFieldsWithKeysByUserIdsAndInstitute(anyString(), anyList(), anyString())).thenReturn(rows);
        ReflectionTestUtils.setField(service, "customFieldValuesRepository", cfv);
        tags = mock(CourseTagResolver.class);
        when(tags.tagsFor(any())).thenReturn("Vet Course");
        ReflectionTestUtils.setField(service, "courseTagResolver", tags);

        Institute institute = new Institute();
        institute.setId("inst-1");
        institute.setInstituteName("Vet Education");
        UserDTO user = new UserDTO();
        user.setId("u1");
        user.setFullName("Sam & Co");
        user.setEmail("sam@example.com");
        PaymentPlan plan = new PaymentPlan();
        plan.setName("Annual Fee for 5 Members");
        data = InvoiceData.builder()
                .user(user).institute(institute).paymentPlan(plan)
                .invoiceNumber("INV-0042")
                .invoiceDate(LocalDateTime.of(2026, 10, 19, 9, 0))
                .paymentDate(LocalDateTime.of(2026, 10, 19, 9, 5))
                .currency("AUD")
                .totalAmount(new BigDecimal("431.00")).subtotal(new BigDecimal("431.00"))
                .taxAmount(BigDecimal.ZERO)
                .lineItems(List.of(
                        InvoiceLineItemData.builder().itemType("PLAN").description("Practice Membership - MYCPD")
                                .quantity(1).unitPrice(new BigDecimal("431.00")).amount(new BigDecimal("431.00"))
                                .build()))
                .build();
    }

    private String render(String template) throws Exception {
        Method m = InvoiceService.class.getDeclaredMethod("replaceTemplatePlaceholders", String.class, InvoiceData.class);
        m.setAccessible(true);
        return (String) m.invoke(service, template, data);
    }

    @Test
    @DisplayName("every email-editor placeholder fills and the optional tag block resolves")
    void fillsEveryPlaceholder() throws Exception {
        String html = render(TEMPLATE);
        assertFalse(html.contains("{{"), "unfilled token left in: " + html);
        // Same as {{user_name}}: names are not escaped here; the PDF step escapes bare ampersands.
        assertTrue(html.contains("Sam & Co"), html);
        assertTrue(html.contains("Veterinarian at Bohle Vet, QLD, New Zealand"), html);
        assertTrue(html.contains("ABN 12 345 678 901"), html);
        assertTrue(html.contains("Practice Membership - MYCPD<br/><i>Vet Course</i>"), html);
        assertTrue(html.contains("19 Oct 2026"), html);
    }

    @Test
    @DisplayName("a paid invoice owes nothing; the tag block disappears when the course has no tags")
    void balanceAndTag() throws Exception {
        String html = render(TEMPLATE);
        String total = html.substring(html.indexOf("Total "));
        assertTrue(total.matches("(?s)Total (\\S+)431\\.00 Balance Due \\1" + "0\\.00 Paid 19 Oct 2026.*"), total);

        when(tags.tagsFor(any())).thenReturn("");
        html = render(TEMPLATE);
        assertFalse(html.contains("<i>"), "course has no tags, so the block should go: " + html);
        assertFalse(html.contains("TPL_IF"), html);
    }

    @Test
    @DisplayName("the filled template still builds a PDF")
    void buildsPdf() throws Exception {
        Method pdf = InvoiceService.class.getDeclaredMethod("generatePdfFromHtml", String.class);
        pdf.setAccessible(true);
        byte[] bytes = (byte[]) pdf.invoke(service, render(TEMPLATE));
        assertTrue(bytes.length > 1000);
        assertEquals("%PDF", new String(bytes, 0, 4));
    }

    @Test
    @DisplayName("clinic, job title, state and country fields are recognised by their usual names")
    void profileLabels() {
        assertEquals("practice_name", InvoiceService.learnerProfilePlaceholderFor("Clinic Name"));
        assertEquals("practice_name", InvoiceService.learnerProfilePlaceholderFor("Practice Name"));
        assertEquals("job_title", InvoiceService.learnerProfilePlaceholderFor("Job Title"));
        assertEquals("state", InvoiceService.learnerProfilePlaceholderFor("State"));
        assertEquals("customer_country", InvoiceService.learnerProfilePlaceholderFor("Country"));
        assertNull(InvoiceService.learnerProfilePlaceholderFor("Statement Date"));
        assertNull(InvoiceService.learnerProfilePlaceholderFor("Practice Manager Email"));
    }

    @Test
    @DisplayName("the one-row item is the plan line, not a discount or tax line")
    void primaryItem() {
        InvoiceLineItemData discount = InvoiceLineItemData.builder().itemType("DISCOUNT").description("d").build();
        InvoiceLineItemData planLine = InvoiceLineItemData.builder().itemType("PLAN").description("p").build();
        assertEquals("p", InvoiceService.primaryLineItem(List.of(discount, planLine)).getDescription());
        assertNull(InvoiceService.primaryLineItem(List.of()));
        assertEquals(new BigDecimal("431.00"),
                InvoiceService.balanceDue(InvoiceData.builder().totalAmount(new BigDecimal("431.00")).build()));
    }
}
