package vacademy.io.admin_core_service.features.telephony.providers.exotel;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderErrorCode;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundCallInitiator;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OutboundCallHandle;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderError;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

// vendor-call-log: names my.exotel.com in error text; calls are recorded in ExotelHttpClient
@Component
public class ExotelOutboundCallInitiator implements OutboundCallInitiator {

    @Autowired
    private ExotelHttpClient httpClient;

    @Override
    public String providerType() {
        return ProviderType.EXOTEL;
    }

    @Override
    public OutboundCallHandle initiate(BridgeCallRequest req, ProviderCredentials creds) {
        Map<String, Object> body = httpClient.connect(req, creds);
        // Exotel responds with: { "Call": { "Sid": "...", "Status": "..." } }
        Object callObj = body == null ? null : body.get("Call");
        if (!(callObj instanceof Map)) {
            throw new VacademyException("Unexpected response from Exotel");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> call = (Map<String, Object>) callObj;
        String sid = asString(call.get("Sid"));
        String status = asString(call.get("Status"));
        if (sid == null) throw new VacademyException("Exotel did not return a Call Sid");

        return OutboundCallHandle.builder()
                .providerCallId(sid)
                .initialStatus(status)
                .build();
    }

    /**
     * Map Exotel's raw error text onto a neutral code + message. Moved here from
     * CallOrchestrator so the core no longer hard-codes Exotel-branded copy
     * ("top up at my.exotel.com") for every provider's failures.
     */
    @Override
    public ProviderError translateError(Exception e) {
        String msg = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        if (msg.contains("insufficient balance") || msg.contains("recharge")) {
            return ProviderError.of(ProviderErrorCode.OUT_OF_BALANCE,
                    "Your Exotel account is out of balance. Top up at my.exotel.com and try again.");
        }
        if (msg.contains("not verified") || msg.contains("verify your number")) {
            return ProviderError.of(ProviderErrorCode.CALLER_ID_UNVERIFIED,
                    "Caller or recipient number is not verified on Exotel. Check the Verified Caller IDs list.");
        }
        if (msg.contains("invalid") && msg.contains("number")) {
            return ProviderError.of(ProviderErrorCode.INVALID_NUMBER,
                    "Phone number format rejected by the provider. Check the From/To fields.");
        }
        return ProviderError.unknown(null);
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }
}
