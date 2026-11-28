/**
 * Which FEATURE targets this learner actually has (spec 6.3). A tile, button or
 * slide link to a feature the learner does not have is hidden; the admin's
 * picker notes these conditions because it cannot check them per learner.
 *
 * Every read here reuses a cache the app already fills (Student Display
 * settings, the doubt setting the query card reads, the chatbot setting the
 * dashboard warms). The one extra request, the store-site check, runs only when
 * the home actually links to the store.
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import type { FeatureKey, HomeBlock, ResolvedLink } from "@/types/learner-home";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { getChatbotSettings } from "@/services/chatbot-settings";
import { useDoubtManagementSetting } from "@/services/doubt-management-settings";

/** The catalogue tag the Explore Memberships / Books buttons open. */
const STORE_TAG = "collections";

function linksOf(blocks: readonly HomeBlock[]): ResolvedLink[] {
  const out: ResolvedLink[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "BANNER_CAROUSEL":
        b.config?.slides?.forEach((s) => s.link && out.push(s.link));
        break;
      case "SHORTCUTS":
        b.config?.tiles?.forEach((t) => t.link && out.push(t.link));
        break;
      case "COURSE_SHELF":
        if (b.config?.see_all) out.push(b.config.see_all);
        break;
      case "NOTICE":
        if (b.config?.button?.link) out.push(b.config.button.link);
        break;
      case "EVENT":
        if (b.config?.register_cta?.link) out.push(b.config.register_cta.link);
        if (b.config?.join_cta?.link) out.push(b.config.join_cta.link);
        break;
      default:
        break;
    }
  }
  return out;
}

export function featuresLinked(blocks: readonly HomeBlock[]): Set<FeatureKey> {
  const set = new Set<FeatureKey>();
  for (const link of linksOf(blocks)) if (link.kind === "FEATURE") set.add(link.feature);
  return set;
}

export async function hasStoreSite(): Promise<boolean> {
  const instituteId = await getInstituteId();
  if (!instituteId) return false;
  try {
    const res = await axios.get(
      `${BASE_URL}/admin-core-service/public/course-catalogue/v1/institute/get/by-tag`,
      { params: { instituteId, tagName: STORE_TAG }, withCredentials: false, timeout: 8000 }
    );
    return !!res.data;
  } catch {
    // 404 (no such site) or unreachable: keep the store links hidden.
    return false;
  }
}

export function useFeatureAvailability(opts: {
  enabled: boolean;
  blocks: readonly HomeBlock[];
  primaryBatchId: string | null;
  /** The learner has, or last had, a daily-task plan. */
  hasPlan: boolean;
}): Partial<Record<FeatureKey, boolean>> {
  const linked = useMemo(
    () => (opts.enabled ? featuresLinked(opts.blocks) : new Set<FeatureKey>()),
    [opts.enabled, opts.blocks]
  );
  const needsStore = linked.has("STORE_MEMBERSHIPS") || linked.has("STORE_BOOKS");
  const { learnerQueryEnabled } = useDoubtManagementSetting();

  const [settings, setSettings] = useState<{ homework: boolean; referral: boolean; notes: boolean } | null>(null);
  const [chatbot, setChatbot] = useState<boolean | null>(null);
  const needsSettings = linked.has("HOMEWORK") || linked.has("REFERRAL") || linked.has("NOTEBOOK");
  const needsChatbot = linked.has("AI_CHAT");

  useEffect(() => {
    if (!needsSettings) return;
    let cancelled = false;
    getStudentDisplaySettings(false)
      .then((s) => {
        if (cancelled) return;
        const tab = (id: string) => s?.sidebar?.tabs?.find((t) => t.id === id)?.visible === true;
        setSettings({
          homework: tab("homework"),
          referral: tab("referral"),
          notes: s?.courseDetails?.slidesView?.canTakeNotes !== false,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsSettings]);

  useEffect(() => {
    if (!needsChatbot) return;
    let cancelled = false;
    getChatbotSettings(false)
      .then((s) => {
        if (!cancelled) setChatbot(s?.enable === true);
      })
      .catch(() => {
        if (!cancelled) setChatbot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsChatbot]);

  const store = useQuery({
    queryKey: ["learner-home", "store-site"],
    queryFn: hasStoreSite,
    enabled: opts.enabled && needsStore,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  return useMemo(() => {
    let native = false;
    try {
      native = Capacitor.isNativePlatform();
    } catch {
      native = false;
    }
    return {
      // Unknown until read: hidden, then shown once confirmed (never the reverse).
      HOMEWORK: settings?.homework ?? false,
      REFERRAL: settings?.referral ?? false,
      NOTEBOOK: settings?.notes ?? true,
      DOUBTS: learnerQueryEnabled,
      DAILY_TASKS: opts.hasPlan,
      AI_CHAT: chatbot ?? false,
      DOWNLOADS: native,
      LEADERBOARD: !!opts.primaryBatchId,
      STORE_MEMBERSHIPS: store.data === true,
      STORE_BOOKS: store.data === true,
    };
  }, [settings, learnerQueryEnabled, opts.hasPlan, chatbot, opts.primaryBatchId, store.data]);
}
