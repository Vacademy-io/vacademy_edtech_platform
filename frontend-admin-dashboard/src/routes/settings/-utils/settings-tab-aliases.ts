import { SettingsTabs } from '../-constants/terms';

/**
 * Settings tab ids that were merged into another screen. Links that still name
 * them (bookmarks, older messages, docs) open the screen that replaced them.
 */
export const LEGACY_SETTINGS_TAB_ALIASES: Readonly<Record<string, string>> = {
    // The in-product assistant's and the MCP server's settings became Settings → AI access.
    assistantTools: SettingsTabs.AiAccess,
    mcpServer: SettingsTabs.AiAccess,
};

/** The tab id to open for `tab`: itself, or the screen that replaced it. */
export function canonicalSettingsTab(tab: string): string {
    return Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_TAB_ALIASES, tab)
        ? (LEGACY_SETTINGS_TAB_ALIASES[tab] as string)
        : tab;
}

/** /settings search params: `selectedTab`, with merged tab ids mapped to their new screen. */
export function validateSettingsSearch(search: Record<string, unknown>): { selectedTab: string } {
    const raw =
        typeof search.selectedTab === 'string' && search.selectedTab ? search.selectedTab : '';
    return { selectedTab: canonicalSettingsTab(raw || 'tab') };
}
