-- Discussion forum slides.
--
-- A discussion is a DOCUMENT slide with document_slide.type = 'DISCUSSION'. The
-- teacher's question and the forum's settings (who sees replies, comments,
-- reactions, anonymity, approval, lock) live in that slide's data /
-- published_data JSON, so drafts, publishing, copy, move and drip work the same
-- as every other slide. These tables hold what people write in the forum.
--
-- discussion_post: a learner's response to the question (parent_id NULL) or a
-- comment under a response (parent_id = the response). One level of nesting.
--   package_session_id: the batch the post belongs to. Learners only see their
--                       own batch. NULL = a teacher post shown to every batch.
--   author_name:        a snapshot taken from the signed-in user at write time.
--   is_anonymous:       hidden from classmates only. Teachers always see who wrote it.
--   status:             PUBLISHED | PENDING (awaiting teacher approval) | HIDDEN
--                       (hidden by a teacher) | DELETED (soft delete).
--   content:            plain text. Never rendered as HTML.
CREATE TABLE IF NOT EXISTS public.discussion_post (
    id                 varchar(36)   PRIMARY KEY,
    slide_id           varchar(255)  NOT NULL,
    institute_id       varchar(255)  NOT NULL,
    package_session_id varchar(255)  NULL,
    parent_id          varchar(36)   NULL,
    user_id            varchar(255)  NOT NULL,
    author_name        varchar(255)  NULL,
    author_role        varchar(16)   NOT NULL,
    is_anonymous       boolean       NOT NULL DEFAULT false,
    content            text          NOT NULL,
    status             varchar(16)   NOT NULL,
    is_pinned          boolean       NOT NULL DEFAULT false,
    report_count       integer       NOT NULL DEFAULT 0,
    edited_at          timestamp     NULL,
    moderated_by       varchar(255)  NULL,
    moderated_at       timestamp     NULL,
    created_at         timestamp     NOT NULL DEFAULT now(),
    updated_at         timestamp     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discussion_post_slide
    ON public.discussion_post (slide_id, package_session_id);
CREATE INDEX IF NOT EXISTS idx_discussion_post_parent
    ON public.discussion_post (parent_id);

-- One row per (post, person, reaction). Toggling a reaction off deletes the row.
CREATE TABLE IF NOT EXISTS public.discussion_reaction (
    id         varchar(36)  PRIMARY KEY,
    post_id    varchar(36)  NOT NULL,
    user_id    varchar(255) NOT NULL,
    reaction   varchar(16)  NOT NULL,
    created_at timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_discussion_reaction UNIQUE (post_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_discussion_reaction_post
    ON public.discussion_reaction (post_id);

-- A learner flagging a post for the teacher. One report per person per post;
-- discussion_post.report_count is the running total the teacher sees.
CREATE TABLE IF NOT EXISTS public.discussion_report (
    id         varchar(36)  PRIMARY KEY,
    post_id    varchar(36)  NOT NULL,
    user_id    varchar(255) NOT NULL,
    reason     varchar(500) NULL,
    created_at timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_discussion_report UNIQUE (post_id, user_id)
);
