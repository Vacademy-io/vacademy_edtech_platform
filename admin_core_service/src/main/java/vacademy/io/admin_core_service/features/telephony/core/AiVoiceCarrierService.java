package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.telephony.controller.dto.AiVoiceCarrierDTO;
import vacademy.io.admin_core_service.features.telephony.controller.dto.AiVoiceCarrierViewDTO;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.admin_core_service.features.telephony.spi.TelephonyProviderDescriptor;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Chooses and stores the line Vacademy AI calls go out on.
 *
 * <p>AI calling is a media application on Plivo — the bot only ever receives audio
 * through Plivo's {@code <Stream>}. Institutes whose team calls over Vacademy Voice
 * already have such a line and share it; institutes on Airtel IQ or Exotel do not,
 * and before V448 simply could not place an AI call at all. This service is how they
 * link a Plivo subaccount used ONLY by the AI, stored as a second
 * {@code institute_telephony_config} row with {@code role=AI_VOICE}.
 *
 * <h3>Why it is safe next to live calling</h3>
 * <ul>
 *   <li>The dedicated row is a SEPARATE row. Every human-calling path resolves
 *       {@code role=PRIMARY} explicitly, so linking, editing or deleting an AI line
 *       cannot touch the provider a team is dialling on right now.</li>
 *   <li>Its caller-ID lives on the config ({@code provider_config.callerId}), NOT as a
 *       {@code telephony_provider_number}. Adding one therefore cannot alter the
 *       institute's number pool, its Numbers card, or the inbound DID lookup that
 *       attributes incoming calls.</li>
 *   <li>Removing the line is non-destructive: AI simply falls back to the primary
 *       provider — the pre-V448 behaviour.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class AiVoiceCarrierService {

    private static final Logger log = LoggerFactory.getLogger(AiVoiceCarrierService.class);

    /** Share the account the institute's humans call on. */
    public static final String MODE_PRIMARY = "PRIMARY";
    /** A Plivo subaccount used only by the AI. */
    public static final String MODE_DEDICATED = "DEDICATED";

    /**
     * {@code provider_config} key marking a line WE set up on the platform's own Plivo account
     * (a Telleo trial line). The customer may use it but not edit, unlink or read its account
     * id: on a shared account, a free-text caller-ID would let them call out as any number on
     * that account, another customer's included.
     */
    public static final String PLATFORM_MANAGED_KEY = "platformManaged";
    public static final String PLATFORM_MANAGED_MESSAGE =
            "This calling line is managed by Telleo, so it can't be changed here. Contact Telleo support to change it.";

    private final InstituteTelephonyConfigRepository repo;
    private final TelephonyConfigCache configCache;
    private final TelephonyProviderRegistry registry;
    private final TokenEncryptionService tokenEncryption;

    // ── Read ────────────────────────────────────────────────────────────────────

    public AiVoiceCarrierViewDTO view(String instituteId) {
        InstituteTelephonyConfig primary = repo.findPrimaryByInstituteId(instituteId).orElse(null);
        InstituteTelephonyConfig ai = repo.findAiVoiceByInstituteId(instituteId).orElse(null);

        String primaryType = primary == null ? null : primary.getProviderType();
        boolean primaryCanCarryAi = ProviderType.PLIVO.equals(primaryType)
                && Boolean.TRUE.equals(primary.getEnabled());
        boolean dedicatedActive = ai != null && Boolean.TRUE.equals(ai.getEnabled());

        Map<String, String> aiConfig = ai == null
                ? Map.of() : TelephonyJson.read(ai.getProviderConfig());
        boolean managed = isPlatformManaged(aiConfig);

        AiVoiceCarrierViewDTO.AiVoiceCarrierViewDTOBuilder out = AiVoiceCarrierViewDTO.builder()
                .mode(ai != null ? MODE_DEDICATED : MODE_PRIMARY)
                .primaryProviderType(primaryType)
                .primaryProviderName(displayName(primaryType))
                .primaryCanCarryAi(primaryCanCarryAi)
                .dedicatedConfigured(ai != null)
                .dedicatedEnabled(dedicatedActive)
                .platformManaged(managed)
                // The platform account's id is not the customer's to see.
                .authId(managed ? null : aiConfig.get("authId"))
                .appId(managed ? null : aiConfig.get("appId"))
                .callerId(aiConfig.get("callerId"))
                .authTokenSet(ai != null && notBlank(ai.getProviderSecretsEnc()))
                .webhookTokenSet(ai != null && notBlank(ai.getWebhookTokenEnc()))
                .recordCalls(ai == null ? null : ai.getRecordCalls())
                .updatedAt(ai == null || ai.getUpdatedAt() == null ? null : ai.getUpdatedAt().toString());

        // Mirror exactly what VacademyAiOutboundCaller will do at dial time, so the card
        // never says "ready" for a setup that would throw on the first click.
        if (dedicatedActive) {
            String callerId = aiConfig.get("callerId");
            out.effectiveProviderType(ProviderType.PLIVO);
            if (!notBlank(aiConfig.get("authId")) || !notBlank(ai.getProviderSecretsEnc())) {
                out.ready(false).blockingReason("This AI calling line is missing its Plivo credentials.");
            } else if (!notBlank(callerId)) {
                out.ready(false).blockingReason("This AI calling line has no caller-ID number set.");
            } else {
                out.ready(true);
            }
        } else if (primaryCanCarryAi) {
            // A paused line is fine here — AI simply falls back to the primary, which can
            // carry it. Nothing is broken, so nothing is reported.
            out.effectiveProviderType(ProviderType.PLIVO).ready(true);
        } else if (ai != null) {
            // Paused line AND a primary that can't carry AI. Say THAT, rather than the
            // generic "link a line" message below — they already have one, it's just off,
            // and telling them to link another is a dead end.
            out.ready(false).blockingReason(primaryType == null
                    ? "Your AI calling line is turned off. Turn it back on to resume AI calls."
                    : "Your AI calling line is turned off, and your team's provider ("
                      + displayName(primaryType) + ") can't carry an AI conversation on its own. "
                      + "Turn the line back on to resume AI calls.");
        } else if (primaryType == null) {
            out.ready(false).blockingReason(
                    "No calling provider is set up for this institute yet.");
        } else {
            out.ready(false).blockingReason(
                    "Your team calls on " + displayName(primaryType) + ", which can't carry an AI "
                    + "conversation. Link a dedicated Vacademy Voice line for AI calls — your "
                    + "team's calling is unaffected.");
        }
        return out.build();
    }

    // ── Write ───────────────────────────────────────────────────────────────────

    @Transactional
    public AiVoiceCarrierViewDTO save(String instituteId, AiVoiceCarrierDTO body) {
        requireNotPlatformManaged(instituteId);
        String mode = body.getMode() == null ? "" : body.getMode().trim().toUpperCase();
        if (MODE_PRIMARY.equals(mode)) {
            return unlink(instituteId);
        }
        if (!MODE_DEDICATED.equals(mode)) {
            throw new VacademyException("mode must be PRIMARY or DEDICATED");
        }
        if (!registry.isSupported(ProviderType.PLIVO)) {
            throw new VacademyException(
                    "Vacademy Voice is not available on this server, so a dedicated AI line "
                    + "cannot be linked.");
        }

        Optional<InstituteTelephonyConfig> existing = repo.findAiVoiceByInstituteId(instituteId);
        boolean isCreate = existing.isEmpty();
        InstituteTelephonyConfig cfg = existing.orElseGet(InstituteTelephonyConfig::new);

        // These four are structural, not user choices: an AI line is always a PLIVO row
        // in the AI_VOICE role for THIS institute, authenticated with Basic. Setting them
        // on every save (not just create) heals a hand-seeded row.
        cfg.setInstituteId(instituteId);
        cfg.setRole(ConfigRole.AI_VOICE);
        cfg.setProviderType(ProviderType.PLIVO);
        cfg.setAuthType(descriptorAuthType());

        Map<String, String> config = new LinkedHashMap<>(TelephonyJson.read(cfg.getProviderConfig()));
        if (body.getAuthId() != null) config.put("authId", body.getAuthId().trim());
        if (body.getAppId() != null) putOrRemove(config, "appId", body.getAppId());
        if (body.getCallerId() != null) putOrRemove(config, "callerId", normalizeCallerId(body.getCallerId()));

        // Blank secret = "leave the stored one alone" — the form never echoes it back, so
        // treating blank as a clear would silently unlink the line on every re-save.
        if (notBlank(body.getAuthToken())) {
            cfg.setProviderSecretsEnc(tokenEncryption.encrypt(
                    TelephonyJson.write(Map.of("authToken", body.getAuthToken().trim()))));
        }
        if (notBlank(body.getWebhookToken())) {
            cfg.setWebhookTokenEnc(tokenEncryption.encrypt(body.getWebhookToken().trim()));
        }

        if (isCreate) {
            requireNonBlank(config.get("authId"), "Plivo Auth ID is required");
            requireNonBlank(cfg.getProviderSecretsEnc(), "Plivo Auth Token is required");
            requireNonBlank(config.get("callerId"),
                    "A caller-ID number is required — it's the number leads will see.");
            cfg.setRecordCalls(body.getRecordCalls() == null ? Boolean.TRUE : body.getRecordCalls());
            cfg.setEnabled(body.getEnabled() == null ? Boolean.TRUE : body.getEnabled());
            // Not used by the AI path (single-leg, one caller-ID) but NOT NULL in the table.
            cfg.setDefaultSelectorKey("STICKY_PER_LEAD");
        } else {
            if (body.getRecordCalls() != null) cfg.setRecordCalls(body.getRecordCalls());
            if (body.getEnabled() != null) cfg.setEnabled(body.getEnabled());
        }
        cfg.setProviderConfig(TelephonyJson.write(config));

        repo.save(cfg);
        evictAfterCommit(instituteId);
        log.info("ai carrier: institute {} linked to a dedicated Vacademy Voice line (create={}, enabled={})",
                instituteId, isCreate, cfg.getEnabled());
        return view(instituteId);
    }

    /**
     * Drop the dedicated line — AI calls go back to the institute's primary provider.
     * Deliberately a hard delete of a row that holds nothing but credentials: keeping a
     * disabled shell around would leave a stale Plivo token encrypted at rest for a line
     * nobody uses. Call logs reference the PROVIDER, never this row, so history is intact.
     */
    @Transactional
    public AiVoiceCarrierViewDTO unlink(String instituteId) {
        requireNotPlatformManaged(instituteId);
        repo.findAiVoiceByInstituteId(instituteId).ifPresent(cfg -> {
            repo.delete(cfg);
            log.info("ai carrier: institute {} unlinked its dedicated AI line — "
                    + "AI calls now use the primary provider", instituteId);
        });
        evictAfterCommit(instituteId);
        return view(instituteId);
    }

    // ── Platform-managed lines ──────────────────────────────────────────────────

    public static boolean isPlatformManaged(Map<String, String> providerConfig) {
        return providerConfig != null && "true".equalsIgnoreCase(providerConfig.get(PLATFORM_MANAGED_KEY));
    }

    /** True when this institute's AI line was set up by us on the platform's account. */
    public boolean isPlatformManaged(String instituteId) {
        return repo.findAiVoiceByInstituteId(instituteId)
                .map(cfg -> isPlatformManaged(TelephonyJson.read(cfg.getProviderConfig())))
                .orElse(false);
    }

    private void requireNotPlatformManaged(String instituteId) {
        if (isPlatformManaged(instituteId)) {
            throw new VacademyException(org.springframework.http.HttpStatus.FORBIDDEN, PLATFORM_MANAGED_MESSAGE);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    /** Evict AFTER commit — evicting earlier lets a concurrent dial re-cache the old row. */
    private void evictAfterCommit(String instituteId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { configCache.evict(instituteId); }
            });
        } else {
            configCache.evict(instituteId);
        }
    }

    private String descriptorAuthType() {
        return registry.descriptor(ProviderType.PLIVO)
                .map(TelephonyProviderDescriptor::authType).orElse("BASIC");
    }

    private String displayName(String providerType) {
        if (providerType == null) return null;
        return registry.descriptor(providerType)
                .map(TelephonyProviderDescriptor::displayName).orElse(providerType);
    }

    /**
     * Plivo bars a call whose destination or caller-ID lacks a country code, so store the
     * number the way the dialer needs it. Mirrors VacademyAiOutboundCaller#toE164.
     */
    static String normalizeCallerId(String raw) {
        if (raw == null) return null;
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return "";
        if (digits.length() == 10) return "+91" + digits;
        if (digits.length() == 11 && digits.startsWith("0")) return "+91" + digits.substring(1);
        return "+" + digits;
    }

    private static void putOrRemove(Map<String, String> map, String key, String value) {
        if (value == null || value.isBlank()) map.remove(key);
        else map.put(key, value.trim());
    }

    private static void requireNonBlank(String s, String message) {
        if (!notBlank(s)) throw new VacademyException(message);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
