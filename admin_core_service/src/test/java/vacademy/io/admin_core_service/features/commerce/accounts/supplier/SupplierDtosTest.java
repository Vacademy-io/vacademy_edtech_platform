package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierView;

import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SupplierDtosTest {

    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();
    private static final String PAN = SupplierRulesTest.PAN;

    private static List<String> keys(Object value) {
        JsonNode node = MAPPER.valueToTree(value);
        List<String> out = new java.util.ArrayList<>();
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            out.add(it.next());
        }
        return out;
    }

    @Test
    void viewAndRowNeverHaveAPanKey() {
        SupplierView view = new SupplierView();
        view.setPanMasked("******" + PAN.substring(6));
        view.setHasPan(true);
        List<String> viewKeys = keys(view);
        assertFalse(viewKeys.contains("pan"));
        assertTrue(viewKeys.contains("pan_masked"));
        assertTrue(viewKeys.contains("has_pan"));
        assertFalse(viewKeys.contains("search_text"));
        assertFalse(viewKeys.contains("client_request_id"));
        assertFalse(viewKeys.contains("request_hash"));
        assertFalse(viewKeys.contains("account_code"));
        assertFalse(viewKeys.contains("warnings"), "warnings only in create and edit answers");

        List<String> rowKeys = keys(new SupplierRow());
        assertTrue(rowKeys.stream().noneMatch(k -> k.contains("pan")), rowKeys.toString());
        assertEquals(List.of("id", "code", "name", "name_alt", "group_code", "phone", "gstin", "state_code",
                "registration_type", "status", "balance"), rowKeys);
    }

    @Test
    void requestReadsThePanButNeverPrintsOrWritesIt() throws Exception {
        SupplierRequest request = MAPPER.readValue(
                "{\"name\":\"Test Supplier One\",\"pan\":\"" + PAN + "\",\"client_request_id\":\"key-00000001\"}",
                SupplierRequest.class);
        assertEquals(PAN, request.getPan());
        assertEquals("key-00000001", request.getClientRequestId());
        assertFalse(request.toString().contains(PAN));
        assertFalse(MAPPER.writeValueAsString(request).contains(PAN));
    }
}
