package vacademy.io.admin_core_service.features.voomsales.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.capabilities.service.DisplaySettingsFormat;

/**
 * What a new VoomSales workspace starts with, written when the institute is created: the blue
 * theme, and an admin sidebar that shows the CRM category only.
 *
 * <p>Unlike Telleo, this is not an allow-list. The blob lists no sidebar tabs, so every CRM tab
 * (leads, calling, communications, automations, settings) comes from the dashboard defaults, and
 * a CRM tab added later shows up too. LMS, AI, ERP and Commerce are hidden. Commerce must be
 * listed: the dashboard default shows it.
 *
 * <p>Same shape as {@link DisplaySettingsFormat}: {key, name, data: DisplaySettingsData}.
 */
public final class VoomSalesDisplaySettings {

    private VoomSalesDisplaySettings() {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String PRODUCT_KEY = "voomsales";

    /** The dashboard preset blue (preset-themes.ts). */
    public static final String THEME_CODE = "blue";

    /** Where the admin lands, the same page as the product app_path (V719). */
    public static final String POST_LOGIN_ROUTE = "/audience-manager/list";

    public static boolean isVoomSales(String product) {
        return PRODUCT_KEY.equalsIgnoreCase(product == null ? null : product.trim());
    }

    public static ObjectNode adminEntry() {
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("key", DisplaySettingsFormat.ADMIN_KEY);
        entry.put("name", "Admin Display Settings");
        ObjectNode data = entry.putObject("data");

        ArrayNode categories = data.putArray("sidebarCategories");
        category(categories, "CRM", true, true, 0);
        category(categories, "LMS", false, false, 1);
        category(categories, "AI", false, false, 2);
        category(categories, "ERP", false, false, 3);
        category(categories, "COMMERCE", false, false, 4);

        data.put("postLoginRedirectRoute", POST_LOGIN_ROUTE);

        ObjectNode ui = data.putObject("ui");
        ui.put("showSupportButton", true);
        ui.put("showAiCredits", true);
        return entry;
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
