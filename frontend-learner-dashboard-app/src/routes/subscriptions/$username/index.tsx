import { createFileRoute } from "@tanstack/react-router";
import { SubscriptionsLanding } from "../-components/subscriptions-landing";

/** /subscriptions/<username>: every membership, with stop, renew and change-plan. */
export const Route = createFileRoute("/subscriptions/$username/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { username } = Route.useParams();
  return <SubscriptionsLanding username={username} variant="manage" />;
}
