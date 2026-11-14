import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    getAllRoles,
    type CustomRole,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { defaultReceivesResultNotification } from '@/types/assessment-settings';

interface Props {
    /** roleKey -> receives result notification. Absent role => resolved default. */
    roles: Record<string, boolean>;
    onChange: (roles: Record<string, boolean>) => void;
}

/**
 * Role-wise toggles for who receives assessment result / re-evaluation
 * notifications. Custom roles are appended from getAllRoles() using their exact
 * stored name as the key (so the backend can resolve their users). Editing here
 * updates the parent AssessmentSettings state; the parent's Save persists it.
 */
export default function ResultNotificationRecipientsCard({ roles, onChange }: Props) {
    const { t } = useTranslation('settingsResultNotificationRecipientsCard');
    const { data: allRoles } = useQuery({
        queryKey: ['all-roles'],
        queryFn: getAllRoles,
        staleTime: 5 * 60 * 1000,
    });

    // Build the list from the institute's actual roles (getAllRoles = the same
    // source auth uses), so every key here matches auth's role_name and its users
    // resolve when notifications fire. We only force ADMIN + a learner toggle to
    // exist, since those two carry non-default behavior (ADMIN off, learner on).
    const roleList = useMemo(() => {
        const list: { key: string; label: string }[] = [];
        const seen = new Set<string>();
        const add = (key: string, label: string) => {
            const k = (key ?? '').trim();
            const u = k.toUpperCase();
            if (!k || seen.has(u)) return;
            seen.add(u);
            list.push({ key: k, label });
        };
        add('ADMIN', t('roles.admin'));
        for (const r of (allRoles as CustomRole[] | undefined) ?? []) {
            if (r?.name) add(r.name, r.name); // exact stored name → auth resolves its users
        }
        if (!seen.has('STUDENT') && !seen.has('LEARNER')) add('STUDENT', t('roles.learner'));
        return list;
    }, [allRoles, t]);

    const isOn = (key: string): boolean => {
        const stored = roles?.[key];
        return typeof stored === 'boolean' ? stored : defaultReceivesResultNotification(key);
    };

    const toggle = (key: string) => {
        onChange({ ...(roles ?? {}), [key]: !isOn(key) });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {roleList.map((role) => {
                    const id = `result-notif-${role.key}`;
                    return (
                        <div
                            key={role.key}
                            className="flex items-center justify-between rounded-lg border p-4"
                        >
                            <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
                                {role.label}
                            </Label>
                            <Switch
                                id={id}
                                checked={isOn(role.key)}
                                onCheckedChange={() => toggle(role.key)}
                            />
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
