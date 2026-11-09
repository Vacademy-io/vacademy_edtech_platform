package vacademy.io.notification_service.institute;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpServerErrorException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InstituteInternalServiceCacheTest {

    private static final String ID = "inst-1";
    private static final String GET_PATH = "/admin-core-service/internal/institute/v1/" + ID;

    private InternalClientUtils client;
    private InstituteInternalService service;

    @BeforeEach
    void setUp() {
        client = mock(InternalClientUtils.class);
        service = new InstituteInternalService();
        ReflectionTestUtils.setField(service, "internalClientUtils", client);
        ReflectionTestUtils.setField(service, "clientName", "notification_service");
        ReflectionTestUtils.setField(service, "adminCoreServerBaseUrl", "http://admin-core");
    }

    private void adminCoreReturns(String name) {
        when(client.makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any()))
                .thenReturn(ResponseEntity.ok("{\"instituteName\":\"" + name + "\"}"));
    }

    @Test
    void cachedLookupCallsAdminCoreOnceAndHandsOutSeparateCopies() {
        adminCoreReturns("Parcham");

        InstituteInfoDTO first = service.getInstituteByInstituteIdCached(ID);
        InstituteInfoDTO second = service.getInstituteByInstituteIdCached(ID);

        assertNotNull(first);
        assertEquals("Parcham", second.getInstituteName());
        assertNotSame(first, second);
        verify(client, times(1)).makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any());
    }

    @Test
    void uncachedLookupAlwaysCallsAdminCore() {
        adminCoreReturns("Parcham");

        service.getInstituteByInstituteIdCached(ID);
        service.getInstituteByInstituteId(ID);
        service.getInstituteByInstituteId(ID);

        verify(client, times(3)).makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any());
    }

    @Test
    void failureIsNotCached() {
        when(client.makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any()))
                .thenThrow(new HttpServerErrorException(HttpStatus.BAD_GATEWAY))
                .thenReturn(ResponseEntity.ok("{\"instituteName\":\"Parcham\"}"));

        assertNull(service.getInstituteByInstituteIdCached(ID));
        InstituteInfoDTO retry = service.getInstituteByInstituteIdCached(ID);

        assertNotNull(retry);
        verify(client, times(2)).makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any());
    }

    @Test
    void savingSettingsClearsTheCache() {
        adminCoreReturns("Parcham");
        when(client.makeHmacRequest(anyString(), eq("POST"), anyString(), anyString(), any()))
                .thenReturn(ResponseEntity.ok("{}"));

        service.getInstituteByInstituteIdCached(ID);
        boolean saved = service.updateInstituteSettings(ID,
                "{\"setting\":{\"EMAIL_SETTING\":{\"data\":{\"UTILITY_EMAIL\":{}}}}}");
        service.getInstituteByInstituteIdCached(ID);

        assertEquals(true, saved);
        verify(client, times(2)).makeHmacRequest(anyString(), eq("GET"), anyString(), eq(GET_PATH), any());
    }
}
