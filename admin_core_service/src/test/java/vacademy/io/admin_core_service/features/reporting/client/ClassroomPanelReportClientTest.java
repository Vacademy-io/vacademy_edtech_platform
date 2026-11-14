package vacademy.io.admin_core_service.features.reporting.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient.Status;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** A switched-off usage feature in auth reads differently from auth being unreachable. */
class ClassroomPanelReportClientTest {

    private final InternalClientUtils http = mock(InternalClientUtils.class);
    private final ClassroomPanelReportClient client =
            new ClassroomPanelReportClient(http, new ObjectMapper(), "http://auth.test", "admin_core_service", 10);

    private Status summaryStatus() {
        return client.usageSummary("inst-1", LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9), "Asia/Kolkata")
                .status();
    }

    @Test
    void aNotFoundIsFeatureOff() {
        when(http.makeHmacRequestWithEncodedRoute(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.NOT_FOUND, "Not Found", null,
                        "{\"code\":\"FEATURE_OFF\"}".getBytes(), null));
        assertEquals(Status.FEATURE_OFF, summaryStatus());
        assertNull(client.fetchUsageSummary("inst-1", LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9), "UTC"));
        assertEquals(Boolean.FALSE, client.hasPanels("inst-1"));
    }

    @Test
    void aBareNotFoundResponseIsFeatureOffToo() {
        when(http.makeHmacRequestWithEncodedRoute(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(ResponseEntity.status(HttpStatus.NOT_FOUND).body(""));
        assertEquals(Status.FEATURE_OFF, summaryStatus());
    }

    @Test
    void serverErrorsAndTimeoutsAreFailures() {
        when(http.makeHmacRequestWithEncodedRoute(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(HttpServerErrorException.create(HttpStatus.INTERNAL_SERVER_ERROR, "Error", null, null,
                        null))
                .thenThrow(new ResourceAccessException("Read timed out"))
                .thenThrow(HttpClientErrorException.create(HttpStatus.FORBIDDEN, "Forbidden", null, null, null));
        assertEquals(Status.FAILED, summaryStatus());
        assertEquals(Status.FAILED, summaryStatus());
        assertEquals(Status.FAILED, summaryStatus());
    }

    @Test
    void anOkBodyIsReturned() {
        when(http.makeHmacRequestWithEncodedRoute(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(ResponseEntity.ok("{\"totals\":{\"sessions\":3}}"));
        ClassroomPanelReportClient.UsageResult result = client.usageSummary("inst-1", LocalDate.of(2026, 11, 3),
                LocalDate.of(2026, 11, 9), "Asia/Kolkata");
        assertEquals(Status.OK, result.status());
        assertEquals(3, result.body().path("totals").path("sessions").asInt());
    }
}
