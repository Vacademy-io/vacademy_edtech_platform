package vacademy.io.admin_core_service.features.marketing.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.SocialAccountDTO;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.repository.SocialAccountRepository;
import vacademy.io.admin_core_service.features.youtube.entity.InstituteYoutubeCredentials;
import vacademy.io.admin_core_service.features.youtube.repository.InstituteYoutubeCredentialsRepository;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The institute's social accounts (Facebook Pages, Instagram, Business Profile locations and the
 * YouTube channel). YouTube has no OAuth of its own here: its row mirrors
 * institute_youtube_credentials and is refreshed every time the accounts are listed.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SocialAccountService {

    private static final String YOUTUBE_RECONNECT_DETAIL =
            "Reconnect YouTube from Settings → YouTube Integration.";
    private static final String YOUTUBE_DISCONNECT_REFUSAL =
            "Disconnect YouTube from Settings → YouTube Integration";
    private static final String YOUTUBE_UNKNOWN_CHANNEL = "unknown-channel";
    private static final String CREDENTIALS_ACTIVE = "ACTIVE";

    private final SocialAccountRepository socialAccountRepository;
    private final InstituteYoutubeCredentialsRepository youtubeCredentialsRepository;
    private final MarketingConnectionService connectionService;

    /** Connected (not DISCONNECTED) accounts, after syncing the YouTube row. */
    public List<SocialAccountDTO> listAccounts(String instituteId) {
        try {
            syncYoutubeAccount(instituteId);
        } catch (Exception e) {
            // Listing must still work when the mirror cannot be written (e.g. a concurrent insert).
            log.warn("YouTube social account sync failed for institute {}: {}", instituteId, e.getMessage());
        }
        List<SocialAccount> accounts = socialAccountRepository
                .findByInstituteIdAndStatusNot(instituteId, MarketingConstants.STATUS_DISCONNECTED);
        Map<String, MarketingConnection> connections = connectionService.findByIds(
                accounts.stream().map(SocialAccount::getConnectionId).filter(Objects::nonNull).toList());
        return accounts.stream()
                .sorted(Comparator.comparingInt((SocialAccount a) -> platformOrder(a.getPlatform()))
                        .thenComparing(a -> a.getName() == null ? "" : a.getName(), String.CASE_INSENSITIVE_ORDER))
                .map(a -> SocialAccountDTO.from(a,
                        a.getConnectionId() == null ? null : connections.get(a.getConnectionId())))
                .toList();
    }

    /** Marks an account DISCONNECTED and drops its token. YouTube is disconnected in Settings. */
    public void disconnect(String instituteId, String accountId) {
        SocialAccount account = socialAccountRepository.findByIdAndInstituteId(accountId, instituteId)
                .orElseThrow(() -> new ResourceNotFoundException("Social account not found"));
        if (MarketingConstants.SOCIAL_PLATFORM_YOUTUBE.equals(account.getPlatform())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, YOUTUBE_DISCONNECT_REFUSAL);
        }
        account.setStatus(MarketingConstants.STATUS_DISCONNECTED);
        account.setStatusDetail(null);
        account.setAccessTokenEnc(null);
        socialAccountRepository.save(account);
    }

    /**
     * Mirrors institute_youtube_credentials into a YOUTUBE social_account row: ACTIVE credentials
     * upsert the channel as ACTIVE, INVALID ones mark it RECONNECT_NEEDED, missing credentials (or a
     * different channel) mark old YOUTUBE rows DISCONNECTED. Writes only when something changed.
     */
    void syncYoutubeAccount(String instituteId) {
        InstituteYoutubeCredentials creds = youtubeCredentialsRepository.findById(instituteId).orElse(null);
        List<SocialAccount> existing = socialAccountRepository
                .findByInstituteIdAndPlatform(instituteId, MarketingConstants.SOCIAL_PLATFORM_YOUTUBE);

        String channelId = null;
        if (creds != null) {
            channelId = creds.getChannelId() == null || creds.getChannelId().isBlank()
                    ? YOUTUBE_UNKNOWN_CHANNEL : creds.getChannelId();
        }

        for (SocialAccount row : existing) {
            if (channelId != null && channelId.equals(row.getExternalId())) continue;
            if (!MarketingConstants.STATUS_DISCONNECTED.equals(row.getStatus())) {
                row.setStatus(MarketingConstants.STATUS_DISCONNECTED);
                row.setStatusDetail(null);
                socialAccountRepository.save(row);
            }
        }
        if (creds == null) return;

        final String externalId = channelId;
        SocialAccount row = existing.stream()
                .filter(r -> externalId.equals(r.getExternalId()))
                .findFirst()
                .orElse(null);
        boolean active = CREDENTIALS_ACTIVE.equals(creds.getStatus());
        String status = active ? MarketingConstants.STATUS_ACTIVE : MarketingConstants.STATUS_RECONNECT_NEEDED;
        String detail = active ? null : YOUTUBE_RECONNECT_DETAIL;
        String name = creds.getChannelTitle() == null || creds.getChannelTitle().isBlank()
                ? "YouTube channel" : creds.getChannelTitle();

        if (row == null) {
            socialAccountRepository.save(SocialAccount.builder()
                    .instituteId(instituteId)
                    .platform(MarketingConstants.SOCIAL_PLATFORM_YOUTUBE)
                    .externalId(externalId)
                    .name(name)
                    .avatarUrl(creds.getChannelThumbnailUrl())
                    .status(status)
                    .statusDetail(detail)
                    .build());
            return;
        }
        boolean changed = !Objects.equals(row.getStatus(), status)
                || !Objects.equals(row.getStatusDetail(), detail)
                || !Objects.equals(row.getName(), name)
                || !Objects.equals(row.getAvatarUrl(), creds.getChannelThumbnailUrl());
        if (changed) {
            row.setStatus(status);
            row.setStatusDetail(detail);
            row.setName(name);
            row.setAvatarUrl(creds.getChannelThumbnailUrl());
            socialAccountRepository.save(row);
        }
    }

    private static int platformOrder(String platform) {
        int idx = MarketingConstants.SOCIAL_PLATFORMS.indexOf(platform);
        return idx < 0 ? Integer.MAX_VALUE : idx;
    }
}
