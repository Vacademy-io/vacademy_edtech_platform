import { useCallback, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import {
  ChatsCircle,
  Eye,
  HandHeart,
  LockSimple,
  Plus,
  ShieldCheck,
  UsersThree,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/design-system/states";
import type { Slide } from "@/hooks/study-library/use-slides";
import type { DiscussionThread, DiscussionVisibility } from "./discussion-api";
import { DiscussionComposer } from "./discussion-composer";
import { DiscussionResponse } from "./discussion-post";
import { readDiscussionPrompt } from "./discussion-utils";
import {
  useDiscussionActions,
  useDiscussionContext,
  useDiscussionThread,
  type DiscussionActions,
} from "./use-discussion";

const AUDIENCE_ICON: Record<DiscussionVisibility, PhosphorIcon> = {
  OPEN: UsersThree,
  AFTER_REPLY: Eye,
  PRIVATE: LockSimple,
};

/** Teacher-authored question HTML, sanitised before it reaches the DOM. */
function DiscussionPrompt({ html, fallback }: { html: string; fallback: string }) {
  const clean = useMemo(
    () => (html ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : ""),
    [html]
  );
  const headingClass =
    "min-w-0 break-words text-title font-semibold leading-snug text-foreground sm:text-h3";
  if (!clean.trim()) {
    return <h2 className={headingClass}>{fallback}</h2>;
  }
  // The first block of the question reads as its heading; any further
  // paragraphs (context, instructions) stay at a calm body weight.
  const className =
    "min-w-0 break-words text-base leading-relaxed text-foreground [&>*:first-child]:text-title [&>*:first-child]:font-semibold [&>*:first-child]:leading-snug sm:[&>*:first-child]:text-h3";
  return (
    <div
      dir="auto"
      role="heading"
      aria-level={2}
      className={cn("rich-text-content", className)}
      // Sanitised above; never pass raw teacher HTML.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h3 className="text-subtitle font-semibold text-foreground">{title}</h3>
      {count !== undefined && count > 0 && (
        <span className="text-caption tabular-nums text-muted-foreground">{formatNumber(count)}</span>
      )}
    </div>
  );
}

/** A quiet centred card: the gate, the private note and the empty state. */
function SoftCard({
  icon: IconCmp,
  title,
  body,
}: {
  icon: PhosphorIcon;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center [.ui-cleaner-play_&]:border-cp-border">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-500/10 text-primary-500">
        <IconCmp size={24} weight="duotone" aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-subtitle font-semibold text-foreground">{title}</p>
        {body && <p className="text-body text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-40 w-full rounded-2xl" />
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-border p-card sm:p-card-lg">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResponseComposer({
  thread,
  actions,
  slideId,
}: {
  thread: DiscussionThread;
  actions: DiscussionActions;
  slideId: string;
}) {
  const { t } = useTranslation("studyContent");
  const { settings, viewer } = thread;
  const [expanded, setExpanded] = useState(false);
  const visibility = settings.visibility;
  const AudienceIcon = AUDIENCE_ICON[visibility] ?? LockSimple;

  // After the first reply the box steps back: the learner's own words and
  // their classmates' come first, and another thought is one tap away.
  if (viewer.has_responded && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-start text-body font-medium text-muted-foreground transition-colors hover:border-primary-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [.ui-cleaner-play_&]:border-cp-border"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-500/10 text-primary-500">
          <Plus size={16} weight="bold" aria-hidden />
        </span>
        {t("discussion.composer.addAnother")}
      </button>
    );
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-card shadow-sm sm:p-card-lg",
        "[.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:shadow-none",
        "[.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-surface"
      )}
    >
      <DiscussionComposer
        label={viewer.has_responded ? t("discussion.composer.addAnother") : t("discussion.composer.label")}
        placeholder={t("discussion.composer.placeholder")}
        submitLabel={t("discussion.composer.submit")}
        draftKey={`discussion-draft:${slideId}`}
        allowAnonymous={settings.allow_anonymous}
        autoFocus={expanded}
        submitting={actions.create.isPending}
        onCancel={viewer.has_responded ? () => setExpanded(false) : undefined}
        onSubmit={(content, anonymous) =>
          actions.create.mutateAsync({ content, anonymous }).then(() => setExpanded(false))
        }
        notes={
          <ul className="flex flex-col gap-1.5 text-caption text-muted-foreground">
            <li className="flex items-start gap-2">
              <AudienceIcon size={16} className="mt-px shrink-0 text-primary-500" aria-hidden />
              <span>{t(`discussion.audience.${visibility}`)}</span>
            </li>
            {settings.require_approval && (
              <li className="flex items-start gap-2">
                <ShieldCheck size={16} className="mt-px shrink-0 text-primary-500" aria-hidden />
                <span>{t("discussion.audience.approval")}</span>
              </li>
            )}
          </ul>
        }
      />
    </section>
  );
}

