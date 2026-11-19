package vacademy.io.admin_core_service.features.telephony.providers.aavtaar;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.spi.RecordingFetcher;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.common.external.VendorCallLog;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;

/**
 * Fetches an Aavtaar call recording. Aavtaar returns a public Plivo /
 * DigitalOcean Spaces {@code callRecordingUrl} (no auth), so this is a plain GET —
 * no provider credentials are used.
 */
@Component
public class AavtaarRecordingFetcher implements RecordingFetcher {

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String providerType() {
        return ProviderType.AAVTAAR;
    }

    @Override
    public InputStream fetch(String recordingUrl, ProviderCredentials creds) throws IOException {
        try {
            byte[] bytes = restTemplate.getForObject(URI.create(recordingUrl), byte[].class);
            if (bytes == null || bytes.length == 0) {
                throw new IOException("empty recording body from " + recordingUrl);
            }
            return new ByteArrayInputStream(bytes);
        } catch (Exception e) {
            VendorCallLog.failed(recordingUrl, "fetch recording", null, e);
            throw new IOException("failed to fetch Aavtaar recording: " + e.getMessage(), e);
        }
    }
}
