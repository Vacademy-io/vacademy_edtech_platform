# Discussion forum slides

A teacher asks a question, learners respond, classmates comment and react, and the
teacher moderates. Built for courses where learners share personal reflections
(e.g. psychology / wellbeing), so every rule is set per discussion and enforced on the
server.

## Storage

A discussion is a **DOCUMENT slide with `document_slide.type = "DISCUSSION"`** (same
pattern as SCRATCH / JUPYTER / CODE). Drafts, publishing, copy, move, ordering and drip
all work as for any document slide. Copying a discussion copies the question and the
settings, never the posts.

`document_slide.data` / `published_data` is a JSON string:

```json
{
  "version": 1,
  "prompt_html": "<p>What helps you feel calm before an exam?</p>",
  "settings": {
    "visibility": "OPEN",
    "allow_comments": true,
    "allow_reactions": true,
    "reactions": ["HEART", "HUG", "THANKS", "INSIGHT", "RELATE", "STRENGTH"],
    "allow_anonymous": false,
    "require_approval": false,
    "allow_edit_own": true,
    "locked": false,
    "care_note": ""
  }
}
```

| setting | meaning |
| --- | --- |
| `visibility` | `OPEN`: classmates see each other's responses. `AFTER_REPLY`: a learner sees classmates' responses only after posting their own. `PRIVATE`: only teachers see a learner's response (a private reflection; the teacher can reply inside it). |
| `allow_comments` | Learners may comment on classmates' responses. A learner can always reply inside their own response's thread (e.g. to answer the teacher). |
| `allow_reactions` / `reactions` | Supportive reactions only, no dislike. Keys: `HEART` ❤️ Love this, `HUG` 🤗 Sending a hug, `THANKS` 🙏 Thank you, `INSIGHT` 💡 Insightful, `RELATE` 🤝 I relate, `STRENGTH` 💪 You've got this. |
| `allow_anonymous` | A learner may hide their name **from classmates**. Teachers always see who wrote it. |
| `require_approval` | Learner posts (and edits) wait for a teacher before classmates see them. |
| `allow_edit_own` | Learners may edit and delete their own posts. |
| `locked` | No new learner posts or edits. Reading, reacting and teacher posts still work. |
| `care_note` | Optional plain-text note shown above the reply box (e.g. a helpline). |

Learners are held to the **published** settings. Unknown visibility falls back to
`PRIVATE`; unreadable settings JSON falls back to `PRIVATE` + `locked`.

Tables (V670): `discussion_post` (responses, `parent_id` null, and comments, `parent_id`
= the response; one level), `discussion_reaction`, `discussion_report`. Post `content`
is **plain text**. Render it as text with `white-space: pre-wrap`, never as HTML.
Learners only see posts of their own batch (`package_session_id`) plus teacher posts
addressed to every batch (`package_session_id` null).

Completion: a learner's first response marks the slide complete (same write as
"Mark as complete", type DOCUMENT).

## Learner API: `/admin-core-service/discussion/learner/v1`

Signed-in learner (token) + `clientId` header. Access = a live enrollment in a batch
whose course has the slide, or staff of the owning institute previewing.

| | |
| --- | --- |
| `GET /thread?slideId=&packageSessionId=&chapterId=` | `DiscussionThreadView` |
| `POST /posts` body `{slide_id, package_session_id, chapter_id, module_id, subject_id, parent_id?, content, anonymous}` | `DiscussionPostView` |
| `PUT /posts/{postId}` body `{content}` | `DiscussionPostView` |
| `DELETE /posts/{postId}` | `true` |
| `POST /posts/{postId}/reactions` body `{reaction}` (toggles) | `ReactionCount[]` |
| `POST /posts/{postId}/report` body `{reason?}` | `true` |

## Staff API: `/admin-core-service/discussion/admin/v1`

Institute staff only (`requireInstituteStaff`, no root bypass); `instituteId` query
param must match the `clientId` header; the slide must be in one of the institute's courses.

| | |
| --- | --- |
| `GET /thread?slideId=&instituteId=&packageSessionId?` | `DiscussionThreadView` with everything not deleted, plus `batches` |
| `POST /posts?instituteId=` body `{slide_id, package_session_id? (null = every batch), parent_id?, content}` | `DiscussionPostView` |
| `PUT /posts/{postId}?instituteId=` body `{content}` (own teacher posts) | `DiscussionPostView` |
| `POST /posts/{postId}/moderate?instituteId=` body `{action}`: `APPROVE`, `HIDE`, `UNHIDE`, `PIN`, `UNPIN`, `DELETE`, `CLEAR_REPORTS` | `DiscussionPostView` |
| `POST /posts/{postId}/reactions?instituteId=` body `{reaction}` | `ReactionCount[]` |

## Response shapes (snake_case; null fields omitted)

```ts
type DiscussionThreadView = {
  slide_id: string;
  package_session_id?: string;
  settings: DiscussionSettings;              // as above
  viewer: {
    user_id: string;
    staff: boolean;
    has_responded: boolean;
    can_see_others: boolean;                 // false = AFTER_REPLY before replying, or PRIVATE
    can_respond: boolean;                    // false when locked (learners)
    can_comment_on_others: boolean;
  };
  stats: { responses: number; participants: number; pending?: number; flagged?: number; hidden?: number };
  posts: DiscussionPostView[];               // responses: pinned first, then newest first
  batches?: { package_session_id: string; name: string }[];   // staff only
};

type DiscussionPostView = {
  id: string;
  parent_id?: string;
  content: string;                           // plain text
  created_at: string;                        // timestamp
  edited_at?: string;
  author_name: string;                       // "Anonymous classmate" for learners viewing an anonymous post
  author_user_id?: string;                   // omitted when anonymous to this viewer
  author_role: 'LEARNER' | 'STAFF';
  anonymous: boolean;
  mine: boolean;
  status: 'PUBLISHED' | 'PENDING' | 'HIDDEN';
  pinned: boolean;
  reactions: { reaction: string; count: number; reacted_by_me: boolean }[];
  report_count?: number;                     // staff only
  report_reasons?: string[];                 // staff only
  package_session_id?: string;               // staff only
  reported_by_me?: boolean;                  // learners only
  comments?: DiscussionPostView[];           // on responses only, oldest first
};
```
