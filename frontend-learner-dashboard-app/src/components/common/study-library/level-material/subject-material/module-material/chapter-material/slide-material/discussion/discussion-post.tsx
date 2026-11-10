import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowBendUpLeft,
  ChalkboardTeacher,
  CheckCircle,
  DotsThree,
  EyeSlash,
  Flag,
  HourglassMedium,
  PencilSimple,
  PushPin,
  Smiley,
  Trash,
  User,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DISCUSSION_MAX_REPORT_CHARS,
  type DiscussionPost,
  type DiscussionReactionCount,
  type DiscussionThread,
} from "./discussion-api";
import type { DiscussionActions } from "./use-discussion";
import { DiscussionComposer } from "./discussion-composer";
import {
  DISCUSSION_REACTIONS,
  initialsOf,
  isKnownReaction,
  postTimeLabel,
  postTimeTitle,
} from "./discussion-utils";

/** Comments shown before "Show N more". */
const COMMENTS_PREVIEW = 2;

// ---------------------------------------------------------------- shared bits

interface PostContext {
  thread: DiscussionThread;
  actions: DiscussionActions;
}

/** What this learner may do with one post, from the server's settings + viewer. */
function postPermissions(post: DiscussionPost, thread: DiscussionThread) {
  const { settings, viewer } = thread;
  const locked = settings.locked || !viewer.can_respond;
  const isTeacher = post.author_role === "STAFF";
  return {
    locked,
    canEdit: post.mine && !isTeacher && settings.allow_edit_own && !locked && post.status !== "HIDDEN",
    // Reporting a teacher to the teacher means nothing; reports are for classmates.
    canReport: !post.mine && !isTeacher && post.status === "PUBLISHED",
    canReact: !post.mine && settings.allow_reactions && post.status === "PUBLISHED",
  };
}

function AuthorAvatar({ post, size = "md" }: { post: DiscussionPost; size?: "md" | "sm" }) {
  const isTeacher = post.author_role === "STAFF";
  const hideName = post.anonymous && !post.mine;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        size === "md" ? "size-10 text-body" : "size-8 text-caption",
        isTeacher
          ? "bg-primary-500 text-primary-foreground"
          : post.mine
            ? "bg-primary-100 text-foreground"
            : "bg-muted text-muted-foreground",
        "[.ui-cleaner-play_&]:ring-2 [.ui-cleaner-play_&]:ring-cp-border"
      )}
    >
      {hideName ? (
        <User size={size === "md" ? 18 : 14} weight="bold" />
      ) : (
        initialsOf(post.author_name)
      )}
    </span>
  );
}

function AuthorLine({ post }: { post: DiscussionPost }) {
  const { t } = useTranslation("studyContent");
  const isTeacher = post.author_role === "STAFF";
  const name = post.mine
    ? t("discussion.you")
    : post.anonymous
      ? t("discussion.anonymousClassmate")
      : post.author_name;
  const time = postTimeLabel(post.created_at, t("discussion.justNow"));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="truncate text-body font-semibold text-foreground">{name}</span>
      {isTeacher && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-2xs font-semibold text-foreground">
          <ChalkboardTeacher size={12} weight="fill" className="text-primary-500" aria-hidden />
          {t("discussion.teacher")}
        </span>
      )}
      {post.mine && post.anonymous && (
        <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
          <EyeSlash size={12} aria-hidden />
          {t("discussion.postedAnonymously")}
        </span>
      )}
      {time && (
        <span className="text-caption text-muted-foreground">
          <span aria-hidden>· </span>
          <time
            dateTime={new Date(post.created_at).toISOString()}
            title={postTimeTitle(post.created_at)}
          >
            {time}
          </time>
        </span>
      )}
      {post.edited_at && (
        <span className="text-caption text-muted-foreground">
          <span aria-hidden>· </span>
          {t("discussion.edited")}
        </span>
      )}
    </div>
  );
}

