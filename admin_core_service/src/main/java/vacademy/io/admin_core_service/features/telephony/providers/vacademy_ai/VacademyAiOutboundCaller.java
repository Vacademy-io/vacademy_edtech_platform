package vacademy.io.admin_core_service.features.telephony.providers.vacademy_ai;

import vacademy.io.admin_core_service.features.telephony.core.PhoneNumbers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.VoiceCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.providers.plivo.PlivoHttpClient;
import vacademy.io.admin_core_service.features.telephony.spi.AiOutboundCaller;
import vacademy.io.admin_core_service.features.telephony.spi.dto.AiCallHandle;
import vacademy.io.admin_core_service.features.telephony.spi.dto.AiCallSpec;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * Vacademy AI Agent outbound dial: places a Plivo call on the institute's
 * Vacademy Voice subaccount whose {@code answer_url} is our own voice-bot
 * service. When the lead answers, the bot returns
 * {@code <Stream>wss://bot/ws?corr=..</Stream><Redirect>/plivo/ai-next</Redirect>}
 * and the conversation runs over the WebSocket. The end-of-call report comes
 * back through the generic {@code /webhook/ai-voice/VACADEMY_AI} receiver, so
 * the whole existing outcome pipeline (classify → assign/stop/retry → workflow
 * resume) is reused unchanged.
 *
 * <p>Requires a Plivo line, because the bot only gets audio through Plivo's
 * {@code <Stream>}. That line is resolved by
 * {@link TelephonyConfigCache#getForAi} and is EITHER the institute's primary
 * provider (when it's already Vacademy Voice) OR a dedicated {@code AI_VOICE}
 * config — so an institute whose humans call over Airtel/Exotel can still run AI
 * calling on a separate Plivo subaccount without changing anything about how its
 * team dials. See {@code ConfigRole}.
 */
@Component
public class VacademyAiOutboundCaller implements AiOutboundCaller {

    private static final Logger log = LoggerFactory.getLogger(VacademyAiOutboundCaller.class);

    @Autowired private PlivoHttpClient plivoHttpClient;
    @Autowired private TelephonyConfigCache configCache;
    @Autowired private VoiceCallingSettingsService voiceSettings;
    @Autowired private VacademyAiAnswerUrls answerUrls;

    @Override
    public String providerType() {
        return ProviderType.VACADEMY_AI;
    }

    @Override
    public AiCallHandle placeCall(AiCallSpec spec) {
        if (!answerUrls.isConfigured()) {
            throw new VacademyException(
                    "Vacademy AI is not configured on this server (telephony.vacademy-ai.bot-base-url)");
        }
        // The AI carrier, NOT necessarily the institute's human calling provider: a
        // dedicated AI_VOICE config when one exists, else the primary (which is what an
        // institute already on Vacademy Voice resolves to, exactly as before V448).
        TelephonyConfigCache.Resolved resolved = configCache.getForAi(spec.getInstituteId())
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()))
                .orElseThrow(() -> new VacademyException(
                        "Calling is not configured for this institute"));
        if (!ProviderType.PLIVO.equals(resolved.getConfig().getProviderType())) {
            // Reachable only when the institute has no dedicated AI line and its primary
            // provider cannot carry media (Airtel IQ, Exotel — no <Stream> equivalent).
            // Name the fix, because "not supported" sent admins hunting in the wrong place.
            throw new VacademyException(
                    "AI calling runs over a Vacademy Voice (Plivo) line, and this institute's "
                    + "calling provider is " + resolved.getConfig().getProviderType()
                    + ", which cannot carry an AI conversation. Add a dedicated AI calling line "
                    + "in Settings → Calling → AI calling line — your team's calling stays on "
                    + resolved.getConfig().getProviderType() + ".");
        }

        String callerId = resolveCallerId(spec.getInstituteId(), resolved, spec.getPreferredNumberId());
        if (callerId == null || callerId.isBlank()) {
            throw new VacademyException(resolved.isDedicatedAiCarrier()
                    ? "No caller-ID number is set on this institute's AI calling line"
                    : "No Vacademy Voice number is configured for this institute");
        }

        // Terminal + recording events flow through the standard status webhook; the row
        // is matched by corr and TelephonyWebhookController resolves the PLIVO handler
        // from the CALL's provider (VACADEMY_AI ⇒ Plivo), not from the institute's
        // config — so these callbacks land even when the institute's humans are on
        // Airtel. Full-session recording is requested by the BOT's
        // answer XML (<Record recordSession="true">) — Plivo's Call-create API has
        // no reliable record param — so the answer URL carries the callback (rcb),
        // and nxt (post-stream handoff <Dial> or hangup) carries the webhook token,
        // keeping the bot's /answer stateless. Shared with the IVR AI_AGENT node.
        boolean record = Boolean.TRUE.equals(resolved.getConfig().getRecordCalls());
        String answerUrl = answerUrls.answerUrl(spec.getCorrelationId(), spec.getCampaignId(),
                spec.getInstituteId(), resolved.getWebhookToken(), record);
        String hangupUrl = answerUrls.statusBase(resolved.getWebhookToken(), spec.getCorrelationId())
                + "&plivoEvent=hangup";

        // Plivo needs a full E.164 destination. A bare 10-digit lead number (many leads
        // are stored without the country code) is parsed by Plivo as some other region's
        // prefix → 403 "Calls to this destination region are barred". Normalise the same
        // way the Airtel adapter does before dialing.
        String dialTo = PhoneNumbers.toE164(spec.getPhoneNumber());
        if (dialTo == null) {
            throw new VacademyException("Lead has no valid phone number to dial");
        }

        // Recording rides on the bot's answer XML (<Record recordSession>), never the
        // create API — which has no record argument at all.
        Map<String, Object> resp = plivoHttpClient.createCall(
                resolved.getCredentials(), callerId, dialTo,
                answerUrl, hangupUrl, null, "40");

        String requestUuid = resp == null ? null : asString(resp.get("request_uuid"));
        log.info("vacademy-ai: dialed corr={} inst={} agent={} requestUuid={}",
                spec.getCorrelationId(), spec.getInstituteId(), spec.getCampaignId(), requestUuid);
        return AiCallHandle.builder()
                .providerCallId(requestUuid)
                .accepted(true)
                .message("queued")
                .build();
    }

    private String resolveCallerId(String instituteId, TelephonyConfigCache.Resolved resolved,
                                   String preferredNumberId) {
        // A DEDICATED AI line has exactly one caller-ID, stored on the config itself, and
        // it is the only correct answer: the institute's number pool and its Vacademy
        // Voice settings both describe the PRIMARY provider — a different Plivo account
        // entirely (or Airtel), so dialling from either would be rejected by the carrier
        // or would leak the wrong number. Return early; do not fall through.
        if (resolved.isDedicatedAiCarrier()) {
            return resolved.getAiCallerId();
        }
        // Explicit pick from the AI-call chooser wins — but only if it's an ENABLED number of
        // THIS institute (so a stale/forged id can't dial from someone else's number); on a
        // miss we fall through to the institute default rather than fail the call.
        if (preferredNumberId != null && !preferredNumberId.isBlank()) {
            String picked = resolved.getEnabledNumbers().stream()
                    .filter(n -> Boolean.TRUE.equals(n.getEnabled()))
                    .filter(n -> preferredNumberId.equals(n.getId()))
                    .map(n -> n.getPhoneNumber())
                    .filter(p -> p != null && !p.isBlank())
                    .findFirst().orElse(null);
            if (picked != null) return picked.trim();
        }
        String fromSettings = voiceSettings.get(instituteId).getDefaultCallerId();
        if (fromSettings != null && !fromSettings.isBlank()) return fromSettings.trim();
        // Lowest priority value wins — same convention as PlivoOriginationResolver.
        return resolved.getEnabledNumbers().stream()
                .filter(n -> Boolean.TRUE.equals(n.getEnabled()))
                .min(java.util.Comparator.comparingInt(
                        n -> n.getPriority() == null ? Integer.MAX_VALUE : n.getPriority()))
                .map(n -> n.getPhoneNumber())
                .orElse(null);
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }

}
