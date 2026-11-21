import { Component, useRef, type ErrorInfo, type ReactNode } from "react";
import type { HomeBlock } from "@/types/learner-home";
import { useHomeBuilder } from "./home-context";
import { useViewDwell } from "./use-home-analytics";

/** One broken block must never take the home down: it draws nothing instead. */
class BlockErrorBoundary extends Component<{ blockKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[learner-home] block ${this.props.blockKey} failed to render`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The wrapper of every block on the builder home: an error boundary, the view
 * count (half visible for a second, once per mount) and `empty:hidden`, so a
 * widget that decides it has nothing to show leaves no gap in the column.
 */
export function BlockFrame({ block, children }: { block: HomeBlock; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { analytics, preview } = useHomeBuilder();
  useViewDwell(ref, () => analytics.view(block.key), { disabled: preview });
  return (
    <div
      ref={ref}
      className="empty:hidden"
      data-block-key={block.key}
      data-block-type={block.type}
      data-widget={block.type === "BUILTIN" ? block.builtin_widget : undefined}
    >
      <BlockErrorBoundary blockKey={block.key}>{children}</BlockErrorBoundary>
    </div>
  );
}