function ThreadBody({
  thread,
  actions,
  slideId,
}: {
  thread: DiscussionThread;
  actions: DiscussionActions;
  slideId: string;
}) {
  const { t } = useTranslation("studyContent");
  const { settings, viewer, stats } = thread;
  const mine = thread.posts.filter((p) => p.mine);
  const others = thread.posts.filter((p) => !p.mine);
  const careNote = settings.care_note?.trim();
  const gated = !viewer.can_see_others && settings.visibility === "AFTER_REPLY";
  const isPrivate = !viewer.can_see_others && settings.visibility === "PRIVATE";

  return (
    <>
      {careNote && (
        <aside
          className={cn(
            "flex gap-3 rounded-2xl border border-success-500/20 bg-success-500/5 p-card",
            "[.ui-cleaner-play_&]:border-transparent [.ui-cleaner-play_&]:bg-cp-sage-tint"
          )}
        >
          <HandHeart size={22} weight="duotone" className="mt-0.5 shrink-0 text-success-600" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-caption font-semibold text-foreground">{t("discussion.careNoteLabel")}</p>
            <p dir="auto" className="whitespace-pre-wrap break-words text-body leading-relaxed text-foreground">
              {careNote}
            </p>
          </div>
        </aside>
      )}

      {viewer.can_respond ? (
        <ResponseComposer thread={thread} actions={actions} slideId={slideId} />
      ) : (
        <div role="status" className="flex gap-3 rounded-2xl bg-muted p-card">
          <LockSimple size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="text-body font-semibold text-foreground">{t("discussion.closed.title")}</p>
            <p className="text-caption text-muted-foreground">{t("discussion.closed.body")}</p>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <section className="flex flex-col gap-3" aria-label={t("discussion.sections.yours", { count: mine.length })}>
          <SectionHeading title={t("discussion.sections.yours", { count: mine.length })} />
          {mine.map((post) => (
            <DiscussionResponse key={post.id} post={post} thread={thread} actions={actions} />
          ))}
        </section>
      )}

      {gated && (
        <SoftCard
          icon={UsersThree}
          title={
            stats.participants > 0
              ? t("discussion.gate.title", { count: stats.participants, formatted: formatNumber(stats.participants) })
              : t("discussion.gate.noneTitle")
          }
          body={stats.participants > 0 ? t("discussion.gate.body") : t("discussion.gate.noneBody")}
        />
      )}

      {isPrivate && (
        <SoftCard icon={LockSimple} title={t("discussion.private.title")} body={t("discussion.private.body")} />
      )}

      {others.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading
            title={viewer.can_see_others ? t("discussion.sections.class") : t("discussion.sections.teacher")}
            count={others.length}
          />
          {others.map((post) => (
            <DiscussionResponse key={post.id} post={post} thread={thread} actions={actions} />
          ))}
        </section>
      )}

      {viewer.can_see_others && others.length === 0 && (
        <SoftCard
          icon={ChatsCircle}
          title={mine.length > 0 ? t("discussion.empty.afterMineTitle") : t("discussion.empty.title")}
          body={mine.length > 0 ? t("discussion.empty.afterMineBody") : t("discussion.empty.body")}
        />
      )}
    </>
  );
}

/**
 * A discussion slide: the teacher asks, learners reply, classmates comment and
 * send supportive reactions. Built for reflective courses where learners may
 * share something personal, so it says plainly who will see each reply and
 * keeps the tone quiet. What the learner may do always comes from the server's
 * `settings` + `viewer`, never from the slide JSON.
 */
export function DiscussionSlide({ slide }: { slide: Slide }) {
  const { t } = useTranslation("studyContent");
  const prompt = readDiscussionPrompt(slide.document_slide?.published_data);
  const { ids, ready } = useDiscussionContext(slide.id);
  const query = useDiscussionThread(ids, ready);
  const actions = useDiscussionActions(ids);
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const thread = query.data;
  const visibility = thread?.settings.visibility;
  const VisibilityIcon = visibility ? (AUDIENCE_ICON[visibility] ?? LockSimple) : null;
  const participants = thread?.stats.participants ?? 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-background [.ui-cleaner-play_&]:bg-cp-bg">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-section px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <header
          className={cn(
            "flex flex-col gap-4 rounded-3xl bg-primary-500/10 p-card-lg sm:p-8",
            "[.ui-play_&]:rounded-play-card [.ui-cleaner-play_&]:bg-cp-gold-tint"
          )}
        >
          <p className="inline-flex items-center gap-2 text-caption font-semibold text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-full bg-background text-primary-500">
              <ChatsCircle size={16} weight="fill" aria-hidden />
            </span>
            {t("discussion.eyebrow")}
          </p>
          <DiscussionPrompt html={prompt} fallback={slide.title} />
          {thread && VisibilityIcon && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 font-medium text-foreground">
                <VisibilityIcon size={14} className="text-primary-500" aria-hidden />
                {t(`discussion.visibility.${visibility}`)}
              </span>
              {participants > 0 && thread.viewer.can_see_others && (
                <span>
                  {t("discussion.participants", { count: participants, formatted: formatNumber(participants) })}
                </span>
              )}
            </div>
          )}
        </header>

        {!ready || query.isLoading ? (
          <ThreadSkeleton />
        ) : query.isError || !thread ? (
          <LoadErrorState title={t("discussion.loadError")} onRetry={retry} />
        ) : (
          <ThreadBody thread={thread} actions={actions} slideId={slide.id} />
        )}
      </div>
    </div>
  );
}
