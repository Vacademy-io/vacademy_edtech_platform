package vacademy.io.admin_core_service.features.commerce.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A template's status as the sender reads it: cached 10 minutes when approved and 2 minutes
 * otherwise, a read error counted as not approved, a name of the wrong shape never asked for,
 * and one institute's answers never served for another or another language.
 */
class CommerceWhatsAppTemplateStatusTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String INST = "inst-1";
    private static final String NAME = "commerce_order_shipped";

    private EngagementInternalClients client;
    private CommerceWhatsAppTemplateStatus status;
    private long now = 1_000_000L;

    @BeforeEach
    void setUp() {
        client = mock(EngagementInternalClients.class);
        status = new CommerceWhatsAppTemplateStatus(client, mock(InstituteSettingService.class), JSON);
        status.setClock(() -> now);
    }

    private void answer(String lang, String json) throws Exception {
        when(client.getWhatsAppTemplateByName(INST, NAME, lang)).thenReturn(JSON.readTree(json));
    }

    @Test
    void anApprovedTemplateIsReadAgainAfterTenMinutes() throws Exception {
        answer("hi", "{\"id\":\"t-1\",\"status\":\"approved\",\"bodyVariableNames\":[\"customer_name\",\"order_link\"]}");
        CommerceWhatsAppTemplateStatus.Template t = status.read(INST, NAME, "hi");
        assertEquals("APPROVED", t.status());
        assertEquals(List.of("customer_name", "order_link"), t.bodyVariableNames());
        assertEquals("t-1", t.id());

        now += 10 * 60_000L - 1;
        assertEquals("APPROVED", status.status(INST, NAME, "hi"));
        verify(client, times(1)).getWhatsAppTemplateByName(INST, NAME, "hi");
        now += 1;
        status.status(INST, NAME, "hi");
        verify(client, times(2)).getWhatsAppTemplateByName(INST, NAME, "hi");
    }

    @Test
    void anyOtherStatusIsReadAgainAfterTwoMinutes() throws Exception {
        answer("en", "{\"id\":\"t-2\",\"status\":\"PENDING\"}");
        assertEquals("PENDING", status.status(INST, NAME, "en"));
        now += 2 * 60_000L - 1;
        status.status(INST, NAME, "en");
        verify(client, times(1)).getWhatsAppTemplateByName(INST, NAME, "en");
        answer("en", "{\"id\":\"t-2\",\"status\":\"APPROVED\"}");
        now += 1;
        assertEquals("APPROVED", status.status(INST, NAME, "en"));
    }

    @Test
    void aReadErrorCountsAsNotApprovedAndAMissingRowAsMissing() throws Exception {
        when(client.getWhatsAppTemplateByName(INST, NAME, "hi")).thenThrow(new IllegalStateException("down"));
        assertEquals(CommerceWhatsAppTemplateStatus.UNKNOWN, status.status(INST, NAME, "hi"));
        assertNull(status.read(INST, NAME, "hi").bodyVariableNames());

        answer("en", "{}");
        assertEquals(CommerceWhatsAppTemplateStatus.MISSING, status.status(INST, NAME, "en"));
        when(client.getWhatsAppTemplateByName(INST, "commerce_order_rto", "en")).thenReturn(null);
        assertEquals(CommerceWhatsAppTemplateStatus.MISSING, status.status(INST, "commerce_order_rto", "en"));
        when(client.getWhatsAppTemplateByName(INST, "commerce_order_rto", "hi"))
                .thenReturn(JSON.readTree("{\"id\":\"t-3\",\"status\":\"\"}"));
        assertEquals(CommerceWhatsAppTemplateStatus.UNKNOWN, status.status(INST, "commerce_order_rto", "hi"));
    }

    @Test
    void aNameOfTheWrongShapeIsNeverAskedFor() {
        for (String bad : new String[] {null, "", "Bad Name", "x&institute=other", "a".repeat(101)}) {
            assertEquals(CommerceWhatsAppTemplateStatus.MISSING, status.status(INST, bad, "hi"));
        }
        verify(client, never()).getWhatsAppTemplateByName(anyString(), anyString(), anyString());
    }

    @Test
    void answersAreKeptPerInstituteNameAndLanguageAndCanBeForgotten() throws Exception {
        answer("hi", "{\"id\":\"t-1\",\"status\":\"APPROVED\"}");
        answer("en", "{\"id\":\"t-2\",\"status\":\"REJECTED\"}");
        when(client.getWhatsAppTemplateByName("inst-2", NAME, "hi")).thenReturn(JSON.readTree("{}"));
        assertEquals("APPROVED", status.status(INST, NAME, "hi"));
        assertEquals("REJECTED", status.status(INST, NAME, "en"));
        assertEquals("MISSING", status.status("inst-2", NAME, "hi"));

        status.forget(INST);
        status.status(INST, NAME, "hi");
        status.status("inst-2", NAME, "hi");
        verify(client, times(2)).getWhatsAppTemplateByName(INST, NAME, "hi");
        verify(client, times(1)).getWhatsAppTemplateByName("inst-2", NAME, "hi");
    }
}
