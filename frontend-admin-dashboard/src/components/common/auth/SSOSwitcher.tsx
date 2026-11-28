import React from 'react';
import { MyButton } from '@/components/design-system/button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowSquareOut, GraduationCap, Student } from '@phosphor-icons/react';
import {
    getTokenFromCookie,
    generateSSOUrl,
    canAccessLearnerPlatform,
} from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

interface SSOSwitcherProps {
    variant?: 'button' | 'dropdown' | 'inline';
    className?: string;
}

export function SSOSwitcher({ variant = 'button', className = '' }: SSOSwitcherProps) {
    const { instituteDetails } = useInstituteDetailsStore();
    const [userRoles, setUserRoles] = React.useState<string[]>([]);
    const [canSwitchToLearner, setCanSwitchToLearner] = React.useState(false);

    React.useEffect(() => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        if (accessToken) {
            // The switch lands on THIS institute's learner portal, so it only makes sense
            // when the user is a learner here — a STUDENT role in another institute
            // doesn't count.
            const roles = getRolesForCurrentInstitute();
            setUserRoles(roles);
            setCanSwitchToLearner(
                canAccessLearnerPlatform(accessToken) && roles.includes('STUDENT')
            );
        }
    }, []);

    const switchToLearnerPlatform = () => {
        const ssoUrl = generateSSOUrl(
            instituteDetails?.learner_portal_base_url ?? '',
            '/dashboard'
        );
        if (ssoUrl) {
            window.location.href = ssoUrl;
        } else {
            window.location.href = `https://${instituteDetails?.learner_portal_base_url ?? ''}/login`;
        }
    };

    // Don't show switcher if user can't access other platform
    const showLearnerSwitch = canSwitchToLearner;

    if (!showLearnerSwitch) {
        return null;
    }

    if (variant === 'inline') {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                <Badge variant="outline" className="text-xs">
                    {userRoles.join(', ')}
                </Badge>
                {showLearnerSwitch && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={switchToLearnerPlatform}
                        className="text-xs"
                    >
                        <GraduationCap className="mr-1 size-3" />
                        Switch to Learner
                        <ArrowSquareOut className="ml-1 size-3" />
                    </Button>
                )}
            </div>
        );
    }

    if (variant === 'button') {
        return (
            <div className={className}>
                {showLearnerSwitch && (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={switchToLearnerPlatform}
                        aria-label="Switch to Learner"
                        className="gap-1.5 px-2.5 sm:px-3"
                    >
                        <Student className="size-4 shrink-0" weight="bold" />
                        <span className="hidden sm:inline">Switch to Learner</span>
                        <ArrowSquareOut className="size-3.5 shrink-0" />
                    </MyButton>
                )}
            </div>
        );
    }

    if (variant === 'dropdown') {
        return (
            <div className={className}>
                <button
                    type="button"
                    onClick={switchToLearnerPlatform}
                    className="flex w-full items-center gap-2 text-left text-sm text-neutral-700"
                >
                    <Student className="size-4 shrink-0 text-primary-500" weight="bold" />
                    <span className="flex-1">Switch to Learner</span>
                    <ArrowSquareOut className="size-3.5 shrink-0 text-neutral-400" />
                </button>
            </div>
        );
    }

    return null;
}

export default SSOSwitcher;
