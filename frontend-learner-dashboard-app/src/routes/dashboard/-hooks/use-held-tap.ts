import { useEffect, useState } from "react";

/**
 * A tap handler for a button whose target may not be known yet. A tap while
 * `busy` is kept and acted on once, with the target known by then. Leaving the
 * page drops it.
 */
export function useHeldTap(busy: boolean, act: () => void): () => void {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!held || busy) return;
    setHeld(false);
    act();
    // Runs when the wait ends; `act` from that same render knows the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, busy]);

  return () => {
    if (busy) setHeld(true);
    else act();
  };
}