function StatusNote({ post }: { post: DiscussionPost }) {
  const { t } = useTranslation("studyContent");
  if (!post.mine || post.status === "PUBLISHED") return null;
  const pending = post.status === "PENDING";
  return (
    <p
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium",
        pending ? "bg-warning-500/10 text-warning-600" : "bg-muted text-muted-foreground"
      )}
    >
      {pending ? (
        <HourglassMedium size={14} weight="fill" aria-hidden />
      ) : (
        <EyeSlash size={14} weight="fill" aria-hidden />
      )}
      {pending ? t("discussion.status.pending") : t("discussion.status.hidden")}
    </p>
  );
}

function PostBody({ post, size }: { post: DiscussionPost; size: "md" | "sm" }) {
  // Plain text by contract: rendered as text, never as HTML.
  return (
    <p
      dir="auto"
      className={cn(
        "whitespace-pre-wrap break-words text-foreground",
        size === "md" ? "text-subtitle leading-relaxed" : "text-body leading-relaxed",
        post.status === "HIDDEN" && "text-muted-foreground"
      )}
    >
      {post.content}
    </p>
  );
}

// ---------------------------------------------------------------- reactions

function ReactionBar({
  post,
  context,
}: {
  post: DiscussionPost;
  context: PostContext;
}) {
  const { t } = useTranslation("studyContent");
  const [pickerOpen, setPickerOpen] = useState(false);
  const { settings } = context.thread;
  const { canReact } = postPermissions(post, context.thread);
  if (!settings.allow_reactions || post.status !== "PUBLISHED") return null;

  const allowed = settings.reactions.filter(isKnownReaction);
  const shown = (post.reactions ?? []).filter(
    (r): r is DiscussionReactionCount & { reaction: keyof typeof DISCUSSION_REACTIONS } =>
      isKnownReaction(r.reaction) && r.count > 0
  );
  if (!canReact && shown.length === 0) return null;

  const toggle = (reaction: string) =>
    context.actions.react.mutate({ postId: post.id, reaction });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((r) => {
        const label = t(`discussion.reactions.${r.reaction}`);
        const chipClass = cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-caption tabular-nums transition-colors",
          r.reacted_by_me
            ? "border-primary-300 bg-primary-500/10 font-semibold text-foreground"
            : "border-border bg-background text-muted-foreground",
          "[.ui-play_&]:border-2"
        );
        const content = (
          <>
            <span aria-hidden className="text-body leading-none">
              {DISCUSSION_REACTIONS[r.reaction].emoji}
            </span>
            {r.count}
          </>
        );
        const aria = t("discussion.reactions.chipAria", { label, count: r.count });
        return canReact ? (
          <button
            key={r.reaction}
            type="button"
            title={label}
            aria-label={aria}
            aria-pressed={r.reacted_by_me}
            onClick={() => toggle(r.reaction)}
            className={cn(
              chipClass,
              "hover:border-primary-300 hover:bg-primary-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            )}
          >
            {content}
          </button>
        ) : (
          <span key={r.reaction} title={label} aria-label={aria} role="img" className={chipClass}>
            {content}
          </span>
        );
      })}

      {canReact && allowed.length > 0 && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("discussion.reactions.addAria")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-caption font-medium text-muted-foreground transition-colors hover:border-primary-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Smiley size={16} aria-hidden />
              {shown.length === 0 && <span>{t("discussion.reactions.add")}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 rounded-xl p-1.5">
            <ul className="grid grid-cols-1 gap-0.5">
              {allowed.map((reaction) => {
                const mine = post.reactions?.find((r) => r.reaction === reaction)?.reacted_by_me;
                return (
                  <li key={reaction}>
                    <button
                      type="button"
                      aria-pressed={!!mine}
                      onClick={() => {
                        toggle(reaction);
                        setPickerOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-body text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                        mine && "bg-primary-500/10 font-semibold"
                      )}
                    >
                      <span aria-hidden className="text-title leading-none">
                        {DISCUSSION_REACTIONS[reaction].emoji}
                      </span>
                      <span className="flex-1">{t(`discussion.reactions.${reaction}`)}</span>
                      {mine && <CheckCircle size={16} weight="fill" className="text-primary-500" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- menu + dialogs

function PostMenu({
  post,
  context,
  isComment,
  onEdit,
}: {
  post: DiscussionPost;
  context: PostContext;
  isComment: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation("studyContent");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { canEdit, canReport } = postPermissions(post, context.thread);
  const { remove, report } = context.actions;
  if (!canEdit && !canReport && !post.reported_by_me) return null;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("discussion.menu.more")}
            className="-me-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <DotsThree size={20} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40 rounded-xl">
          {canEdit && (
            <>
              <DropdownMenuItem onSelect={onEdit} className="gap-2">
                <PencilSimple size={16} aria-hidden />
                {t("discussion.menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                className="gap-2 text-danger-600 focus:text-danger-600"
              >
                <Trash size={16} aria-hidden />
                {t("discussion.menu.delete")}
              </DropdownMenuItem>
            </>
          )}
          {!post.mine &&
            (post.reported_by_me ? (
              <DropdownMenuItem disabled className="gap-2">
                <CheckCircle size={16} aria-hidden />
                {t("discussion.menu.reported")}
              </DropdownMenuItem>
            ) : (
              canReport && (
                <DropdownMenuItem onSelect={() => setReportOpen(true)} className="gap-2">
                  <Flag size={16} aria-hidden />
                  {t("discussion.menu.report")}
                </DropdownMenuItem>
              )
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="w-dialog-sm rounded-2xl sm:max-w-md sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isComment ? t("discussion.delete.titleComment") : t("discussion.delete.titleResponse")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("discussion.delete.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-full">{t("discussion.delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate(post.id)}
            >
              {t("discussion.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={reportOpen}
        onOpenChange={(open) => {
          setReportOpen(open);
          if (!open) setReason("");
        }}
      >
        <DialogContent className="w-dialog-sm rounded-2xl sm:max-w-md sm:rounded-2xl">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              report.mutate(
                { postId: post.id, reason },
                {
                  onSuccess: () => {
                    setReportOpen(false);
                    setReason("");
                  },
                }
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("discussion.report.title")}</DialogTitle>
              <DialogDescription>{t("discussion.report.body")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <label htmlFor={`report-${post.id}`} className="text-body font-medium text-foreground">
                {t("discussion.report.reasonLabel")}
              </label>
              <Textarea
                id={`report-${post.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={DISCUSSION_MAX_REPORT_CHARS}
                rows={3}
                className="resize-none rounded-xl text-foreground"
              />
            </div>
            <DialogFooter className="gap-2">
              <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                className="min-w-0 rounded-full"
                onClick={() => setReportOpen(false)}
              >
                {t("discussion.report.cancel")}
              </MyButton>
              <MyButton
                type="submit"
                buttonType="primary"
                scale="medium"
                className="min-w-0 rounded-full"
                disable={report.isPending}
              >
                {t("discussion.report.submit")}
              </MyButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditBox({
  post,
  context,
  compact,
  onDone,
}: {
  post: DiscussionPost;
  context: PostContext;
  compact: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation("studyContent");
  const { edit } = context.actions;
  return (
    <DiscussionComposer
      label={t("discussion.edit.label")}
      hideLabel
      placeholder=""
      submitLabel={t("discussion.edit.save")}
      initialValue={post.content}
      compact={compact}
      autoFocus
      submitting={edit.isPending}
      onCancel={onDone}
      onSubmit={(content) =>
        edit.mutateAsync({ postId: post.id, content }).then(onDone)
      }
      notes={
        context.thread.settings.require_approval ? (
          <p className="text-caption text-muted-foreground">{t("discussion.edit.approvalNote")}</p>
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------- comment

function CommentItem({ comment, context }: { comment: DiscussionPost; context: PostContext }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex gap-3">
      <AuthorAvatar post={comment} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <AuthorLine post={comment} />
          {!editing && (
            <PostMenu post={comment} context={context} isComment onEdit={() => setEditing(true)} />
          )}
        </div>
        <StatusNote post={comment} />
        {editing ? (
          <EditBox post={comment} context={context} compact onDone={() => setEditing(false)} />
        ) : (
          <PostBody post={comment} size="sm" />
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- response

export function DiscussionResponse({
  post,
  thread,
  actions,
}: {
  post: DiscussionPost;
  thread: DiscussionThread;
  actions: DiscussionActions;
}) {
  const { t } = useTranslation("studyContent");
  const context: PostContext = { thread, actions };
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { locked, canReact } = postPermissions(post, thread);
  const isTeacher = post.author_role === "STAFF";
  const hasReactionsToShow =
    thread.settings.allow_reactions &&
    post.status === "PUBLISHED" &&
    (canReact || (post.reactions ?? []).some((r) => r.count > 0));

  const comments = post.comments ?? [];
  const hiddenCount = showAll || replying ? 0 : Math.max(0, comments.length - COMMENTS_PREVIEW);
  const visibleComments = hiddenCount > 0 ? comments.slice(0, COMMENTS_PREVIEW) : comments;
  const canReply =
    !locked &&
    post.status !== "HIDDEN" &&
    (post.mine || thread.viewer.can_comment_on_others);
  const replyName = post.mine
    ? t("discussion.you")
    : post.anonymous
      ? t("discussion.anonymousClassmate")
      : post.author_name;

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-2xl border p-card shadow-xs sm:p-card-lg",
        post.mine
          ? "border-primary-500/20 bg-primary-500/5"
          : post.pinned
            ? "border-primary-200 bg-card"
            : "border-border bg-card",
        post.status === "PENDING" && "border-dashed",
        "[.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:shadow-none",
        "[.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-surface",
        "[.ui-corporate_&]:shadow-sm"
      )}
    >
      {post.pinned && (
        <p className="-mb-1 inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
          <PushPin size={14} weight="fill" className="text-primary-500" aria-hidden />
          {t("discussion.pinned")}
        </p>
      )}

      <header className="flex items-start gap-3">
        <AuthorAvatar post={post} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          <AuthorLine post={post} />
          <StatusNote post={post} />
        </div>
        {!editing && (
          <PostMenu post={post} context={context} isComment={false} onEdit={() => setEditing(true)} />
        )}
      </header>

      {editing ? (
        <EditBox post={post} context={context} compact={false} onDone={() => setEditing(false)} />
      ) : (
        <div className={cn(isTeacher && "border-s-2 border-primary-300 ps-3")}>
          <PostBody post={post} size="md" />
        </div>
      )}

      {(hasReactionsToShow || (canReply && !replying)) && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ReactionBar post={post} context={context} />
          {canReply && !replying && (
            <button
              type="button"
              onClick={() => setReplying(true)}
              className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-caption font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowBendUpLeft size={16} aria-hidden />
              {t("discussion.reply.action")}
            </button>
          )}
        </div>
      )}

      {(comments.length > 0 || replying) && (
        <div className="flex flex-col gap-4 border-t border-border pt-4 [.ui-cleaner-play_&]:border-cp-border">
          {visibleComments.length > 0 && (
            <ul className="flex flex-col gap-4">
              {visibleComments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} context={context} />
              ))}
            </ul>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="ms-11 w-fit text-caption font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("discussion.comments.showMore", { count: hiddenCount })}
            </button>
          )}
          {replying && (
            <DiscussionComposer
              className="sm:ms-11"
              label={t("discussion.reply.label", { name: replyName })}
              hideLabel
              placeholder={post.mine ? t("discussion.reply.placeholderOwn") : t("discussion.reply.placeholder")}
              submitLabel={t("discussion.reply.submit")}
              compact
              autoFocus
              draftKey={`discussion-reply:${post.id}`}
              // Inside their own thread a learner keeps the identity they posted
              // with, so answering the teacher never unmasks an anonymous reply.
              allowAnonymous={thread.settings.allow_anonymous && !post.mine}
              submitting={actions.create.isPending}
              onCancel={() => setReplying(false)}
              onSubmit={(content, anonymous) =>
                actions.create
                  .mutateAsync({
                    content,
                    anonymous: post.mine ? post.anonymous : anonymous,
                    parentId: post.id,
                  })
                  .then(() => setReplying(false))
              }
              notes={
                thread.settings.require_approval ? (
                  <p className="text-caption text-muted-foreground">{t("discussion.audience.approval")}</p>
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </article>
  );
}
