package vacademy.io.admin_core_service.features.marketing.client;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MarketingHttpTest {

    @Test
    @DisplayName("Only a connection that was never opened counts as a connect failure")
    void connectFailures() {
        assertTrue(MarketingHttp.isConnectFailure(new RuntimeException("wrapped", new ConnectException("refused"))));
        assertTrue(MarketingHttp.isConnectFailure(new UnknownHostException("graph.facebook.com")));
        assertTrue(MarketingHttp.isConnectFailure(
                new IllegalStateException("x", new RuntimeException(new io.netty.channel.ConnectTimeoutException()))));
        assertFalse(MarketingHttp.isConnectFailure(new IllegalStateException("Timeout on blocking read",
                new TimeoutException())));
        assertFalse(MarketingHttp.isConnectFailure(new RuntimeException("reset")));
    }
}
