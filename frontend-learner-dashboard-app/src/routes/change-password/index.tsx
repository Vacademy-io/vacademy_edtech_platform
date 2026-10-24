import ChangePasswordPage from "@/components/common/user-profile/change-password-page";
import { hasLearnerSession } from "@/lib/auth/session-guard";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/change-password/")({
  // /change-password is listed in __root's PUBLIC_ROUTES, so the root guard
  // never runs for it and never records where the visitor was headed. Without
  // this, a shared link opened while logged out fell through to the page, which
  // read canEditProfile=false (no session, no display settings) and bounced to
  // /dashboard — and /dashboard's guard then sent them to /login?redirect=
  // /dashboard. The learner signed in and landed on the dashboard, with the
  // change-password screen they were sent to nowhere in the URL.
  //
  // location.href is pathname + searchStr + hash, already serialised (never
  // location.pathname + location.search — `search` is the parsed object).
  // The login form reads ?redirect= and navigates there after authenticating.
  beforeLoad: async ({ location }) => {
    if (await hasLearnerSession()) return;
    throw redirect({
      to: "/login",
      search: { redirect: location.href } as never,
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <ChangePasswordPage />;
}
