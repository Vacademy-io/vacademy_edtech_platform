import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BuiltinWidget, HomeBlock, HomePlacement, ResolvedHomeBuilder, ResolvedLink } from "@/types/learner-home";
import {
  acknowledgeHomeBlock,
  dismissHomeBlock,
  homeActionOutcome,
  postHomeEvents,
  updateCachedNotice,
} from "@/services/learner-home";
import { BlockFrame } from "./BlockFrame";
import { HomeBuilderContext, type HomeBuilderContextValue } from "./home-context";
import { followNavigation, toNavigation, type FollowDeps, type LinkContext } from "./link-target";
import { toSegments } from "./segments";
import { useHomeAnalytics } from "./use-home-analytics";
import { prepareBlocks } from "./visibility";
import { BannerCarouselBlock } from "./blocks/BannerCarouselBlock";
import { ShortcutsBlock } from "./blocks/ShortcutsBlock";
import { CourseShelfBlock } from "./blocks/CourseShelfBlock";
import { NoticeBlock } from "./blocks/NoticeBlock";
import { EventBlock } from "./blocks/EventBlock";
import { BuiltinBlock } from "./blocks/BuiltinBlock";

const EXPIRY_TICK_MS = 60_000;

export interface LearnerHomeRendererProps {
  home: ResolvedHomeBuilder;
  /** The avatar / greeting / date row; drawn unless settings.show_header is false. */
  header?: ReactNode;
  /** A built-in widget's fragment, for the column it sits in. */
  renderBuiltin: (widget: BuiltinWidget, placement: HomePlacement) => ReactNode;
  /** >= 1024 px: bands and the 2/3 + 1/3 grid; below: one column in list order. */
  isLg: boolean;
  /** < 768 px: the PHONE device class for block targeting. */
  isPhone: boolean;
  skin: { fun: boolean; play: boolean; cleanerPlay: boolean };
  linkContext: LinkContext;
  followDeps: Omit<FollowDeps, "beforeLeave">;
  /** Admin preview: links, dismiss, acknowledge and analytics stay local. */
  preview: boolean;
}

/**
 * The builder home (spec 7.3): the resolved blocks, filtered for this device
 * and learner, laid out as one column in list order on phones and as
 * full-width bands plus 2/3 + 1/3 grids on desktop.
 */
