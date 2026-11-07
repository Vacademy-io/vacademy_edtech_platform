import { Preferences } from '@capacitor/preferences';
import { getInstituteDetails } from './signup-api';

const INSTITUTE_DETAILS_KEY = 'InstituteDetails';

/**
 * Merge-write the InstituteDetails cache. Every site that previously called
 * {@code Preferences.set({ key: 'InstituteDetails', value: JSON.stringify(...) })}
 * should go through this helper instead — there are five independent writers
 * (auth, domain routing, sidebar, login institute-select, invite flow) and
 * before this helper they were clobbering each other's fields, e.g.
 * use-domain-routing would write a payload with no
 * {@code institute_settings_json} on every page nav and silently nuke the
 * settings the invite flow had populated. Merging preserves whichever fields
 * the other writers contributed.
 */
export const upsertInstituteDetails = async (
  partial: Record<string, unknown>,
): Promise<void> => {
  try {
    const existing = await Preferences.get({ key: INSTITUTE_DETAILS_KEY });
    let prev: Record<string, unknown> = {};
    if (existing?.value) {
      try {
        prev = JSON.parse(existing.value);
      } catch {
        prev = {};
      }
    }
    // Merging is for writers sharing one institute. Fields saved for another
    // institute (its name, logo links, app links) must not carry over.
    const next =
      prev.id && partial.id && prev.id !== partial.id
        ? partial
        : { ...prev, ...partial };
    await Preferences.set({
      key: INSTITUTE_DETAILS_KEY,
      value: JSON.stringify(next),
    });
  } catch (error) {
    console.error('[InstituteDetailsCache] Error upserting InstituteDetails:', error);
  }
};

/**
 * Service to proactively fetch and cache institute settings
 * This ensures role assignment works correctly during signup
 */
export class InstituteSettingsCache {
  private static instance: InstituteSettingsCache;
  private cachePromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): InstituteSettingsCache {
    if (!InstituteSettingsCache.instance) {
      InstituteSettingsCache.instance = new InstituteSettingsCache();
    }
    return InstituteSettingsCache.instance;
  }

  /**
   * Fetch and cache institute settings if they're missing
   * This is called proactively to ensure settings are available during signup
   */
  public async ensureSettingsCached(instituteId: string): Promise<void> {
    // If already fetching, wait for that to complete
    if (this.cachePromise) {
      return this.cachePromise;
    }

    this.cachePromise = this._fetchAndCacheSettings(instituteId);
    try {
      await this.cachePromise;
    } finally {
      this.cachePromise = null;
    }
  }

  private async _fetchAndCacheSettings(instituteId: string): Promise<void> {
    try {
      // Check if we already have cached settings
      const stored = await Preferences.get({ key: "InstituteDetails" });
      if (stored?.value) {
        const parsed = JSON.parse(stored.value);
        if (parsed?.institute_settings_json) {
          return;
        }
      }
      
      // Fetch full institute details
      const fullInstituteDetails = await getInstituteDetails(instituteId);
      
      if (fullInstituteDetails?.setting) {
        // Merge-write so we don't clobber fields owned by other writers
        // (use-domain-routing, useSidebar, etc.). See upsertInstituteDetails.
        await upsertInstituteDetails({
          id: instituteId,
          name: fullInstituteDetails.institute_name || 'Unknown Institute',
          logo_file_id: fullInstituteDetails.institute_logo_file_id,
          institute_logo_file_id: fullInstituteDetails.institute_logo_file_id,
          institute_theme_code: fullInstituteDetails.institute_theme_code,
          institute_settings_json: fullInstituteDetails.setting,
          home_icon_click_route:
            fullInstituteDetails.home_icon_click_route ??
            fullInstituteDetails.homeIconClickRoute ??
            null,
          homeIconClickRoute:
            fullInstituteDetails.homeIconClickRoute ??
            fullInstituteDetails.home_icon_click_route ??
            null,
        });
        
        // Log the key settings for verification
        try {
          const settingData = JSON.parse(fullInstituteDetails.setting);
          const allowLearnersToCreateCourses = settingData?.COURSE_SETTING?.data?.permissions?.allowLearnersToCreateCourses;
        } catch (parseError) {
          console.error('[InstituteSettingsCache] Error parsing cached settings:', parseError);
        }
      }
    } catch (error) {
      console.error('[InstituteSettingsCache] Error caching institute settings:', error);
      // Don't throw - this is a background operation
    }
  }

  /**
   * Get cached institute settings
   */
  public async getCachedSettings(): Promise<any> {
    try {
      const stored = await Preferences.get({ key: "InstituteDetails" });
      if (stored?.value) {
        const parsed = JSON.parse(stored.value);
        if (parsed?.institute_settings_json) {
          return JSON.parse(parsed.institute_settings_json);
        }
      }
      return null;
    } catch (error) {
      console.error('[InstituteSettingsCache] Error getting cached settings:', error);
      return null;
    }
  }

  /**
   * Returns the institute id the cache was populated for, or null when empty.
   * Used by hooks that need to re-fetch a live setting from the BE without
   * being tied to a specific route's params.
   */
  public async getCachedInstituteId(): Promise<string | null> {
    try {
      const stored = await Preferences.get({ key: "InstituteDetails" });
      if (stored?.value) {
        const parsed = JSON.parse(stored.value);
        return typeof parsed?.id === "string" ? parsed.id : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Clear cached settings (useful for testing or when switching institutes)
   */
  public async clearCache(): Promise<void> {
    try {
      await Preferences.remove({ key: "InstituteDetails" });
    } catch (error) {
      console.error('[InstituteSettingsCache] Error clearing cache:', error);
    }
  }
}

// Export singleton instance
export const instituteSettingsCache = InstituteSettingsCache.getInstance();
