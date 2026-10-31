# Login links: integration guide

This guide is for developers who build systems that link learners into the Vacademy learner portal, such as a website, CRM, member portal or mailer. It covers how to give a learner a link that signs them in without a password and opens a specific page, for example "edit your profile".

The flow has three steps:

1. Your server sends the learner's email and your institute's secret key to Vacademy.
2. Vacademy returns a short **login code**, plus the learner's username.
3. You put the code into the link: `https://<learner-portal>/user-profile/edit/<username>?lc=<code>`.

When the learner opens the link they're signed in and land on the page.

---

## 1. Before you start

### Get a key

An **admin of your institute** creates the key in the Vacademy admin dashboard:

1. Go to **Settings → General → Security → Login links → Create key**.
2. Name the key after the system that will use it (for example "School website") and optionally set an expiry date.
3. Copy the key straight away. It looks like `vak_login_3f9c…` and **is shown only once**. If you lose it, revoke it and create a new one.

The same screen lists your keys (with when each was last used) and revokes them. A revoked key stops working within about a minute.

### Find your two URLs

| What | Example | Where to get it |
|---|---|---|
| **API base URL** | `https://backend-stage.vacademy.io` | The API host your institute's learner portal talks to. Ask Vacademy support if you're not sure, especially if your portal is white-labelled (on your own domain). |
| **Learner portal URL** | `https://learner.yourinstitute.com` | The address your learners open the portal on. |

### Keep the key on your server

- The key can sign in **any learner of your institute**. Treat it like a password.
- Call the API **only from your server**. Never put the key in a web page, browser JavaScript, a mobile app or a URL.
- Don't log the key or the codes.
- If a key might have leaked, revoke it and create a new one.

---

## 2. How the "Require a login code" setting affects your links

The Security page has a switch, **"Require a login code on every link"**. It's **off** by default.

| Switch | A link with only a username (`/user-profile/edit/<username>`) | A link with a code (`…?lc=<code>`) |
|---|---|---|
| **Off** (default) | Signs the learner in, as it always has | The code is ignored, and the link behaves like the username-only link |
| **On** | Refused: the learner sees "This login link has expired" and the normal login form | Signs the learner in if the code is valid |

Codes can be requested at any time, whatever the switch says. **Add codes to every link you send first, then ask your admin to turn the switch on.** Turning it on breaks every username-only link already sent, including ones in learners' inboxes.

---

## 3. Get a login code

```
POST {API_BASE_URL}/auth-service/open/v1/login-codes
Content-Type: application/json
X-API-Key: vak_login_…
```

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | one of `email` / `username` / `user_id` | The learner's email. Case doesn't matter. |
| `username` | string | | Use this instead of `email` if you already know the username. |
| `user_id` | string | | Vacademy user id, if you store it. |
| `expires_in_days` | integer | no | 1–30. Default **7**. |

Send **exactly one** of `email`, `username` or `user_id`.

The learner must be an active (or invited) learner of **your** institute. The institute is worked out from your key, never from the request. Codes are never issued for admins or teachers.

If one email has several learner accounts in your institute, the most recently created one is used.

### Response `200`

```json
{
  "code": "mpZtycqvGrq1U4x0SBLBRg",
  "expires_at": "2026-10-23T09:14:02.511Z",
  "user_id": "0b6c3d0e-…",
  "username": "rahul@example.com",
  "query_param": "lc"
}
```

| Field | Use |
|---|---|
| `code` | Goes in the link as `?lc=<code>`. 22 characters, safe in a URL as-is. |
| `expires_at` | When the code stops working (UTC). |
| `username` | Goes in the link path. **Always use this value**, because the username isn't always the email. |
| `user_id` | For your records. |
| `query_param` | Always `lc`. |

**Code rules**
- A code works only for that one learner, in your institute.
- It can be used more than once (the learner may open the link twice, or on two devices) until `expires_at`.
- Request a **new code for each message** you send. Don't store one code per learner long term.
- Vacademy keeps only a fingerprint of each code, so a code can't be looked up or re-sent later.

---

## 4. Build the link

```
{LEARNER_PORTAL_URL}/user-profile/edit/{url-encoded username}?lc={code}
```

Example:

```
https://learner.yourinstitute.com/user-profile/edit/rahul%40example.com?lc=mpZtycqvGrq1U4x0SBLBRg
```

- **URL-encode the username.** Many usernames are emails, so `@` becomes `%40`.
- `lc` must be the exact query parameter name.

