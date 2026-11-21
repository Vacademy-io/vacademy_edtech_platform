package vacademy.io.common.auth.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.repository.ClientAuthenticationRepository;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ClientAuthenticationServiceTest {

    private static final String STORED = "stored-value";
    private static final String NEXT = "next-value";

    /** client_secret_key rows: name -> secret (a null secret is a row with no value). */
    private static ClientAuthenticationService service(Map<String, String> rows, String acceptList) {
        ClientAuthenticationRepository repo = (ClientAuthenticationRepository) Proxy.newProxyInstance(
                ClientAuthenticationRepository.class.getClassLoader(),
                new Class<?>[]{ClientAuthenticationRepository.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("findSecretKeys")) {
                        String name = (String) args[0];
                        if (!rows.containsKey(name)) {
                            return Collections.emptyList();
                        }
                        List<String> found = new ArrayList<>();
                        found.add(rows.get(name));
                        return found;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
        ClientAuthenticationService service = new ClientAuthenticationService();
        service.clientAuthenticationRepository = repo;
        service.setAcceptList(acceptList);
        return service;
    }

    private static Map<String, String> rows() {
        Map<String, String> rows = new HashMap<>();
        rows.put("auth_service", STORED);
        rows.put("no_value_client", null);
        return rows;
    }

    @Test
    void withoutAcceptListOnlyTheStoredValueIsAccepted() {
        for (String unset : new String[]{null, "", "  ", " , ,"}) {
            ClientAuthenticationService service = service(rows(), unset);
            assertTrue(service.validateClient("auth_service", STORED));
            assertFalse(service.validateClient("auth_service", NEXT));
            assertFalse(service.validateClient("auth_service", ""));
            assertFalse(service.validateClient("auth_service", null));
            assertFalse(service.validateClient("unknown_client", STORED));
            assertFalse(service.validateClient(null, STORED));
            assertFalse(service.validateClient("no_value_client", ""));
        }
    }

    @Test
    void storedValueMustMatchExactly() {
        ClientAuthenticationService service = service(rows(), null);
        assertFalse(service.validateClient("auth_service", STORED + " "));
        assertFalse(service.validateClient("auth_service", STORED.toUpperCase()));
        assertFalse(service.validateClient("auth_service", STORED.substring(1)));
    }

    @Test
    void acceptListValuesAreAcceptedAlongsideTheStoredValue() {
        ClientAuthenticationService service = service(rows(), " " + STORED + " , " + NEXT + " ");
        assertTrue(service.validateClient("auth_service", STORED));
        assertTrue(service.validateClient("auth_service", NEXT));
        assertTrue(service.validateClient("no_value_client", NEXT));
        assertFalse(service.validateClient("auth_service", "other"));
        assertFalse(service.validateClient("auth_service", ""));
    }

    @Test
    void acceptListNeverAdmitsAClientWithoutARow() {
        ClientAuthenticationService service = service(rows(), NEXT);
        assertFalse(service.validateClient("unknown_client", NEXT));
    }

    @Test
    void storedValueStillWorksAfterTheRowChangesDuringTheOverlap() {
        Map<String, String> rows = rows();
        ClientAuthenticationService service = service(rows, STORED + "," + NEXT);
        rows.put("auth_service", NEXT);
        assertTrue(service.validateClient("auth_service", STORED));
        assertTrue(service.validateClient("auth_service", NEXT));
    }

    @Test
    void matchReportsWhichSourceAccepted() {
        List<byte[]> accept = ClientAuthenticationService.parseAcceptList("a,b");
        assertEquals(ClientAuthenticationService.Match.STORED,
                ClientAuthenticationService.match(Collections.singletonList("a"), "a", accept));
        assertEquals(ClientAuthenticationService.Match.ACCEPT_LIST,
                ClientAuthenticationService.match(Collections.singletonList("a"), "b", accept));
        assertEquals(ClientAuthenticationService.Match.NONE,
                ClientAuthenticationService.match(Collections.singletonList("a"), "c", accept));
        assertEquals(ClientAuthenticationService.Match.NONE,
                ClientAuthenticationService.match(Collections.emptyList(), "a", accept));
    }

    @Test
    void acceptListParsingDropsBlanksAndKeepsOrder() {
        List<byte[]> parsed = ClientAuthenticationService.parseAcceptList(" one ,, two ,");
        assertEquals(2, parsed.size());
        assertEquals(0, ClientAuthenticationService.acceptListIndex("one", parsed));
        assertEquals(1, ClientAuthenticationService.acceptListIndex("two", parsed));
        assertEquals(-1, ClientAuthenticationService.acceptListIndex("three", parsed));
        assertEquals(-1, ClientAuthenticationService.acceptListIndex(null, parsed));
        assertTrue(ClientAuthenticationService.parseAcceptList(null).isEmpty());
        assertEquals(Arrays.asList(), ClientAuthenticationService.parseAcceptList(" "));
    }
}
