package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.GoogleAdsApiClient;
import vacademy.io.admin_core_service.features.marketing.client.GoogleApiClient;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.client.MarketingHttp;
import vacademy.io.admin_core_service.features.marketing.client.MetaGraphClient;
import vacademy.io.admin_core_service.features.marketing.dto.AdAccountDTO;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectOptionDTO;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectOptionsResponse;
import vacademy.io.admin_core_service.features.marketing.dto.ConnectSelectResponse;
import vacademy.io.admin_core_service.features.marketing.dto.SocialAccountDTO;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.admin_core_service.features.marketing.repository.SocialAccountRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * After OAuth: lists the accounts the signed-in Meta / Google user can connect (options) and stores
 * the ones the admin picks (select). Options are always re-fetched from the platform on select, so
 * names, tokens and selectability never come from the browser.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MarketingAccountSelectionService {

    private static final int META_MAX_PAGES = 10;
    private static final int MAX_GRANTED_ASSETS = 50;
    private static final int MAX_GOOGLE_CUSTOMERS = 40;
    private static final int MAX_GBP_ACCOUNTS = 20;
    private static final int MAX_GBP_PAGES = 5;
    private static final int MAX_SELECTION = 200;

    private static final String META_AD_ACCOUNT_FIELDS = "account_id,name,currency,timezone_name,account_status";
    private static final String META_PAGE_FIELDS = "id,name,access_token,followers_count,fan_count,picture{url},"
            + "instagram_business_account{id,username,name,followers_count,profile_picture_url}";
    private static final Set<String> META_ADS_GRANT_SCOPES = Set.of("ads_read", "ads_management");
    private static final Set<String> META_PAGE_GRANT_SCOPES = Set.of("pages_show_list", "pages_manage_posts",
            "pages_read_engagement", "pages_manage_metadata");

    private static final String GOOGLE_CUSTOMER_QUERY = "SELECT customer.id, customer.descriptive_name, "
            + "customer.currency_code, customer.time_zone, customer.manager, customer.test_account, "
            + "customer.status FROM customer LIMIT 1";
    private static final String GOOGLE_CLIENT_QUERY = "SELECT customer_client.id, customer_client.descriptive_name, "
            + "customer_client.currency_code, customer_client.time_zone, customer_client.manager, "
            + "customer_client.level, customer_client.status FROM customer_client "
            + "WHERE customer_client.level <= 1 AND customer_client.manager = false";

    private static final String GBP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
    private static final String GBP_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1/";

    private final MarketingOAuthService oauthService;
    private final MarketingConnectionService connectionService;
    private final GoogleOAuthTokenService googleOAuthTokenService;
    private final MetaGraphClient metaGraphClient;
    private final GoogleAdsApiClient googleAdsApiClient;
    private final GoogleApiClient googleApiClient;
    private final AdAccountRepository adAccountRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final TokenEncryptionService tokenEncryptionService;
    /** Implemented by the ads sync service; optional so the app starts without it. */
    private final ObjectProvider<AdSpendSyncTrigger> adSpendSyncTrigger;

    /** An option plus the server-only data needed to store it (never serialized). */
    static final class ResolvedOption {
        final ConnectOptionDTO dto;
        /** Platform written to ad_account / social_account. */
        String platform;
        String pageToken;
        String parentExternalId;
        String handle;
        String avatarUrl;
        Long followers;

        ResolvedOption(ConnectOptionDTO dto) {
            this.dto = dto;
        }
    }

    // ── Options ──────────────────────────────────────────────────────────────

    public ConnectOptionsResponse getOptions(String sessionKey, String instituteId, String userId) {
        MarketingOAuthService.AuthorizedSession session =
                oauthService.requireAuthorizedSession(sessionKey, instituteId, userId);
        List<ResolvedOption> options = resolveOptions(session);
        return ConnectOptionsResponse.builder()
                .provider(session.provider())
                .connectionId(session.connection().getId())
                .accountName(session.connection().getExternalUserName())
                .options(options.stream().map(o -> o.dto).toList())
                .build();
    }

    // ── Select ───────────────────────────────────────────────────────────────

    public ConnectSelectResponse select(String sessionKey, String instituteId, String userId,
                                        List<String> externalIds) {
        Set<String> wanted = new LinkedHashSet<>();
        if (externalIds != null) {
            for (String id : externalIds) {
                if (id != null && !id.isBlank()) wanted.add(id.trim());
            }
        }
        if (wanted.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Select at least one account to connect.");
        }
        if (wanted.size() > MAX_SELECTION) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Select at most " + MAX_SELECTION + " accounts at a time.");
        }

        MarketingOAuthService.AuthorizedSession session =
                oauthService.requireAuthorizedSession(sessionKey, instituteId, userId);
        MarketingConnection connection = session.connection();
        List<ResolvedOption> options = resolveOptions(session);

        List<AdAccount> savedAds = new ArrayList<>();
        List<SocialAccount> savedSocial = new ArrayList<>();
        for (ResolvedOption option : options) {
            if (!wanted.contains(option.dto.getExternalId()) || !option.dto.isSelectable()) continue;
            if (MarketingConstants.isAdsProvider(session.provider())) {
                savedAds.add(upsertAdAccount(instituteId, connection, option));
            } else {
                savedSocial.add(upsertSocialAccount(instituteId, connection, option));
            }
        }
        if (savedAds.isEmpty() && savedSocial.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "None of the selected accounts can be connected. Refresh the list and try again.");
        }
        oauthService.markConsumed(session.state());

        AdSpendSyncTrigger trigger = adSpendSyncTrigger.getIfAvailable();
        for (AdAccount account : savedAds) {
            if (trigger == null) {
                log.warn("No AdSpendSyncTrigger bean; ad account {} waits for the scheduled sync", account.getId());
                break;
            }
            try {
                trigger.syncAccountAsync(account.getId());
            } catch (Exception e) {
                log.warn("Could not queue the initial sync for ad account {}: {}", account.getId(), e.getMessage());
            }
        }

        log.info("Marketing accounts connected: institute={} provider={} ads={} social={}",
                instituteId, session.provider(), savedAds.size(), savedSocial.size());
        return ConnectSelectResponse.builder()
                .created(savedAds.size() + savedSocial.size())
                .adAccounts(savedAds.stream().map(a -> AdAccountDTO.from(a, connection)).toList())
                .socialAccounts(savedSocial.stream().map(s -> SocialAccountDTO.from(s, connection)).toList())
                .build();
    }

    private AdAccount upsertAdAccount(String instituteId, MarketingConnection connection, ResolvedOption option) {
        ConnectOptionDTO dto = option.dto;
        AdAccount account = adAccountRepository
                .findByInstituteIdAndPlatformAndExternalAccountId(instituteId, option.platform, dto.getExternalId())
                .orElseGet(() -> AdAccount.builder()
                        .instituteId(instituteId)
                        .platform(option.platform)
                        .externalAccountId(dto.getExternalId())
                        .build());
        account.setConnectionId(connection.getId());
        account.setName(dto.getName());
        account.setCurrency(dto.getCurrency());
        account.setTimeZone(dto.getTimeZone());
        account.setLoginCustomerId(dto.getLoginCustomerId());
        account.setStatus(MarketingConstants.STATUS_ACTIVE);
        account.setStatusDetail(null);
        return adAccountRepository.save(account);
    }

    private SocialAccount upsertSocialAccount(String instituteId, MarketingConnection connection, ResolvedOption option) {
        ConnectOptionDTO dto = option.dto;
        SocialAccount account = socialAccountRepository
                .findByInstituteIdAndPlatformAndExternalId(instituteId, option.platform, dto.getExternalId())
                .orElseGet(() -> SocialAccount.builder()
                        .instituteId(instituteId)
                        .platform(option.platform)
                        .externalId(dto.getExternalId())
                        .build());
        account.setConnectionId(connection.getId());
        account.setParentExternalId(option.parentExternalId);
        account.setName(dto.getName());
        account.setHandle(option.handle);
        account.setAvatarUrl(option.avatarUrl);
        account.setFollowersCount(option.followers);
        account.setAccessTokenEnc(option.pageToken == null ? null : tokenEncryptionService.encrypt(option.pageToken));
        account.setStatus(MarketingConstants.STATUS_ACTIVE);
        account.setStatusDetail(null);
        return socialAccountRepository.save(account);
    }

    // ── Option resolution per provider ───────────────────────────────────────

    private List<ResolvedOption> resolveOptions(MarketingOAuthService.AuthorizedSession session) {
        MarketingConnection connection = session.connection();
        String instituteId = connection.getInstituteId();
        List<ResolvedOption> options = switch (session.provider()) {
            case MarketingConstants.PROVIDER_META_ADS -> metaAdAccountOptions(connection);
            case MarketingConstants.PROVIDER_META_SOCIAL -> metaSocialOptions(connection);
            case MarketingConstants.PROVIDER_GOOGLE_ADS -> googleAdsOptions(connection);
            case MarketingConstants.PROVIDER_GOOGLE_BUSINESS -> googleBusinessOptions(connection);
            default -> throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown provider " + session.provider());
        };
        markAlreadyConnected(instituteId, session.provider(), options);
        return options;
    }

    private void markAlreadyConnected(String instituteId, String provider, List<ResolvedOption> options) {
        Set<String> connected = new HashSet<>();
        if (MarketingConstants.isAdsProvider(provider)) {
            for (AdAccount a : adAccountRepository.findByInstituteIdAndStatusNot(instituteId, MarketingConstants.STATUS_DISCONNECTED)) {
                connected.add(a.getPlatform() + "|" + a.getExternalAccountId());
            }
        } else {
            for (SocialAccount s : socialAccountRepository.findByInstituteIdAndStatusNot(instituteId, MarketingConstants.STATUS_DISCONNECTED)) {
                connected.add(s.getPlatform() + "|" + s.getExternalId());
            }
        }
        for (ResolvedOption option : options) {
            option.dto.setAlreadyConnected(option.platform != null
                    && connected.contains(option.platform + "|" + option.dto.getExternalId()));
        }
    }

    // Meta ad accounts ─────────────────────────────────────────────────────────

    private List<ResolvedOption> metaAdAccountOptions(MarketingConnection connection) {
        String token = connectionService.metaUserToken(connection);
        Map<String, ResolvedOption> byId = new LinkedHashMap<>();
        List<JsonNode> rows = metaGraphClient.getAllPages("me/adaccounts?fields="
                + MetaGraphClient.enc(META_AD_ACCOUNT_FIELDS) + "&limit=200", token, META_MAX_PAGES);
        for (JsonNode row : rows) {
            ResolvedOption option = metaAdAccountOption(row);
            if (option != null) byId.putIfAbsent(option.dto.getExternalId(), option);
        }
        // Login-for-Business grants: business-owned ad accounts can be missing from /me/adaccounts.
        int extra = 0;
        for (String id : metaGraphClient.grantedTargetIds(token, META_ADS_GRANT_SCOPES)) {
            String accountId = id.startsWith("act_") ? id.substring(4) : id;
            if (byId.containsKey(accountId) || extra >= MAX_GRANTED_ASSETS) continue;
            extra++;
            try {
                JsonNode node = metaGraphClient.get("act_" + accountId + "?fields="
                        + MetaGraphClient.enc(META_AD_ACCOUNT_FIELDS), token);
                ResolvedOption option = metaAdAccountOption(node);
                if (option != null) byId.putIfAbsent(option.dto.getExternalId(), option);
            } catch (MarketingApiException e) {
                if (e.isAuthError()) throw e;
                log.debug("Granted Meta asset {} is not a readable ad account ({})", accountId, e.getPlatformCode());
            }
        }
        return new ArrayList<>(byId.values());
    }

    private ResolvedOption metaAdAccountOption(JsonNode row) {
        String id = row.path("account_id").asText("");
        if (id.isBlank()) {
            String raw = row.path("id").asText("");
            id = raw.startsWith("act_") ? raw.substring(4) : raw;
        }
        if (id.isBlank()) return null;
        String currency = textOrNull(row, "currency");
        boolean active = row.path("account_status").asInt(1) == 1;
        ConnectOptionDTO dto = ConnectOptionDTO.builder()
                .externalId(id)
                .name(textOr(row, "name", "Ad account " + id))
                .subtitle("act_" + id + (currency != null ? " · " + currency : ""))
                .kind(MarketingConstants.OPTION_KIND_AD_ACCOUNT)
                .currency(currency)
                .timeZone(textOrNull(row, "timezone_name"))
                .selectable(active)
                .warning(active ? null : "Account is not active")
                .build();
        ResolvedOption option = new ResolvedOption(dto);
        option.platform = MarketingConstants.PLATFORM_META;
        return option;
    }

    // Meta Pages + Instagram ─────────────────────────────────────────────────

    private List<ResolvedOption> metaSocialOptions(MarketingConnection connection) {
        String token = connectionService.metaUserToken(connection);
        Map<String, JsonNode> pages = new LinkedHashMap<>();
        Map<String, Boolean> pageHasTasks = new LinkedHashMap<>();
        try {
            List<JsonNode> rows = metaGraphClient.getAllPages("me/accounts?fields="
                    + MetaGraphClient.enc("tasks," + META_PAGE_FIELDS) + "&limit=200", token, META_MAX_PAGES);
            for (JsonNode row : rows) {
                String id = row.path("id").asText("");
                if (!id.isBlank()) {
                    pages.putIfAbsent(id, row);
                    pageHasTasks.putIfAbsent(id, true);
                }
            }
        } catch (MarketingApiException e) {
            // System-user tokens have no /me/accounts edge; the granted-assets path below covers them.
            if (e.isAuthError()) throw e;
            log.warn("Meta /me/accounts failed for connection {} ({}); using granted Pages only",
                    connection.getId(), e.getPlatformCode());
        }
        int extra = 0;
        for (String id : metaGraphClient.grantedTargetIds(token, META_PAGE_GRANT_SCOPES)) {
            if (pages.containsKey(id) || extra >= MAX_GRANTED_ASSETS) continue;
            extra++;
            try {
                JsonNode node = metaGraphClient.get(id + "?fields=" + MetaGraphClient.enc(META_PAGE_FIELDS), token);
                if (node.hasNonNull("id")) {
                    pages.put(id, node);
                    pageHasTasks.put(id, false);
                }
            } catch (MarketingApiException e) {
                if (e.isAuthError()) throw e;
                log.debug("Granted Meta asset {} is not a readable Page ({})", id, e.getPlatformCode());
            }
        }

        List<ResolvedOption> options = new ArrayList<>();
        for (Map.Entry<String, JsonNode> entry : pages.entrySet()) {
            addPageOptions(entry.getValue(), Boolean.TRUE.equals(pageHasTasks.get(entry.getKey())), options);
        }
        return options;
    }

    private void addPageOptions(JsonNode page, boolean tasksKnown, List<ResolvedOption> out) {
        String pageId = page.path("id").asText();
        String pageName = textOr(page, "name", "Facebook Page " + pageId);
        String pageToken = textOrNull(page, "access_token");

        String warning = null;
        boolean selectable = true;
        if (tasksKnown) {
            Set<String> tasks = new HashSet<>();
            for (JsonNode t : page.path("tasks")) tasks.add(t.asText());
            if (!tasks.contains("CREATE_CONTENT") && !tasks.contains("MANAGE")) {
                selectable = false;
                warning = "You need content-creation access to this Page";
            }
        }
        if (selectable && pageToken == null) {
            selectable = false;
            warning = "Facebook did not return a Page token. Reconnect and allow access to this Page.";
        }

        Long pageFollowers = page.hasNonNull("followers_count") ? Long.valueOf(page.path("followers_count").asLong())
                : page.hasNonNull("fan_count") ? Long.valueOf(page.path("fan_count").asLong()) : null;
        ConnectOptionDTO pageDto = ConnectOptionDTO.builder()
                .externalId(pageId)
                .name(pageName)
                .subtitle("Facebook Page" + (pageFollowers != null ? " · " + formatCount(pageFollowers) + " followers" : ""))
                .kind(MarketingConstants.OPTION_KIND_FACEBOOK_PAGE)
                .selectable(selectable)
                .warning(warning)
                .build();
        ResolvedOption pageOption = new ResolvedOption(pageDto);
        pageOption.platform = MarketingConstants.PLATFORM_FACEBOOK;
        pageOption.pageToken = pageToken;
        pageOption.followers = pageFollowers;
        pageOption.avatarUrl = textOrNull(page.path("picture").path("data"), "url");
        out.add(pageOption);

        JsonNode ig = page.path("instagram_business_account");
        String igId = textOrNull(ig, "id");
        if (igId == null) return;
        String username = textOrNull(ig, "username");
        ConnectOptionDTO igDto = ConnectOptionDTO.builder()
                .externalId(igId)
                .name(textOr(ig, "name", username != null ? username : "Instagram " + igId))
                .subtitle((username != null ? "@" + username + " · " : "") + "linked to " + pageName)
                .kind(MarketingConstants.OPTION_KIND_INSTAGRAM)
                .selectable(selectable)
                .warning(warning)
                .build();
        ResolvedOption igOption = new ResolvedOption(igDto);
        igOption.platform = MarketingConstants.PLATFORM_INSTAGRAM;
        igOption.pageToken = pageToken;
        igOption.parentExternalId = pageId;
        igOption.handle = username != null ? "@" + username : null;
        igOption.followers = ig.hasNonNull("followers_count") ? ig.path("followers_count").asLong() : null;
        igOption.avatarUrl = textOrNull(ig, "profile_picture_url");
        out.add(igOption);
    }

    // Google Ads customers ───────────────────────────────────────────────────

    private List<ResolvedOption> googleAdsOptions(MarketingConnection connection) {
        if (!googleAdsApiClient.isConfigured()) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE, GoogleAdsApiClient.DEVELOPER_TOKEN_MISSING);
        }
        String token = googleOAuthTokenService.getAccessToken(connection);
        List<String> customerIds = googleAdsApiClient.listAccessibleCustomers(token);
        if (customerIds.size() > MAX_GOOGLE_CUSTOMERS) {
            log.info("Google user can reach {} customers; listing the first {}", customerIds.size(), MAX_GOOGLE_CUSTOMERS);
            customerIds = customerIds.subList(0, MAX_GOOGLE_CUSTOMERS);
        }

        Map<String, ResolvedOption> byId = new LinkedHashMap<>();
        for (String customerId : customerIds) {
            JsonNode customer;
            try {
                List<JsonNode> rows = googleAdsApiClient.search(customerId, null, GOOGLE_CUSTOMER_QUERY, token);
                customer = rows.isEmpty() ? null : rows.get(0).path("customer");
            } catch (MarketingApiException e) {
                if (isAccountWideGoogleAdsError(e)) throw e;
                byId.putIfAbsent(customerId, googleAdsOption(customerId, "Google Ads account " + formatCustomerId(customerId),
                        null, null, null, false, e.getMessage(), MarketingConstants.OPTION_KIND_AD_ACCOUNT, null));
                continue;
            }
            if (customer == null || customer.isMissingNode()) continue;

            String name = textOr(customer, "descriptiveName", "Google Ads account " + formatCustomerId(customerId));
            if (customer.path("manager").asBoolean(false)) {
                ResolvedOption manager = googleAdsOption(customerId, name, textOrNull(customer, "currencyCode"),
                        textOrNull(customer, "timeZone"), null, false,
                        "Manager account. Pick the client accounts below.",
                        MarketingConstants.OPTION_KIND_MANAGER_ACCOUNT, null);
                byId.putIfAbsent(customerId, manager);
                try {
                    for (JsonNode row : googleAdsApiClient.search(customerId, customerId, GOOGLE_CLIENT_QUERY, token)) {
                        JsonNode client = row.path("customerClient");
                        String clientId = GoogleAdsApiClient.digits(client.path("id").asText(""));
                        if (clientId.isEmpty() || clientId.equals(customerId)) continue;
                        boolean enabled = isEnabled(client);
                        byId.putIfAbsent(clientId, googleAdsOption(clientId,
                                textOr(client, "descriptiveName", "Google Ads account " + formatCustomerId(clientId)),
                                textOrNull(client, "currencyCode"), textOrNull(client, "timeZone"), customerId,
                                enabled, enabled ? null : "Account is not active",
                                MarketingConstants.OPTION_KIND_AD_ACCOUNT, name));
                    }
                } catch (MarketingApiException e) {
                    if (isAccountWideGoogleAdsError(e)) throw e;
                    manager.dto.setWarning("Could not list this manager's accounts: " + e.getMessage());
                }
            } else {
                boolean enabled = isEnabled(customer);
                String warning = !enabled ? "Account is not active"
                        : customer.path("testAccount").asBoolean(false) ? "Test account (no real spend)" : null;
                // A directly reachable account beats the same account reached through a manager.
                byId.put(customerId, googleAdsOption(customerId, name, textOrNull(customer, "currencyCode"),
                        textOrNull(customer, "timeZone"), null, enabled, warning,
                        MarketingConstants.OPTION_KIND_AD_ACCOUNT, null));
            }
        }
        return new ArrayList<>(byId.values());
    }

    private ResolvedOption googleAdsOption(String customerId, String name, String currency, String timeZone,
                                           String loginCustomerId, boolean selectable, String warning,
                                           String kind, String managerName) {
        StringBuilder subtitle = new StringBuilder(formatCustomerId(customerId));
        if (currency != null) subtitle.append(" · ").append(currency);
        if (managerName != null) subtitle.append(" · via ").append(managerName);
        ConnectOptionDTO dto = ConnectOptionDTO.builder()
                .externalId(customerId)
                .name(name)
                .subtitle(subtitle.toString())
                .kind(kind)
                .currency(currency)
                .timeZone(timeZone)
                .loginCustomerId(loginCustomerId)
                .selectable(selectable)
                .warning(warning)
                .build();
        ResolvedOption option = new ResolvedOption(dto);
        option.platform = MarketingConstants.PLATFORM_GOOGLE;
        return option;
    }

    /** Errors that are about the token / developer token / project, not one customer: show them as-is. */
    private static boolean isAccountWideGoogleAdsError(MarketingApiException e) {
        String code = e.getPlatformCode() == null ? "" : e.getPlatformCode();
        return (e.isAuthError() && !"USER_PERMISSION_DENIED".equals(code))
                || code.contains("DEVELOPER_TOKEN")
                || code.contains("NOT_APPROVED")
                || code.contains("PROJECT");
    }

    private static boolean isEnabled(JsonNode customerOrClient) {
        String status = customerOrClient.path("status").asText("");
        return status.isBlank() || "ENABLED".equals(status);
    }

    // Google Business Profile locations ──────────────────────────────────────

    private List<ResolvedOption> googleBusinessOptions(MarketingConnection connection) {
        String token = googleOAuthTokenService.getAccessToken(connection);
        List<JsonNode> accounts = new ArrayList<>();
        String pageToken = null;
        int fetched = 0;
        do {
            String url = GBP_ACCOUNTS_URL + "?pageSize=20"
                    + (pageToken != null ? "&pageToken=" + MarketingHttp.enc(pageToken) : "");
            JsonNode response = googleApiClient.get(url, token);
            for (JsonNode account : response.path("accounts")) accounts.add(account);
            pageToken = textOrNull(response, "nextPageToken");
            fetched++;
        } while (pageToken != null && fetched < MAX_GBP_PAGES && accounts.size() < MAX_GBP_ACCOUNTS);

        Map<String, ResolvedOption> byId = new LinkedHashMap<>();
        MarketingApiException firstError = null;
        for (JsonNode account : accounts.subList(0, Math.min(accounts.size(), MAX_GBP_ACCOUNTS))) {
            String accountName = textOrNull(account, "name");
            if (accountName == null) continue;
            String locationsPage = null;
            int pages = 0;
            try {
                do {
                    String url = GBP_INFO_BASE + accountName + "/locations?readMask="
                            + MarketingHttp.enc("name,title,storefrontAddress,metadata") + "&pageSize=100"
                            + (locationsPage != null ? "&pageToken=" + MarketingHttp.enc(locationsPage) : "");
                    JsonNode response = googleApiClient.get(url, token);
                    for (JsonNode location : response.path("locations")) {
                        ResolvedOption option = gbpOption(location, accountName);
                        if (option != null) byId.putIfAbsent(option.dto.getExternalId(), option);
                    }
                    locationsPage = textOrNull(response, "nextPageToken");
                    pages++;
                } while (locationsPage != null && pages < MAX_GBP_PAGES);
            } catch (MarketingApiException e) {
                if (e.isAuthError()) throw e;
                if (firstError == null) firstError = e;
                log.warn("Business Profile locations failed for {} ({})", accountName, e.getPlatformCode());
            }
        }
        if (byId.isEmpty() && firstError != null) throw firstError;
        return new ArrayList<>(byId.values());
    }

    private ResolvedOption gbpOption(JsonNode location, String accountName) {
        String name = textOrNull(location, "name");
        if (name == null) return null;
        String title = textOr(location, "title", name);
        String locality = textOrNull(location.path("storefrontAddress"), "locality");
        JsonNode metadata = location.path("metadata");
        // Google's JSON drops false booleans, so a missing field means false (unverified,
        // suspended or duplicate listings). canOperateLocalPost is the field that governs posting.
        boolean canPost = metadata.path("canOperateLocalPost").asBoolean(false)
                || metadata.path("hasVoiceOfMerchant").asBoolean(false);
        ConnectOptionDTO dto = ConnectOptionDTO.builder()
                .externalId(name)
                .name(title)
                .subtitle(locality != null ? locality : "Google Business Profile")
                .kind(MarketingConstants.OPTION_KIND_GBP_LOCATION)
                .selectable(canPost)
                .warning(canPost ? null
                        : "This location isn't verified (or can't post) on Google yet. Verify it in Business Profile first")
                .build();
        ResolvedOption option = new ResolvedOption(dto);
        option.platform = MarketingConstants.PLATFORM_GOOGLE_BUSINESS;
        option.parentExternalId = accountName;
        return option;
    }

    // ── Small helpers ────────────────────────────────────────────────────────

    private static String textOrNull(JsonNode node, String field) {
        if (node == null) return null;
        String value = node.path(field).asText(null);
        return value == null || value.isBlank() ? null : value;
    }

    private static String textOr(JsonNode node, String field, String fallback) {
        String value = textOrNull(node, field);
        return value != null ? value : fallback;
    }

    private static String formatCustomerId(String id) {
        String digits = GoogleAdsApiClient.digits(id);
        if (digits.length() != 10) return digits;
        return digits.substring(0, 3) + "-" + digits.substring(3, 6) + "-" + digits.substring(6);
    }

    private static String formatCount(long count) {
        return String.format(java.util.Locale.ENGLISH, "%,d", count);
    }
}
