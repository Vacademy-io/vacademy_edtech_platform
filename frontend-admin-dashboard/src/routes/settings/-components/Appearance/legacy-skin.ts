import {
    fetchSavedStudentDisplaySettings,
    saveStudentDisplaySettings,
} from '@/services/student-display-settings';
import type { StudentDisplaySettingsData } from '@/types/student-display-settings';
import type { StudentUiType } from '@/types/theme-role-settings';

/**
 * What a Fun choice leaves in ui.type for learner apps that predate it: Play, the
 * nearest look they know (solid colour blocks and chunky lip buttons). Cleaner Play
 * is deliberately calmer, with no bold colour blocks, so it is further from Fun.
 */
const FUN_FALLBACK: StudentUiType = 'play';

/**
 * The value a learner app that predates the Fun skin should find in the
 * legacy STUDENT_DISPLAY_SETTINGS.ui.type. Such an app ignores a skin it does not
 * know and falls back to ui.type, so with Fun chosen that must be the
 * nearest look it does know. Null: leave ui.type as it is, exactly as before.
 */
export function legacySkinFor(
    skin: StudentUiType,
    previouslySaved: StudentUiType | null | undefined
): StudentUiType | null {
    if (skin === 'fun') return FUN_FALLBACK;
    // Leaving Fun: the fallback written for it would outlive it.
    if (previouslySaved === 'fun') return skin;
    return null;
}

/**
 * The object to write back: exactly what the server held with only ui.type
 * changed, or null when nothing should be written.
 *
 * - Nothing saved: the learner app reads an object holding only ui.type exactly as
 *   it reads nothing saved, apart from ui.type itself (see the learner app's
 *   student-display-settings.partial.test.ts), so that is all that is written.
 * - Leaving Fun: a ui.type of the fallback value is replaced by the new
 *   skin. That value cannot be told apart from the same value saved by hand before
 *   Fun was chosen, so either is replaced; an old learner app then falls
 *   back to the skin actually chosen. A ui.type that holds anything else, or no
 *   saved setting at all, is left alone.
 */
export function legacySkinPatch(
    saved: Record<string, unknown> | null,
    wanted: StudentUiType,
    leavingFun: boolean
): Record<string, unknown> | null {
    const rawUi = saved?.ui;
    const ui =
        rawUi && typeof rawUi === 'object' && !Array.isArray(rawUi)
            ? (rawUi as Record<string, unknown>)
            : null;
    if (ui?.type === wanted) return null;
    if (leavingFun && ui?.type !== FUN_FALLBACK) return null;
    return { ...(saved ?? {}), ui: { ...(ui ?? {}), type: wanted } };
}

/**
 * Keeps ui.type readable for older learner apps. Reads the server copy right
 * before writing, so a change saved elsewhere since this screen opened is kept,
 * and never writes defaults. Returns the ui.type written, or null.
 */
export async function keepLegacySkinReadable(
    skin: StudentUiType,
    previouslySaved: StudentUiType | null | undefined
): Promise<StudentUiType | null> {
    const wanted = legacySkinFor(skin, previouslySaved);
    if (!wanted) return null;
    const saved = await fetchSavedStudentDisplaySettings();
    const next = legacySkinPatch(saved, wanted, skin !== 'fun');
    if (!next) return null;
    // Partial on purpose: the server stores what it is given, and the readers
    // fill in their own defaults for every field left out.
    await saveStudentDisplaySettings(next as unknown as StudentDisplaySettingsData);
    return wanted;
}
