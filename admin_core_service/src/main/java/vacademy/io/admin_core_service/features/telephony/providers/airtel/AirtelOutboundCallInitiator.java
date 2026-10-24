package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import vacademy.io.admin_core_service.features.telephony.core.PhoneNumbers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.enums.CorrelationStrategy;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderErrorCode;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundCallInitiator;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OutboundCallHandle;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderError;

/**
 * Airtel outbound: place a click2dial from the counsellor's extension
 * ({@code req.from}, set by AirtelOriginationResolver) to the lead PSTN number.
 *
 * click2dial returns no call id, so the {@link OutboundCallHandle} carries a null
 * providerCallId — correlation to this row happens later when the CDR lands in S3
 * and the promoter matches it by extension + lead + time ({@code PROVIDER_CALL_ID}).
 */
@Component
public class AirtelOutboundCallInitiator implements OutboundCallInitiator {

    @Autowired private AirtelHttpClient httpClient;

    @Override
    public String providerType() {
        return ProviderType.AIRTEL;
    }

    @Override
    public CorrelationStrategy correlationStrategy() {
        return CorrelationStrategy.PROVIDER_CALL_ID;
    }

    @Override
    public OutboundCallHandle initiate(BridgeCallRequest req, ProviderCredentials creds) {
        httpClient.click2dial(creds, req.getFrom(), PhoneNumbers.toE164(req.getTo()));
        return OutboundCallHandle.builder()
                .providerCallId(null)               // learned later from the CDR feed
                .initialStatus("click2dial-requested")
                .build();
    }

    @Override
    public ProviderError translateError(Exception e) {
        String msg = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        if (msg.contains("401") || msg.contains("unauthor") || msg.contains("token")) {
            return ProviderError.of(ProviderErrorCode.AUTH_FAILED,
                    "Airtel authentication failed — check the API credentials in Calling settings.");
        }
        if (msg.contains("accountid") || msg.contains("extension")) {
            return ProviderError.of(ProviderErrorCode.NOT_SUPPORTED,
                    "Airtel calling is not fully configured — check the account id and the counsellor's extension.");
        }
        return ProviderError.unknown(null);
    }

}
