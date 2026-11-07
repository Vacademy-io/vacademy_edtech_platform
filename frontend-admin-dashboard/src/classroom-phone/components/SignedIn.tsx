import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { SignInForm } from './SignInForm';

/** Shows the sign-in form until there is a JWT, and again whenever the server refuses it. */
export function SignedIn({
    instituteId,
    instituteName,
    children,
}: {
    instituteId?: string | null;
    instituteName?: string | null;
    children: ReactNode;
}) {
    const { signedIn } = useAuth();
    if (!signedIn) return <SignInForm instituteId={instituteId} instituteName={instituteName} />;
    return <>{children}</>;
}
