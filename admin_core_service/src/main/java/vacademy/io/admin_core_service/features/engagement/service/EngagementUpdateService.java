package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementUpdateRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementUpdate;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementUpdateRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Time-boxed news for an engine. Starting one asks everyone in the engine to be looked at again,
 * spread over a window. Ending one, by its date or by hand, cancels what was drafted for it, and the
 * dispatcher refuses anything tied to an update that is no longer live.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementUpdateService {

    static final int MAX_MESSAGE_CHARS = 1000;
    /** One LLM decision per person: spread them out instead of all at once. */
    static final int ANNOUNCE_WINDOW_SECONDS = 2 * 60 * 60;
    static final String ENDED_REASON = "Cancelled: this offer or update has ended.";

    private final EngagementUpdateRepository updateRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementTemplateProposalRepository templateRepository;

    /** What the brain may use right now, and which template belongs to which update. */
    public record LiveUpdates(List<EngagementUpdate> live, Map<String, String> updateByTemplate, Set<String> hiddenTemplates) {
        public static final LiveUpdates NONE = new LiveUpdates(List.of(), Map.of(), Set.of());

        /** The update this message carries: its template decides, else what the model reported. */
        public String resolve(String templateName, String reportedUpdateId) {
            if (templateName != null) {
                String byTemplate = updateByTemplate.get(templateName.trim());
                if (byTemplate != null) return byTemplate;
            }
            if (reportedUpdateId == null) return null;
            String id = reportedUpdateId.trim();
            return live.stream().anyMatch(u -> u.getId().equals(id)) ? id : null;
        }
    }

    public List<EngagementUpdate> list(String engineId) {
        return updateRepository.findByEngineIdOrderByCreatedAtDesc(engineId);
    }

    public EngagementUpdate create(EngagementEngine engine, EngagementUpdateRequest req, String createdBy) {
        Instant now = Instant.now();
        String message = req.getMessage() == null ? "" : req.getMessage().trim();
        if (message.isEmpty()) throw new VacademyException("Write what this update should say");
        if (message.length() > MAX_MESSAGE_CHARS) {
            throw new VacademyException("Keep the update under " + MAX_MESSAGE_CHARS + " characters");
        }
        Instant startsAt = req.getStartsAt() != null ? req.getStartsAt() : now;
        if (req.getEndsAt() == null) throw new VacademyException("Pick when this update ends");
        if (!req.getEndsAt().isAfter(now)) throw new VacademyException("The end date must be in the future");
        if (!req.getEndsAt().isAfter(startsAt)) throw new VacademyException("The end date must be after the start");

        String template = req.getTemplateName() == null || req.getTemplateName().isBlank() ? null : req.getTemplateName().trim();
        if (template != null) {
            boolean approved = templateRepository.findApproved(engine.getId(), engine.getInstituteId()).stream()
                    .map(EngagementTemplateProposal::getName).anyMatch(template::equals);
            if (!approved) throw new VacademyException("That WhatsApp template is not approved for this engine");
        }

        EngagementUpdate update = new EngagementUpdate();
        update.setEngineId(engine.getId());
        update.setInstituteId(engine.getInstituteId());
        update.setMessage(message);
        update.setTemplateName(template);
        update.setStartsAt(startsAt);
        update.setEndsAt(req.getEndsAt());
        update.setCreatedBy(createdBy);
        return updateRepository.save(update);
    }

    /** Ends it now: whatever was drafted or scheduled for it is cancelled too. */
    public EngagementUpdate end(EngagementEngine engine, String updateId) {
        EngagementUpdate update = updateRepository.findById(updateId)
                .filter(u -> engine.getId().equals(u.getEngineId()))
                .orElseThrow(() -> new VacademyException("Update not found"));
        close(update, Instant.now());
        // The row was changed by a direct UPDATE: the copy this request already loaded still says ACTIVE.
        update.setStatus(EngagementUpdate.ENDED);
        return update;
    }

    /** The updates of one engine as the brain sees them at this moment. */
    public LiveUpdates forDecision(String engineId, Instant now) {
        List<EngagementUpdate> all = updateRepository.findByEngineIdOrderByCreatedAtDesc(engineId);
        if (all.isEmpty()) return LiveUpdates.NONE;
        List<EngagementUpdate> live = all.stream().filter(u -> u.liveAt(now)).toList();
        Map<String, String> byTemplate = new HashMap<>();
        live.stream().filter(u -> u.getTemplateName() != null)
                .forEach(u -> byTemplate.putIfAbsent(u.getTemplateName(), u.getId()));
        // A template made for an offer says that offer. Before it starts or after it ends the
        // model must not be able to pick it, whatever the brief says.
        Set<String> hidden = all.stream()
                .filter(u -> u.getTemplateName() != null && !u.liveAt(now))
                .map(EngagementUpdate::getTemplateName)
                .filter(t -> !byTemplate.containsKey(t))
                .collect(Collectors.toSet());
        return new LiveUpdates(live, byTemplate, hidden);
    }

    public boolean isLive(String updateId, Instant now) {
        return updateRepository.findById(updateId).map(u -> u.liveAt(now)).orElse(false);
    }

    /** The admin's brief, plus what is on right now. */
    static String briefWith(String compiledBrief, List<EngagementUpdate> live) {
        if (live.isEmpty()) return compiledBrief;
        StringBuilder sb = new StringBuilder(compiledBrief == null ? "" : compiledBrief)
                .append("\n\nCURRENT UPDATES AND OFFERS FROM THE ADMIN (true right now, usable as facts):\n");
        for (EngagementUpdate u : live) {
            sb.append("- [updateId ").append(u.getId()).append("] ends ").append(u.getEndsAt()).append(": ")
                    .append(u.getMessage());
            if (u.getTemplateName() != null) sb.append(" (WhatsApp template: ").append(u.getTemplateName()).append(")");
            sb.append("\n");
        }
        sb.append("If this person has not had an update that fits them, share it now rather than waiting. ")
                .append("When your message uses one, put its id in \"updateId\". On WhatsApp an update goes only ")
                .append("through its own template; one without a template goes by another channel. Never mention ")
                .append("an offer or date that is not listed here.");
        return sb.toString();
    }

    /** Asks everyone in the engine to be looked at again when an update starts. */
    public int announceDue(Instant now) {
        int announced = 0;
        for (EngagementUpdate update : updateRepository.findDueToAnnounce(now)) {
            if (updateRepository.markAnnounced(update.getId(), now) != 1) continue;
            int woken = memberRepository.wakeEngineMembers(update.getEngineId(), now,
                    EngagementWakeService.UPDATE_POSTED, ANNOUNCE_WINDOW_SECONDS);
            log.info("Update {} started on engine {}: {} member(s) to look at", update.getId(), update.getEngineId(), woken);
            announced++;
        }
        return announced;
    }

    /** Closes updates past their end date, with whatever was still waiting for them. */
    public int closeEnded(Instant now) {
        int closed = 0;
        for (EngagementUpdate update : updateRepository.findPastTheirEnd(now)) {
            close(update, now);
            closed++;
        }
        return closed;
    }

    private void close(EngagementUpdate update, Instant now) {
        updateRepository.markEnded(update.getId(), now);
        int cancelled = actionRepository.cancelActionsOfUpdate(update.getEngineId(), update.getId(), ENDED_REASON, now);
        if (cancelled > 0) log.info("Update {} ended: {} waiting action(s) cancelled", update.getId(), cancelled);
    }
}
