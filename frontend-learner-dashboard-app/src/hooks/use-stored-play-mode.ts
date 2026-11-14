import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { safeParse } from "@/lib/storage";

/** The play mode of the assessment being taken, from the key the start flow writes. */
export function useStoredPlayMode(): string | null {
  const [playMode, setPlayMode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    readStoredPlayMode().then((mode) => {
      if (alive) setPlayMode(mode);
    });
    return () => {
      alive = false;
    };
  }, []);
  return playMode;
}

export async function readStoredPlayMode(): Promise<string | null> {
  const stored = await Preferences.get({ key: "InstructionID_and_AboutID" });
  const parsed = safeParse<{ play_mode?: string } | null>(stored.value, null);
  return parsed?.play_mode ?? null;
}
