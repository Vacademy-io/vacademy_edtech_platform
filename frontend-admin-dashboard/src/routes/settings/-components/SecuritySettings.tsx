import { LoginLinksCard } from './LoginLinksCard';
import SingleSignOnCard from './SingleSignOnCard';

/**
 * Settings → General → Security. The institute's sign-in safeguards for its learners:
 * single sign-on through its own identity provider, the "require a login code" switch for
 * passwordless learner links, and the keys its own systems use to mint those codes.
 */
export default function SecuritySettings() {
    return (
        <div className="space-y-6 p-6">
            <SingleSignOnCard />
            <LoginLinksCard />
        </div>
    );
}
