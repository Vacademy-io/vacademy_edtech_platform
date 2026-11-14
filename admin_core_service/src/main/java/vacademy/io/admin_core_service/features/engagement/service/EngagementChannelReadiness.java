package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Whether each engine channel is set up for the institute, so the wizard can say so while the
 * engine is being built instead of the first send failing days later. Reads the institute's
 * settings JSON only: no credentials leave this class.
 * <ul>
 *   <li>WHATSAPP: the active provider (WHATSAPP_SETTING.data.UTILITY_WHATSAPP) has its key.</li>
 *   <li>EMAIL: the institute has its own sender (EMAIL_SETTING.data). Without one, mail would
 *       leave as the platform's default support address, which is not outreach from the institute.
 *       The engine's chosen sender (channels.EMAIL.emailType, UTILITY_EMAIL when unset) must exist
 *       and not be marked unverified — notification_service sends an unverified sender's mail from
 *       the support address too.</li>
 *   <li>AI_CALL: AI calling has an agent (AI_CALLING_SETTING campaigns or defaultCampaignId).</li>
 *   <li>IN_APP: always ready.</li>
 * </ul>
 * A setting that can't be read counts as ready: this check must never block an institute whose
 * sends work.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementChannelReadiness {

    public static final String NOT_SET_UP = "NOT_SET_UP";
    public static final String SENDER_MISSING = "SENDER_MISSING";
    public static final String SENDER_NOT_VERIFIED = "SENDER_NOT_VERIFIED";

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * reason is null when ready; NOT_SET_UP, SENDER_MISSING (the chosen email sender is gone) or
     * SENDER_NOT_VERIFIED (the chosen sender's SES verification isn't done).
     */
    public record Readiness(boolean ready, String reason) {
        static Readiness ok() {
            return new Readiness(true, null);
        }
    }

    /**
     * One of the institute's email senders (a node of EMAIL_SETTING.data), for the wizard's
     * "From email" picker. verified is false only when the node says so; legacy nodes without the
     * flag send from their own address, so they count as verified.
     */
    public record EmailSender(String type, String email, String name, boolean verified) {
    }

    /** The institute's own email senders; empty when it has none (the platform default isn't one). */
    public List<EmailSender> emailSenders(String instituteId) {
        JsonNode settings = settingsOf(instituteId);
        if (settings == null) return List.of();
        List<EmailSender> out = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> it = settings.path("EMAIL_SETTING").path("data").fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!e.getValue().isObject()) continue;
            String from = fromOf(e.getValue());
            String email = from;
            String name = null;
            int lt = from.indexOf('<');
            int gt = from.indexOf('>');
            if (lt >= 0 && gt > lt) {
                name = from.substring(0, lt).trim();
                email = from.substring(lt + 1, gt).trim();
            }
            out.add(new EmailSender(e.getKey(), email, name == null || name.isBlank() ? null : name,
                    !isUnverified(e.getValue())));
        }
        return out;
    }

    public Map<String, Readiness> check(String instituteId) {
        return check(instituteId, null);
    }

    /** {@code emailType}: the sender an engine picked, checked to still exist; null = any sender. */
    public Map<String, Readiness> check(String instituteId, String emailType) {
        JsonNode settings = settingsOf(instituteId);
        Map<String, Readiness> out = new LinkedHashMap<>();
        out.put("WHATSAPP", settings == null ? Readiness.ok() : whatsapp(settings));
        out.put("EMAIL", settings == null ? Readiness.ok() : email(settings, emailType));
        out.put("IN_APP", Readiness.ok());
        out.put("AI_CALL", settings == null ? Readiness.ok() : aiCall(settings));
        return out;
    }

    /**
     * Refuse channels an engine turns on that the institute hasn't set up. Only channels being
     * switched on are checked ({@code previousChannels} = what the engine had), so an older engine
     * can still be renamed or paused.
     */
    public void requireReady(String instituteId, String channelsJson, String previousChannelsJson) {
        JsonNode channels = readObject(channelsJson);
        if (channels == null) return;
        JsonNode previous = readObject(previousChannelsJson);
        // The sender the dispatcher will use: no emailType means UTILITY_EMAIL.
        String emailType = senderOf(channels);
        Map<String, Readiness> readiness = null;
        List<String> problems = new ArrayList<>();
        for (String channel : List.of("WHATSAPP", "EMAIL", "AI_CALL")) {
            boolean on = channels.path(channel).path("enabled").asBoolean(false);
            if (!on) continue;
            boolean wasOn = previous != null && previous.path(channel).path("enabled").asBoolean(false);
            boolean senderChanged = "EMAIL".equals(channel) && previous != null
                    && !Objects.equals(emailType, senderOf(previous));
            if (wasOn && !senderChanged) continue;
            if (readiness == null) readiness = check(instituteId, emailType);
            Readiness r = readiness.get(channel);
            if (r != null && !r.ready()) problems.add(message(channel, r.reason()));
        }
        if (!problems.isEmpty()) throw new VacademyException(String.join(" ", problems));
    }

    static String message(String channel, String reason) {
        return switch (channel) {
            case "WHATSAPP" -> "WhatsApp is not set up for your institute. Connect it in Settings → WhatsApp, or turn the WhatsApp channel off.";
            case "EMAIL" -> SENDER_MISSING.equals(reason)
                    ? "The email sender this engine uses doesn't exist. Pick another sender, or add it in Settings → Notification."
                    : SENDER_NOT_VERIFIED.equals(reason)
                    ? "The email sender this engine uses isn't verified yet, so its mail would go out from the platform's support address. Finish verifying it in Settings → Notification, or pick another sender."
                    : "Email is not set up for your institute. Add your sender address in Settings → Notification, or turn the Email channel off.";
            case "AI_CALL" -> "AI calling is not set up for your institute. Add an AI agent in Settings → AI Calling, or turn the AI call channel off.";
            default -> channel + " is not set up for your institute.";
        };
    }

    private Readiness whatsapp(JsonNode settings) {
        JsonNode utility = settings.path("WHATSAPP_SETTING").path("data").path("UTILITY_WHATSAPP");
        String provider = utility.path("provider").asText("META").toUpperCase();
        String[] key = switch (provider) {
            case "COMBOT" -> new String[]{"combot", "apiKey"};
            case "WATI" -> new String[]{"wati", "apiKey"};
            default -> new String[]{"meta", "access_token"};
        };
        boolean configured = !utility.path(key[0]).path(key[1]).asText("").isBlank();
        return configured ? Readiness.ok() : new Readiness(false, NOT_SET_UP);
    }

    private Readiness email(JsonNode settings, String emailType) {
        JsonNode data = settings.path("EMAIL_SETTING").path("data");
        boolean any = false;
        for (Iterator<JsonNode> it = data.elements(); it.hasNext(); ) {
            if (it.next().isObject()) {
                any = true;
                break;
            }
        }
        if (!any) return new Readiness(false, NOT_SET_UP);
        if (emailType == null || emailType.isBlank()) return Readiness.ok();
        JsonNode sender = data.path(emailType.trim());
        if (!sender.isObject()) return new Readiness(false, SENDER_MISSING);
        if (isUnverified(sender)) return new Readiness(false, SENDER_NOT_VERIFIED);
        return Readiness.ok();
    }

    /** Same test as notification_service EmailService: only a literal false falls back. */
    private static boolean isUnverified(JsonNode sender) {
        JsonNode verified = sender.path("verified");
        return verified.isBoolean() && !verified.asBoolean();
    }

    /** The from-address keys notification_service reads, in its order. */
    private static String fromOf(JsonNode sender) {
        for (String key : List.of("from", "fromEmail", "fromAddress", "from_email", "from_email_address", "email")) {
            String v = sender.path(key).asText("");
            if (!v.isBlank()) return v.trim();
        }
        return "";
    }

    /** channels.EMAIL.emailType, or the dispatcher's default when unset. */
    private static String senderOf(JsonNode channels) {
        String type = blankToNull(channels.path("EMAIL").path("emailType").asText(null));
        return type != null ? type : EngagementDispatcher.DEFAULT_EMAIL_TYPE;
    }

    private Readiness aiCall(JsonNode settings) {
        JsonNode data = settings.path("AI_CALLING_SETTING").path("data");
        boolean hasAgent = (data.path("campaigns").isArray() && !data.path("campaigns").isEmpty())
                || !data.path("defaultCampaignId").asText("").isBlank();
        return hasAgent ? Readiness.ok() : new Readiness(false, NOT_SET_UP);
    }

    /** The institute's settings map (setting_json.setting), or null when it can't be read. */
    private JsonNode settingsOf(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || institute.getSetting() == null || institute.getSetting().isBlank()) {
                return objectMapper.createObjectNode();
            }
            JsonNode root = objectMapper.readTree(institute.getSetting());
            return root.has("setting") ? root.get("setting") : root;
        } catch (Exception e) {
            log.warn("Channel readiness: settings of institute {} can't be read: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private JsonNode readObject(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode n = objectMapper.readTree(json);
            return n.isObject() ? n : null;
        } catch (Exception e) {
            return null;
        }
    }
}
