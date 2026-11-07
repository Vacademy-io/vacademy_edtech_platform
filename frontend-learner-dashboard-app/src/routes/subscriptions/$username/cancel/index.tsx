import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionsLanding } from "../../-components/subscriptions-landing";

/**
 * /subscriptions/<username>/cancel: the link renewal emails send ("thinking of stopping?").
 * A retention card with the stop button, and the renewal card under it. Same passwordless
 * login as /subscriptions/<username>, so it is listed in passwordless-landing-routes.
 */
export const Route = createFileRoute("/subscriptions/$username/cancel/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { username } = Route.useParams();
  return <SubscriptionsLanding username={username} variant="cancel" />;
}