export function LearnerHomeRenderer(props: LearnerHomeRendererProps) {
  const { home, isLg, isPhone, skin, linkContext, followDeps, preview } = props;
  const { t } = useTranslation("learnerHome");
  const queryClient = useQueryClient();

  // One clock for expiry (block windows, slide windows, event ends).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), EXPIRY_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Preview only: notices dismissed in this frame.
  const [locallyDismissed, setLocallyDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const blocks = useMemo(
    () =>
      prepareBlocks(home.blocks, { ...linkContext, isPhone, nowMs, funSkin: skin.fun }).filter(
        (b) => !locallyDismissed.has(b.key)
      ),
    [home.blocks, linkContext, isPhone, nowMs, skin.fun, locallyDismissed]
  );

  const analytics = useHomeAnalytics({
    layoutVersion: home.layout_version,
    disabled: preview || home.preview === true,
    send: postHomeEvents,
  });

  const followRef = useRef(followDeps);
  followRef.current = followDeps;

  const openLink = useCallback(
    (link: ResolvedLink, blockKey: string, itemKey?: string) => {
      if (preview) return;
      const nav = toNavigation(link, linkContext);
      if (!nav) return;
      // Counted before navigating; an external link flushes the queue first.
      analytics.click(blockKey, itemKey);
      void followNavigation(nav, { ...followRef.current, beforeLeave: analytics.flush }).catch((error) =>
        console.error("[learner-home] link failed", error)
      );
    },
    [preview, linkContext, analytics]
  );

  const onDismiss = useCallback(
    (blockKey: string) => {
      if (preview) {
        setLocallyDismissed((prev) => new Set(prev).add(blockKey));
        return;
      }
      const revert = updateCachedNotice(queryClient, blockKey, { dismissed: true });
      dismissHomeBlock(blockKey).catch((error) => {
        // NOT_DISMISSIBLE / ACK_REQUIRED / network: the notice comes back.
        if (homeActionOutcome(error) === "keep") return;
        revert();
        toast.error(t("notice.dismissFailed"));
      });
    },
    [preview, queryClient, t]
  );

  const onAcknowledge = useCallback(
    async (blockKey: string) => {
      if (preview) return true;
      const revert = updateCachedNotice(queryClient, blockKey, { acknowledged_at: new Date().toISOString() });
      try {
        await acknowledgeHomeBlock(blockKey);
        return true;
      } catch (error) {
        if (homeActionOutcome(error) === "keep") return true;
        revert();
        toast.error(t("notice.ackFailed"));
        return false;
      }
    },
    [preview, queryClient, t]
  );

  const context: HomeBuilderContextValue = useMemo(
    () => ({ linkContext, openLink, analytics, nowMs, preview, skin, onDismiss, onAcknowledge }),
    [linkContext, openLink, analytics, nowMs, preview, skin, onDismiss, onAcknowledge]
  );

  const renderBlock = (block: HomeBlock) => (
    <BlockFrame key={block.key} block={block}>
      <BlockBody block={block} renderBuiltin={props.renderBuiltin} />
    </BlockFrame>
  );

  const comfortable = home.settings?.phone_spacing === "COMFORTABLE";
  const showHeader = home.settings?.show_header !== false;

  return (
    <HomeBuilderContext.Provider value={context}>
      <div
        className={cn("flex flex-col", comfortable ? "gap-4" : "gap-3", "lg:gap-6")}
        data-learner-home={`v${home.layout_version}`}
      >
        {showHeader && props.header}
        {!isLg ? (
          blocks.map(renderBlock)
        ) : (
          toSegments(blocks).map((segment) =>
            segment.kind === "full" ? (
              <section key={segment.key} className="w-full">
                {renderBlock(segment.block)}
              </section>
            ) : (
              <GridSegment key={segment.key} main={segment.main.map(renderBlock)} rail={segment.rail.map(renderBlock)} />
            )
          )
        )}
      </div>
    </HomeBuilderContext.Provider>
  );
}

/**
 * A 2/3 + 1/3 run. The rail keeps its third only while something in it
 * actually rendered: most rail widgets draw nothing on a quiet day, and an
 * empty column must not strand the main column at two thirds.
 */
function GridSegment({ main, rail }: { main: ReactNode[]; rail: ReactNode[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railHasContent, setRailHasContent] = useState(true);
  const hasRail = rail.length > 0;
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const check = () => setRailHasContent(Array.from(el.children).some((c) => c.childNodes.length > 0));
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hasRail]);
  const showRail = hasRail && railHasContent;
  return (
    <div className={cn("grid grid-cols-1 items-start gap-6", showRail && "lg:grid-cols-3")}>
      <div className={cn("flex min-w-0 flex-col gap-6", showRail && "lg:col-span-2")}>{main}</div>
      {hasRail && (
        <div ref={railRef} className={cn("flex min-w-0 flex-col gap-6 lg:col-span-1", !railHasContent && "hidden")}>
          {rail}
        </div>
      )}
    </div>
  );
}

function BlockBody({
  block,
  renderBuiltin,
}: {
  block: HomeBlock;
  renderBuiltin: LearnerHomeRendererProps["renderBuiltin"];
}) {
  switch (block.type) {
    case "BANNER_CAROUSEL":
      return <BannerCarouselBlock blockKey={block.key} config={block.config} placement={block.placement} />;
    case "SHORTCUTS":
      return <ShortcutsBlock blockKey={block.key} config={block.config} placement={block.placement} />;
    case "COURSE_SHELF":
      return <CourseShelfBlock blockKey={block.key} config={block.config} />;
    case "NOTICE":
      return <NoticeBlock blockKey={block.key} config={block.config} />;
    case "EVENT":
      return <EventBlock blockKey={block.key} config={block.config} />;
    case "BUILTIN":
      return (
        <BuiltinBlock
          widget={block.builtin_widget}
          placeholder={block.placeholder}
          render={() => renderBuiltin(block.builtin_widget, block.placement)}
        />
      );
    default:
      return null;
  }
}