### What the learner sees

1. **They open the link.** The portal checks the code, signs them in and removes `?lc=` from the address bar.
2. **They land on the "Edit profile" page.** If they were already signed in, they go straight there.
3. **If the code has expired or is wrong:**
   - **Switch on:** they see "This login link has expired" and the normal login form.
   - **Switch off:** they're signed in by username as usual.

### Other pages that accept the same code

The same code works on any of these. Use the same `username` and add `?lc=<code>`:

| Page | Link |
|---|---|
| Edit profile | `/user-profile/edit/<username>?lc=<code>` |
| Dashboard | `/go/<username>?lc=<code>` |
| Manage subscription | `/subscriptions/<username>?lc=<code>` |
| Live class | `/study-library/live-class/<username>?lc=<code>` |
| Sub-org learners (sub-org admins) | `/sub-org-learners/<username>?lc=<code>` |

Any other learner-portal page also accepts `?lc=<code>` without a username (for example `/dashboard?lc=<code>`). That works only while the switch is on.

---

## 5. Errors

| Status | Body | Meaning | What to do |
|---|---|---|---|
| `400` | `{"ex": "Send exactly one of username, email or user_id", …}` | Bad request: no identifier, more than one, or `expires_in_days` outside 1–30 | Fix the request |
| `401` | `{"error": {"code": "missing_api_key", …}}` | No `X-API-Key` header | Send the header |
| `401` | `{"error": {"code": "invalid_api_key", …}}` | Key unknown, revoked or expired | Check the key; create a new one if needed |
| `403` | `{"error": {"code": "product_not_enabled", …}}` | The key isn't a login-links key (for example, an Evaluation API key) | Use a `vak_login_…` key |
| `404` | `{"ex": "No learner with that username, email or id in this institute", …}` | No active learner of your institute matches | Check the email; the person may not be enrolled yet |
| `503` | `{"error": {"code": "auth_unavailable", …}}` | Vacademy couldn't check the key just now | Retry after a few seconds (see the `Retry-After` header) |

Key errors (`401`, `403` and `503`) include a `request_id`. Quote it when contacting support.

---

## 6. Examples

### curl

```bash
curl -X POST "https://backend-stage.vacademy.io/auth-service/open/v1/login-codes" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $VACADEMY_LOGIN_LINKS_KEY" \
  -d '{"email": "rahul@example.com", "expires_in_days": 7}'
```

### Node.js (18+)

```js
const API_BASE_URL = 'https://backend-stage.vacademy.io';
const PORTAL_URL = 'https://learner.yourinstitute.com';

async function profileEditLink(email) {
  const res = await fetch(`${API_BASE_URL}/auth-service/open/v1/login-codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.VACADEMY_LOGIN_LINKS_KEY,
    },
    body: JSON.stringify({ email, expires_in_days: 7 }),
  });
  if (!res.ok) {
    throw new Error(`login-codes failed: ${res.status} ${await res.text()}`);
  }
  const { code, username } = await res.json();
  return `${PORTAL_URL}/user-profile/edit/${encodeURIComponent(username)}?lc=${encodeURIComponent(code)}`;
}
```

### PHP (WordPress)

```php
function vacademy_profile_edit_link( $email ) {
    $api_base   = 'https://backend-stage.vacademy.io';
    $portal_url = 'https://learner.yourinstitute.com';

    $res = wp_remote_post( $api_base . '/auth-service/open/v1/login-codes', array(
        'headers' => array(
            'Content-Type' => 'application/json',
            'X-API-Key'    => VACADEMY_LOGIN_LINKS_KEY, // define() in wp-config.php
        ),
        'body'    => wp_json_encode( array( 'email' => $email, 'expires_in_days' => 7 ) ),
        'timeout' => 10,
    ) );
    if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) {
        return null; // log the status and body, never the key
    }
    $data = json_decode( wp_remote_retrieve_body( $res ), true );
    return $portal_url . '/user-profile/edit/' . rawurlencode( $data['username'] )
        . '?lc=' . rawurlencode( $data['code'] );
}
```

---

## 7. Checklist before going live

- [ ] An institute admin has created a login-links key, and it's stored on your server only.
- [ ] Your server can reach the API base URL.
- [ ] A test learner's email returns a code, and the link opens their Edit profile page.
- [ ] Every message you send has a newly requested code in its link.
- [ ] After that, your admin turns on **Require a login code on every link**, and username-only links stop working.
