import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

// Route pages are code-split (autoCodeSplitting in vite.config.ts), so the
// exam's preview and live-test pages download when first visited. Starting an
// exam enters fullscreen and THEN navigates there; fetching at that moment
// would make the learner wait, and on a tab opened before a deploy the chunk
// is gone and the page reloads, dropping fullscreen. Fetch them while the
// learner is still reading the instructions instead. A failed fetch here
// triggers the stale-chunk reload (src/lib/chunk-reload.ts) on this page,
// before the exam has started, which is harmless.
const EXAM_ROUTE_IDS = [
  "/assessment/examination/$assessmentId/assessmentPreview",
  "/assessment/examination/$assessmentId/LearnerLiveTest",
] as const;

export const usePreloadExamRoutes = (): void => {
  const router = useRouter();
  useEffect(() => {
    for (const id of EXAM_ROUTE_IDS) {
      const route = router.routesById[id];
      if (route) void router.loadRouteChunk(route).catch(() => undefined);
    }
  }, [router]);
};
