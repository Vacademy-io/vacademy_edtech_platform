import { useEffect, useMemo, useState } from "react";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type { StudentLayoutSettings } from "@/types/student-display-settings";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import {
  deviceForWidth,
  getLastStudentLayout,
  resolveStudentLayout,
  setLastStudentLayout,
  type ResolvedStudentLayout,
} from "@/lib/student-layout";

const currentDevice = () =>
  deviceForWidth(typeof window === "undefined" ? 1280 : window.innerWidth);

/**
 * The institute's learner layout (header items, where navigation lives on this
 * screen size, footer bar, wallpaper). Until settings load it resolves with no
 * layout, which is exactly today's behaviour — so nothing flickers for
 * institutes that never configured it.
 */
export function useStudentLayout(): ResolvedStudentLayout {
  const [layout, setLayout] = useState<StudentLayoutSettings | null>(getLastStudentLayout);
  const [device, setDevice] = useState(currentDevice);
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();

  useEffect(() => {
    let cancelled = false;
    getStudentDisplaySettings(false)
      .then((settings) => {
        const next = settings?.layout ?? null;
        setLastStudentLayout(next);
        if (!cancelled) setLayout(next);
      })
      .catch(() => {
        // keep today's layout
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setDevice(currentDevice());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return useMemo(
    () =>
      resolveStudentLayout(layout, {
        device,
        playSkin: isPlay || isCleanerPlay,
      }),
    [layout, device, isPlay, isCleanerPlay]
  );
}
