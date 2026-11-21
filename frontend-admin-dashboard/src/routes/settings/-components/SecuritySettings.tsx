import { LoginLinksCard } from './LoginLinksCard';

/**
 * Settings → General → Security. The institute's sign-in safeguards for its learners;
 * today the "require a login code" switch for passwordless learner links and the keys
 * its own systems use to mint those codes.
 */
export default function SecuritySettings() {
    return (
        <div className="space-y-6 p-6">
            <LoginLinksCard />
        </div>
    );
}
