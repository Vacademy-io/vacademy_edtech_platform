package vacademy.io.admin_core_service.features.telleo.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.telephony.core.AiVoiceCarrierService;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyJson;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Gives a new Telleo trial the shared, outbound-only trial line.
 *
 * <p>The line is an {@code AI_VOICE} config row, the shape Telleo's own AI lines already run on.
 * Its Plivo credentials are copied, still encrypted, from the institute named by
 * {@code telleo.trial-line.source-institute-id} (Telleo's own workspace, which owns the number);
 * they never pass through a request. The row is marked platform-managed, so the customer cannot
 * edit or unlink it or read its account id ({@link AiVoiceCarrierService}).
 *
 * <p>No {@code telephony_provider_number} row is written: the number is the caller-ID only, so it
 * cannot collide with the inbound lookup that matches on the last 10 digits. Callbacks to the
 * number keep reaching Telleo's own agent.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TelleoLineService {

    private final InstituteTelephonyConfigRepository repo;
    private final TelephonyConfigCache configCache;

    /** The workspace whose Plivo line trials share. Blank = trial lines cannot be attached. */
    @Value("${telleo.trial-line.source-institute-id:}")
    private String sourceInstituteId;

    /** The caller-ID trials call from: Telleo's live test line (PRODUCT_FACTS.md). */
    @Value("${telleo.trial-line.caller-id:+918035614126}")
    private String trialCallerId;

    /**
     * Attaches the trial line. Idempotent: a platform-managed line already there is kept, and an
     * institute that somehow has its own line is never overwritten.
     *
     * @throws IllegalStateException when the source line is not configured; onboarding records it
     *                               as the step's error and the step can be retried later.
     */
    @Transactional
    public void attachTrialLine(String instituteId) {
        Optional<InstituteTelephonyConfig> existing = repo.findAiVoiceByInstituteId(instituteId);
        if (existing.isPresent()) {
            if (!AiVoiceCarrierService.isPlatformManaged(TelephonyJson.read(existing.get().getProviderConfig()))) {
                log.warn("[telleo] institute {} already has its own AI line; trial line not attached", instituteId);
            }
            return;
        }
        InstituteTelephonyConfig source = sourceLine();
        Map<String, String> sourceConfig = TelephonyJson.read(source.getProviderConfig());

        Map<String, String> config = new LinkedHashMap<>();
        config.put("authId", sourceConfig.get("authId"));
        if (sourceConfig.get("appId") != null) config.put("appId", sourceConfig.get("appId"));
        config.put("callerId", trialCallerId.trim());
        config.put(AiVoiceCarrierService.PLATFORM_MANAGED_KEY, "true");

        InstituteTelephonyConfig cfg = new InstituteTelephonyConfig();
        cfg.setInstituteId(instituteId);
        cfg.setRole(ConfigRole.AI_VOICE);
        cfg.setProviderType(ProviderType.PLIVO);
        cfg.setAuthType(source.getAuthType() == null ? "BASIC" : source.getAuthType());
        cfg.setProviderSecretsEnc(source.getProviderSecretsEnc());
        cfg.setWebhookTokenEnc(source.getWebhookTokenEnc());
        cfg.setProviderConfig(TelephonyJson.write(config));
        cfg.setRecordCalls(Boolean.TRUE);
        cfg.setEnabled(Boolean.TRUE);
        cfg.setDefaultSelectorKey("STICKY_PER_LEAD");
        repo.save(cfg);
        evictAfterCommit(instituteId);
        log.info("[telleo] trial line attached to institute {}", instituteId);
    }

    /** The source institute's AI line, or its primary line when that is Plivo. */
    private InstituteTelephonyConfig sourceLine() {
        if (sourceInstituteId == null || sourceInstituteId.isBlank()) {
            throw new IllegalStateException("The Telleo trial line is not configured on this server "
                    + "(telleo.trial-line.source-institute-id).");
        }
        String id = sourceInstituteId.trim();
        return repo.findAiVoiceByInstituteId(id)
                .or(() -> repo.findPrimaryByInstituteId(id).filter(c -> ProviderType.PLIVO.equals(c.getProviderType())))
                .filter(c -> c.getProviderSecretsEnc() != null && !c.getProviderSecretsEnc().isBlank())
                .filter(c -> TelephonyJson.read(c.getProviderConfig()).get("authId") != null)
                .orElseThrow(() -> new IllegalStateException(
                        "The Telleo trial line's source institute has no Plivo line with credentials."));
    }

    private void evictAfterCommit(String instituteId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    configCache.evict(instituteId);
                }
            });
        } else {
            configCache.evict(instituteId);
        }
    }
}
