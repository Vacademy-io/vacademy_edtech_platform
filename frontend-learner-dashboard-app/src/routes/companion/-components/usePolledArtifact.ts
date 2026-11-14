import { useCallback, useEffect, useRef, useState } from "react";
import {
  readCompanionError,
  type ArtifactStatus,
  type CompanionApiError,
} from "@/services/kb-companion-api";

const POLL_MS = 2500;
const MAX_POLL_FAILURES = 4;

/**
 * Open a compiled-once artifact (a lesson or a practice set) and poll it while
 * the server builds it.
 *
 * POST opens it (the first learner of a topic starts the compile); GET polls
 * every 2.5 s while it is GENERATING, surfacing partial results as they land.
 * A GET that comes back MISSING re-opens it once. A few failed polls in a row
 * become an error; `retry` re-opens from scratch (which also restarts a FAILED
 * compile on the server).
 */
export function usePolledArtifact<T extends { status: ArtifactStatus }>(
  key: string | null,
  open: () => Promise<T>,
  poll: () => Promise<T>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<CompanionApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const openRef = useRef(open);
  const pollRef = useRef(poll);
  openRef.current = open;
  pollRef.current = poll;

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    let reopened = false;

    const schedule = () => {
      timer = window.setTimeout(() => void tick(), POLL_MS);
    };

    const accept = (next: T) => {
      if (cancelled) return;
      setData(next);
      setLoading(false);
      if (next.status === "GENERATING") schedule();
    };

    const tick = async () => {
      try {
        const next = await pollRef.current();
        if (cancelled) return;
        failures = 0;
        if (next.status === "MISSING" && !reopened) {
          reopened = true;
          accept(await openRef.current());
          return;
        }
        accept(next);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setError(readCompanionError(err));
          setLoading(false);
        } else {
          schedule();
        }
      }
    };

    setData(null);
    setError(null);
    setLoading(true);
    openRef
      .current()
      .then(accept)
      .catch((err) => {
        if (cancelled) return;
        setError(readCompanionError(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { data, error, loading, retry };
}
