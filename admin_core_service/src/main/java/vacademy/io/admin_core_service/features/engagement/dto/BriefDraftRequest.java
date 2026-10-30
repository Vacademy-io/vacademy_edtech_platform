package vacademy.io.admin_core_service.features.engagement.dto;

/**
 * What the admin gives the brief writer. Every field is optional, but at least one of objective,
 * product, website or leadAgentBrief must say something. currentBrief is what is already in the
 * brief box, so a second "Generate" improves it instead of throwing the admin's edits away.
 */
public record BriefDraftRequest(
        String objective,
        String websiteUrl,
        String productDescription,
        String language,
        String senderName,
        String leadAgentBrief,
        String currentBrief) {}
