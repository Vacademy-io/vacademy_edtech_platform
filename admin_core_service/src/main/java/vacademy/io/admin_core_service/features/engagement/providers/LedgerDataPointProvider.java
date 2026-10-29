package vacademy.io.admin_core_service.features.engagement.providers;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointSpec;
import vacademy.io.admin_core_service.features.engagement.spi.FetchContext;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Always-on: THE ledger — what was sent, delivered, read, replied, per channel. This is the
 * data point that stops the brain from re-sending on the assumption nothing was sent.
 * One HTTP call per cohort (notification_service ledger-batch, Phase 0).
 */
@Component
@RequiredArgsConstructor
public class LedgerDataPointProvider implements DataPointProvider {

    private final EngagementInternalClients clients;

    /** B5: the contact-limit window; the ledger then also counts touches from every system. */
    @Value("${engagement.contact.window-days:7}")
    private int contactWindowDays = 7;

    @Override public String key() { return "ledger"; }
    @Override public boolean alwaysOn() { return true; }

    @Override
    public DataPointSpec declare() {
        return DataPointSpec.builder()
                .key(key()).label("Message history (send/read/reply)")
                .description("Per-channel communication ledger: last sent/delivered/read/reply "
                        + "timestamps, reply text, recent send/read/failure counts, and the "
                        + "WhatsApp 24h reply window. RESPECT the observable flags: when a signal "
                        + "is marked unobservable, silence means 'cannot see', NEVER 'ignored'.")
                .sensitivity("MEDIUM").cost("HTTP").build();
    }

    @Override
    public Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects) {
        List<Map<String, String>> reqSubjects = new ArrayList<>();
        for (Subject s : subjects) {
            Map<String, String> m = new HashMap<>();
            m.put("key", s.getMemberId());
            if (s.getUserId() != null) m.put("userId", s.getUserId());
            if (s.getPhone() != null) m.put("phone", s.getPhone());
            if (s.getEmail() != null) m.put("email", s.getEmail());
            reqSubjects.add(m);
        }
        JsonNode resp = clients.ledgerBatch(ctx.getInstituteId(), reqSubjects, ctx.getRecentWindowDays(), contactWindowDays);
        JsonNode bySubject = resp.path("bySubject");
        Map<String, JsonNode> out = new HashMap<>();
        bySubject.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue()));
        return out;
    }

    @Override
    public String render(JsonNode p) {
        if (p == null) return "LEDGER: no communication history on record.";
        StringBuilder sb = new StringBuilder("LEDGER:");
        appendChannel(sb, "whatsapp", p.get("whatsapp"));
        appendChannel(sb, "email", p.get("email"));
        JsonNode contact = p.get("contact");
        if (contact != null && !contact.isNull()) {
            // Every system together (engine, workflows, announcements, chatbot), so the brain does
            // not add to a week that is already busy.
            sb.append(" [all systems: touches in the last ").append(contactWindowDays).append(" days=")
              .append(contact.path("touches").asLong(0)).append("]");
        }
        return sb.toString();
    }

    private void appendChannel(StringBuilder sb, String name, JsonNode ch) {
        if (ch == null || ch.isNull()) return;
        sb.append(" [").append(name)
          .append(" lastSent=").append(ch.path("lastSentAt").asText("never"))
          .append(" lastRead=").append(readSignal(ch))
          .append(" lastReply=").append(ch.path("lastReplyAt").asText("never"));
        if (ch.hasNonNull("lastReplyText")) sb.append(" replyText=\"").append(ch.get("lastReplyText").asText()).append("\"");
        if (ch.hasNonNull("windowOpenUntil")) sb.append(" replyWindowOpenUntil=").append(ch.get("windowOpenUntil").asText());
        sb.append(" recentSends=").append(ch.path("recentSends").asLong(0));
        long failures = ch.path("recentFailures").asLong(0);
        if (failures > 0) sb.append(" RECENT_FAILURES=").append(failures)
                .append(" lastFailureCode=").append(ch.path("lastFailureCode").asText("?"));
        sb.append("]");
    }

    /** The honesty seam: unobservable read state must never read as "not read". */
    private String readSignal(JsonNode ch) {
        boolean observable = ch.path("observable").path("read").asBoolean(false);
        if (!observable) return "UNOBSERVABLE(do not infer)";
        return ch.path("lastReadAt").asText("never");
    }
}
