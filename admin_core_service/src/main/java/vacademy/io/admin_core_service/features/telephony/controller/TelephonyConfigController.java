package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyConfigDTO;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyConfigViewDTO;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyJson;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyProviderRegistry;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.SelectorStrategy;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.admin_core_service.features.telephony.spi.TelephonyProviderDescriptor;
import vacademy.io.admin_core_service.features.telephony.spi.dto.CredentialField;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@RestController
@RequestMapping("/admin-core-service/v1/telephony/config")
public class TelephonyConfigController {

    private static final Set<String> KNOWN_STRATEGIES = Set.of(
            SelectorStrategy.STICKY_PER_LEAD,
            SelectorStrategy.ROUND_ROBIN,
            SelectorStrategy.REGION_MATCH);

    @Autowired private InstituteTelephonyConfigRepository repo;
    @Autowired private TokenEncryptionService tokenEncryption;
    @Autowired private TelephonyConfigCache configCache;
    @Autowired private TelephonyProviderRegistry registry;

    /** Public base URL providers hit for webhooks. Renders into the Setup
     *  Guide on the frontend so the admin sees the exact copy-paste URL. */
    @Value("${telephony.webhook.callback-base:}")
    private String webhookCallbackBase;

    @GetMapping("/{instituteId}")
    public ResponseEntity<TelephonyConfigViewDTO> get(@PathVariable String instituteId) {
        return repo.findPrimaryByInstituteId(instituteId)
                .map(c -> {
                    TelephonyConfigViewDTO dto = TelephonyConfigViewDTO.from(c);
                    dto.setWebhookCallbackBase(webhookCallbackBase);
                    return ResponseEntity.ok(dto);
                })
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PutMapping("/{instituteId}")
    @Transactional
    @Auditable(
            entityType = "TELEPHONY_CONFIG",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            // The body carries provider API tokens; REDACTED masks the usual
            // key names but not every provider's, so capture nothing.
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'updated calling settings' + (#body?.providerType != null "
                    + "? ' (provider ' + #body.providerType + ')' : '')")
    public ResponseEntity<TelephonyConfigViewDTO> upsert(
            @PathVariable String instituteId,
            @RequestBody TelephonyConfigDTO body,
            @RequestAttribute("user") CustomUserDetails user) {
        if (body.getProviderType() == null || body.getProviderType().isBlank()) {
            throw new VacademyException("providerType is required");
        }
        // Normalise to the canonical (uppercase) key the registry + the inbound/
        // webhook lookups use, and reject providers this server has no adapter for.
        String providerType = body.getProviderType().trim().toUpperCase();
        if (!registry.isSupported(providerType)) {
            throw new VacademyException("Telephony provider not available on this server: " + providerType);
        }
        if (body.getDefaultSelectorKey() != null
                && !KNOWN_STRATEGIES.contains(body.getDefaultSelectorKey())) {
            throw new VacademyException("Unknown selector strategy: " + body.getDefaultSelectorKey());
        }

        // This endpoint owns the PRIMARY row only — the provider the institute's humans
        // call on. The dedicated AI-calling line is a different row with its own
        // endpoint (AiVoiceCarrierController), so switching the human provider here can
        // never disturb AI calling and vice-versa.
        Optional<InstituteTelephonyConfig> existing = repo.findPrimaryByInstituteId(instituteId);
        boolean isCreate = existing.isEmpty();
        InstituteTelephonyConfig cfg = existing.orElseGet(InstituteTelephonyConfig::new);
        cfg.setInstituteId(instituteId);
        cfg.setRole(ConfigRole.PRIMARY);
        cfg.setProviderType(providerType);
        if (body.getApiAccountId() != null) cfg.setApiAccountId(body.getApiAccountId());

        // Credentials arrive in one of two styles:
        //  - Generic (Airtel/Vonage, future providers): a `secrets`/`config` map
        //    whose keys come from the provider's credentialSchema(). Validated
        //    against that schema and stored in the generic columns.
        //  - Legacy Exotel: apiAccountId + apiUsername + apiPassword (untouched).
        // On create the required fields must be present; on update blank means
        // "leave as-is" so admins don't wipe stored creds by re-saving the form.
        Optional<TelephonyProviderDescriptor> descriptor = registry.descriptor(providerType);
        // Legacy-store providers (Exotel) persist via the api_*_enc columns; every
        // other provider uses the generic provider_secrets_enc/provider_config
        // blob. Gating on this prevents a generic save from splitting an Exotel
        // row's creds across both stores (which would break ExotelHttpClient's reads).
        boolean genericStore = descriptor.map(TelephonyProviderDescriptor::usesGenericCredentialStore).orElse(true);

        if (isCreate) {
            if (genericStore && descriptor.isPresent()) {
                validateAgainstSchema(descriptor.get(), body);
            } else if (genericStore) {
                requireNonBlank(body.getAuthType(), "authType is required for a generic provider");
                if (body.getSecrets() == null || body.getSecrets().isEmpty()) {
                    throw new VacademyException("secrets are required on first save");
                }
            } else {
                // Legacy-store provider (Exotel): the HTTP-Basic triplet.
                requireNonBlank(body.getApiAccountId(), "apiAccountId is required on first save");
                requireNonBlank(body.getApiUsername(),  "apiUsername is required on first save");
                requireNonBlank(body.getApiPassword(),  "apiPassword is required on first save");
            }
        }

        // Legacy-store secrets (Exotel). No-ops for generic providers, which
        // don't send these fields.
        encryptIfPresent(body.getApiUsername(),  cfg::setApiUsernameEnc);
        encryptIfPresent(body.getApiPassword(),  cfg::setApiPasswordEnc);
        encryptIfPresent(body.getWebhookToken(), cfg::setWebhookTokenEnc);

        // auth_type — an explicit value wins; otherwise backfill from the
        // descriptor on ANY save (so legacy pre-V339 rows get a value too).
        if (body.getAuthType() != null && !body.getAuthType().isBlank()) {
            cfg.setAuthType(body.getAuthType());
        } else if (cfg.getAuthType() == null && descriptor.isPresent()) {
            cfg.setAuthType(descriptor.get().authType());
        }

        // Generic credential blob — only for providers that use it (never Exotel,
        // so an Exotel row's creds are never split across the two stores).
        if (genericStore) {
            if (body.getConfig() != null && !body.getConfig().isEmpty()) {
                // Merge per-key so a partial save doesn't clobber other config keys.
                Map<String, String> mergedConfig = TelephonyJson.read(cfg.getProviderConfig());
                body.getConfig().forEach((k, v) -> { if (v != null) mergedConfig.put(k, v); });
                cfg.setProviderConfig(TelephonyJson.write(mergedConfig));
            }
            if (body.getSecrets() != null && !body.getSecrets().isEmpty()) {
                // Merge per-key — a blank value leaves the stored secret unchanged.
                Map<String, String> mergedSecrets = (cfg.getProviderSecretsEnc() == null || cfg.getProviderSecretsEnc().isBlank())
                        ? new LinkedHashMap<>()
                        : TelephonyJson.read(tokenEncryption.decrypt(cfg.getProviderSecretsEnc()));
                body.getSecrets().forEach((k, v) -> { if (v != null && !v.isBlank()) mergedSecrets.put(k, v); });
                cfg.setProviderSecretsEnc(tokenEncryption.encrypt(TelephonyJson.write(mergedSecrets)));
            }
        }

        if (body.getRecordCalls()       != null) cfg.setRecordCalls(body.getRecordCalls());
        if (body.getDefaultSelectorKey() != null) cfg.setDefaultSelectorKey(body.getDefaultSelectorKey());
        if (body.getEnabled()           != null) cfg.setEnabled(body.getEnabled());
        // Voicemail: distinguish "leave as-is" (null) from "clear it" (blank)
        // so an admin can remove the fallback number explicitly.
        if (body.getInboundVoicemailNumber() != null) {
            String trimmed = body.getInboundVoicemailNumber().trim();
            cfg.setInboundVoicemailNumber(trimmed.isEmpty() ? null : trimmed);
        }
        // Flow SID: same as voicemail — blank clears, null leaves alone.
        if (body.getFlowSid() != null) {
            String trimmed = body.getFlowSid().trim();
            cfg.setFlowSid(trimmed.isEmpty() ? null : trimmed);
        }

        InstituteTelephonyConfig saved = repo.save(cfg);
        // Evict the hot-path cache AFTER this tx commits — evicting before commit
        // leaves a window where a concurrent webhook/connect reload re-caches the
        // OLD row. (Falls back to immediate evict if somehow non-transactional.)
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { configCache.evict(instituteId); }
            });
        } else {
            configCache.evict(instituteId);
        }
        TelephonyConfigViewDTO dto = TelephonyConfigViewDTO.from(saved);
        dto.setWebhookCallbackBase(webhookCallbackBase);
        return ResponseEntity.ok(dto);
    }

    private static void requireNonBlank(String s, String msg) {
        if (s == null || s.isBlank()) throw new VacademyException(msg);
    }

    /**
     * Validate the submitted generic credentials against the provider's declared
     * schema: every required field must be present (in {@code secrets} if it is a
     * secret field, else in {@code config}).
     */
    private static void validateAgainstSchema(TelephonyProviderDescriptor descriptor, TelephonyConfigDTO body) {
        Map<String, String> secrets = body.getSecrets() != null ? body.getSecrets() : Map.of();
        Map<String, String> config = body.getConfig() != null ? body.getConfig() : Map.of();
        for (CredentialField field : descriptor.credentialSchema()) {
            if (!field.isRequired()) continue;
            String value = field.isSecret() ? secrets.get(field.getKey()) : config.get(field.getKey());
            if (value == null || value.isBlank()) {
                throw new VacademyException(field.getLabel() + " is required");
            }
        }
    }

    private void encryptIfPresent(String plaintext, java.util.function.Consumer<String> setter) {
        if (plaintext == null || plaintext.isBlank()) return;
        setter.accept(tokenEncryption.encrypt(plaintext));
    }
}
