import type { StudentAllCoursesCustomTab } from "@/types/student-display-settings";

/**
 * Where `?tag=X` opens: the admin's own tag tab whose tags are exactly [X] when
 * it is visible, else the All tab filtered to X, else (All hidden, e.g. reader
 * mode) nowhere special.
 */
export function tabForInitialTag(
  tag: string,
  visible: ReadonlyArray<{ value: string }>,
  customTabs: Record<string, StudentAllCoursesCustomTab>
): { tab: string; tags?: string[] } | null {
  const wanted = tag.trim().toLowerCase();
  if (!wanted) return null;
  const own = visible.find((v) => {
    const tab = customTabs[v.value];
    if (!tab || (tab.type ?? "TAG") !== "TAG") return false;
    const tags = (tab.tags ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    return tags.length === 1 && tags[0] === wanted;
  });
  if (own) return { tab: own.value };
  if (visible.some((v) => v.value === "ALL")) return { tab: "ALL", tags: [tag.trim()] };
  return null;
}
