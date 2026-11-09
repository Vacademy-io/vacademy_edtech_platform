package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;

import java.time.Instant;
import java.time.LocalDate;

/** A connected ad account as the dashboard sees it (no tokens). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdAccountDTO {
    private String id;
    /** META | GOOGLE */
    private String platform;
    private String externalAccountId;
    private String name;
    private String currency;
    private String timeZone;
    /** ACTIVE | ERROR | DISCONNECTED */
    private String status;
    private String statusDetail;
    private Instant lastSyncedAt;
    /** OK | FAILED */
    private String lastSyncStatus;
    /** Status of the OAuth grant behind the account (ACTIVE | RECONNECT_NEEDED | REVOKED); null if unknown. */
    private String connectionStatus;
    private LocalDate syncedFrom;

    /** @param connection the account's marketing_connection; may be null */
    public static AdAccountDTO from(AdAccount account, MarketingConnection connection) {
        if (account == null) return null;
        return AdAccountDTO.builder()
                .id(account.getId())
                .platform(account.getPlatform())
                .externalAccountId(account.getExternalAccountId())
                .name(account.getName())
                .currency(account.getCurrency())
                .timeZone(account.getTimeZone())
                .status(account.getStatus())
                .statusDetail(account.getStatusDetail())
                .lastSyncedAt(account.getLastSyncedAt())
                .lastSyncStatus(account.getLastSyncStatus())
                .connectionStatus(connection == null ? null : connection.getStatus())
                .syncedFrom(account.getSyncedFrom())
                .build();
    }
}
