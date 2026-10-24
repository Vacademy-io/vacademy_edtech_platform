import { useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LoginForm } from "@/components/common/auth/login/forms/page/login-form";
import { AuthModal, type AuthModalRef } from "@/components/common/auth/modal/AuthModal";

export const Route = createFileRoute("/login/")({
  component: RouteComponent,
});

function RouteComponent() {
  // "Don't have an account? Sign up here" on the standalone login page. Without
  // a handler the forms fall back to navigate({ to: "/signup" }), and that route
  // is a bare redirect back to /login — so the tap did nothing. Apple reviewed
  // exactly that ("button unresponsive") on Brahm Varchas 1.0 (6). Reuse the
  // signup modal the catalogue header already opens for its own Sign Up link.
  const signupModalRef = useRef<AuthModalRef>(null);

  return (
    <div className="w-full min-h-screen bg-background">
      <LoginForm onSwitchToSignup={() => signupModalRef.current?.setIsOpen(true)} />
      <AuthModal
        ref={signupModalRef}
        initialMode="signup"
        trigger={<span style={{ display: "none" }} aria-hidden="true" />}
      />
    </div>
  );
}
