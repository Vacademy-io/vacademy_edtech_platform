import type {
  ExamFamily,
  ExamFamilyDefinition,
  ExamInterface,
  ExamLayoutVariant,
  ExamPresetDefinition,
  ExamPresetId,
  ExamThemeDefinition,
  ExamThemePatch,
  ResolvedExamTheme,
} from "@/types/exam-theme";
import { DEFAULT_FAMILY } from "./families/default";
import { TCS_FAMILY } from "./families/tcs";
import { DEFAULT_PRESET } from "./presets/default";
import { JEE_MAIN_PRESET } from "./presets/jee-main";
import { JEE_ADVANCED_PRESET } from "./presets/jee-advanced";
import { GATE_PRESET } from "./presets/gate";
import { RRB_JE_PRESET } from "./presets/rrb-je";
import { reportUnknownExamTheme } from "./report";

export { effectiveAnswerCommit, renderedLayoutKind } from "./layouts";

export const EXAM_FAMILIES: Record<ExamFamily, ExamFamilyDefinition> = {
  default: DEFAULT_FAMILY,
  tcs: TCS_FAMILY,
};

export const EXAM_PRESETS: Record<ExamPresetId, ExamPresetDefinition> = {
  default: DEFAULT_PRESET,
  "jee-main": JEE_MAIN_PRESET,
  "jee-advanced": JEE_ADVANCED_PRESET,
  gate: GATE_PRESET,
  "rrb-je": RRB_JE_PRESET,
};

const isPresetId = (value: string): value is ExamPresetId =>
  Object.prototype.hasOwnProperty.call(EXAM_PRESETS, value);

/** Merges a patch one level deep (each section is a flat object). */
const applyPatch = (
  theme: ExamThemeDefinition,
  patch: ExamThemePatch | undefined,
): ExamThemeDefinition => {
  if (!patch) return theme;
  return {
    ...theme,
    layout: { ...theme.layout, ...patch.layout },
    policy: { ...theme.policy, ...patch.policy },
    timer: { ...theme.timer, ...patch.timer },
    palette: { ...theme.palette, ...patch.palette },
    options: { ...theme.options, ...patch.options },
  };
};

const layoutsOf = (preset: ExamPresetDefinition): ExamLayoutVariant[] => {
  const variants = Object.keys(preset.layouts ?? {}) as ExamLayoutVariant[];
  if (variants.length === 0) {
    return [EXAM_FAMILIES[preset.family].base.layout.variant];
  }
  const first = preset.defaultLayout ?? variants[0];
  return [first, ...variants.filter((variant) => variant !== first)];
};

/** Builds one preset in one layout, strict or practice-friendly. */
export const buildExamTheme = (
  presetId: ExamPresetId,
  layout?: ExamLayoutVariant,
  strict = true,
  calculatorOff = false,
): ResolvedExamTheme => {
  const preset = EXAM_PRESETS[presetId];
  const family = EXAM_FAMILIES[preset.family];
  const availableLayouts = layoutsOf(preset);
  const variant =
    layout && availableLayouts.includes(layout) ? layout : availableLayouts[0];

  let theme: ExamThemeDefinition = {
    ...family.base,
    id: preset.id,
    displayName: preset.displayName,
    neutralName: preset.neutralName,
  };
  theme = applyPatch(theme, preset.patch);
  theme = applyPatch(theme, preset.layouts?.[variant]);
  if (!strict) {
    theme = { ...theme, policy: { ...theme.policy, ...family.practice } };
  }
  const builtInCalculator =
    preset.builtInCalculator && !calculatorOff ? preset.builtInCalculator : null;
  return { ...theme, strict, availableLayouts, builtInCalculator };
};

/** The default screen: today's look and behaviour. */
export const DEFAULT_EXAM_THEME: ResolvedExamTheme = buildExamTheme("default");

const isPlainObject = (value: unknown): value is ExamInterface =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The store asks on every answer change; resolve each exam_interface object once.
const cache = new WeakMap<object, ResolvedExamTheme>();

/**
 * Theme for an assessment's `exam_interface`. Never throws.
 * - null, a non-object, a missing preset or "default" -> the default screen;
 * - a preset this build does not know -> the default screen (breadcrumb);
 * - a missing or unknown layout -> the preset's default layout;
 * - `strict` is true unless it is exactly `false`.
 */
export const resolveExamTheme = (examInterface: unknown): ResolvedExamTheme => {
  if (!isPlainObject(examInterface)) return DEFAULT_EXAM_THEME;
  const cached = cache.get(examInterface);
  if (cached) return cached;

  const resolved = resolveUncached(examInterface);
  cache.set(examInterface, resolved);
  return resolved;
};

const resolveUncached = (examInterface: ExamInterface): ResolvedExamTheme => {
  const preset = examInterface.preset;
  if (typeof preset !== "string" || preset === "" || preset === "default") {
    return DEFAULT_EXAM_THEME;
  }
  if (!isPresetId(preset)) {
    reportUnknownExamTheme("preset", preset);
    return DEFAULT_EXAM_THEME;
  }

  const strict = examInterface.strict !== false;
  const requestedLayout = examInterface.layout;
  const available = layoutsOf(EXAM_PRESETS[preset]);
  let layout: ExamLayoutVariant | undefined;
  if (typeof requestedLayout === "string" && requestedLayout !== "") {
    if ((available as string[]).includes(requestedLayout)) {
      layout = requestedLayout as ExamLayoutVariant;
    } else {
      reportUnknownExamTheme("layout", `${preset}/${requestedLayout}`);
    }
  }
  const tools = examInterface.tools;
  const calculatorOff =
    typeof tools === "object" && tools !== null && tools.calculator === false;
  return buildExamTheme(preset, layout, strict, calculatorOff);
};
