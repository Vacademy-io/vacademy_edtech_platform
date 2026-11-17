package vacademy.io.admin_core_service.features.telleo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.capabilities.service.DisplaySettingsFormat;

/**
 * The admin display settings a new Telleo account starts with, written when the institute is
 * created: the normal dashboard, showing only Lead list, Recent leads, Call log and AI agents.
 *
 * <p>{@code ui.sidebarAllowList} is what makes this an allow-list. With it on, the admin app hides
 * every sidebar entry this blob does not list (instead of filling it in from the defaults) and
 * sends any page not under a listed entry to the locked page. Off, or absent, for every other
 * institute, so their hidden entries and deep links behave exactly as before.
 *
 * <p>Same shape as {@link DisplaySettingsFormat}: {key, name, data: DisplaySettingsData}.
 */
public final class TelleoDisplaySettings {

    private TelleoDisplaySettings() {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String POST_LOGIN_ROUTE = "/audience-manager/list";

    /** The dashboard's preset green (preset-themes.ts), Telleo's brand colour. */
    public static final String THEME_CODE = "green";

    /** Where an API account lands: its agents (the keys are one click away, under AI calling settings). */
    public static final String API_POST_LOGIN_ROUTE = "/calling/ai-agents";

    /** A dashboard (platform) account: Lead list, Recent leads, Call log and AI agents. */
    public static ObjectNode adminEntry() {
        return entry(false);
    }

    /**
     * An API account: no lead pages, only what running calls over the API needs. AI agents, Call log,
     * and AI calling settings, where the API keys are made.
     */
    public static ObjectNode apiAdminEntry() {
        return entry(true);
    }

    private static ObjectNode entry(boolean api) {
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("key", DisplaySettingsFormat.ADMIN_KEY);
        entry.put("name", "Admin Display Settings");
        ObjectNode data = entry.putObject("data");

        ArrayNode sidebar = data.putArray("sidebar");
        if (api) {
            ObjectNode calling = tab(sidebar, "calling", 0);
            sub(calling, "calling-ai-agents", "/calling/ai-agents", 0);
            sub(calling, "calling-call-log", "/audience-manager/call-log", 1);
            sub(calling, "calling-ai-settings", "/settings?selectedTab=aiCalling", 2);
        } else {
            ObjectNode leads = tab(sidebar, "leads", 0);
            sub(leads, "lead-list-leads", "/audience-manager/list", 0);
            sub(leads, "recent-leads", "/audience-manager/recent-leads", 1);
            ObjectNode calling = tab(sidebar, "calling", 1);
            sub(calling, "calling-call-log", "/audience-manager/call-log", 0);
            sub(calling, "calling-ai-agents", "/calling/ai-agents", 1);
        }

        ArrayNode categories = data.putArray("sidebarCategories");
        category(categories, "CRM", true, true, 0);
        category(categories, "LMS", false, false, 1);
        category(categories, "AI", false, false, 2);
        category(categories, "ERP", false, false, 3);

        data.put("postLoginRedirectRoute", api ? API_POST_LOGIN_ROUTE : POST_LOGIN_ROUTE);

        ObjectNode ui = data.putObject("ui");
        ui.put("showSupportButton", true);
        ui.put("showAiCredits", true);
        ui.put("sidebarAllowList", true);
        return entry;
    }

    private static ObjectNode tab(ArrayNode sidebar, String id, int order) {
        ObjectNode tab = sidebar.addObject();
        tab.put("id", id);
        tab.put("order", order);
        tab.put("visible", true);
        tab.put("locked", false);
        tab.putArray("subTabs");
        return tab;
    }

    private static void sub(ObjectNode tab, String id, String route, int order) {
        ObjectNode s = ((ArrayNode) tab.get("subTabs")).addObject();
        s.put("id", id);
        s.put("route", route);
        s.put("order", order);
        s.put("visible", true);
        s.put("locked", false);
    }

    private static void category(ArrayNode categories, String id, boolean visible, boolean isDefault, int order) {
        ObjectNode c = categories.addObject();
        c.put("id", id);
        c.put("visible", visible);
        c.put("locked", false);
        c.put("default", isDefault);
        c.put("order", order);
    }
}
