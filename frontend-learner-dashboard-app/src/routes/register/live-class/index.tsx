import { createFileRoute } from "@tanstack/react-router";
import LiveClassRegistrationPage from "./-components/LiveClassRegistrationPage";
import {
  pickUtmSearchParams,
  type UtmSearchParams,
} from "@/lib/utm-search-params";

interface liveClassParams extends UtmSearchParams {
  sessionId: string;
}

export const Route = createFileRoute("/register/live-class/")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): liveClassParams => {
    return {
      sessionId: search.sessionId as string,
      // Carried through so the router does not strip the campaign off the URL
      // before the institute's tag manager reads it — see utm-search-params.
      ...pickUtmSearchParams(search),
    };
  },
});
function RouteComponent() {
  return <LiveClassRegistrationPage />;
}
