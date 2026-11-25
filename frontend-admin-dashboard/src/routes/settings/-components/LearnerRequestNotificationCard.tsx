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
import {
    defaultReceivesLearnerRequestNotification,
    type LearnerRequestNotificationSettings,
} from '@/types/assessment-settings';

interface Props {
    value: LearnerRequestNotificationSettings;
    onChange: (value: LearnerRequestNotificationSettings) => void;
}

const LEARNER_ROLES = new Set(['STUDENT', 'LEARNER']);

/**
 * Role-wise staff notifications for a learner's request from inside a test (a problem with a
 * question, more time, another attempt): which roles hear about it, and on which channels.
 * Roles come from getAllRoles() under their exact stored name, so the backend resolves their
 * users the same way it does for result notifications. Learner roles are not offered: the
 * learner raised the request. Editing updates the parent's state; the parent's Save persists it.
 */
export default function LearnerRequestNotificationCard({ value, onChange }: Props) {
    const { t } = useTranslation('settingsLearnerRequestNotificationCard');
    const { data: allRoles } = useQuery({
        queryKey: ['all-roles'],
        queryFn: getAllRoles,
        staleTime: 5 * 60 * 1000,
    });

    const roleList = useMemo(() => {
        const list: { key: string; label: string }[] = [];
        const seen = new Set<string>();
        const add = (key: string, label: string) => {
            const k = (key ?? '').trim();
            const u = k.toUpperCase();
            if (!k || seen.has(u) || LEARNER_ROLES.has(u)) return;
            seen.add(u);
            list.push({ key: k, label });
        };
        add('ADMIN', t('roles.admin'));
        for (const r of (allRoles as CustomRole[] | undefined) ?? []) {
            if (r?.name) add(r.name, r.name);
        }
        return list;
    }, [allRoles, t]);

    const isOn = (key: string): boolean => {
        const stored = value.roles?.[key];
        return typeof stored === 'boolean' ? stored : defaultReceivesLearnerRequestNotification(key);
    };

    const toggleRole = (key: string) =>
        onChange({ ...value, roles: { ...(value.roles ?? {}), [key]: !isOn(key) } });

    const toggleChannel = (channel: 'inApp' | 'email') =>
        onChange({ ...value, channels: { ...value.channels, [channel]: !value.channels[channel] } });

    const noRole = roleList.length > 0 && roleList.every((role) => !isOn(role.key));
    const noChannel = !value.channels.inApp && !value.channels.email;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-neutral-700">{t('rolesHeading')}</p>
                    {roleList.map((role) => {
                        const id = `learner-request-notif-${role.key}`;
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
                                    onCheckedChange={() => toggleRole(role.key)}
                                />
                            </div>
                        );
                    })}
                </div>

                <div className="space-y-3">
                    <p className="text-sm font-semibold text-neutral-700">{t('channelsHeading')}</p>
                    {(['inApp', 'email'] as const).map((channel) => {
                        const id = `learner-request-channel-${channel}`;
                        return (
                            <div
                                key={channel}
                                className="flex items-center justify-between gap-4 rounded-lg border p-4"
                            >
                                <div className="flex flex-col gap-0.5">
                                    <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
                                        {t(`channels.${channel}.label`)}
                                    </Label>
                                    <span className="text-xs text-neutral-500">
                                        {t(`channels.${channel}.hint`)}
                                    </span>
                                </div>
                                <Switch
                                    id={id}
                                    checked={value.channels[channel]}
                                    onCheckedChange={() => toggleChannel(channel)}
                                />
                            </div>
                        );
                    })}
                </div>

                {(noRole || noChannel) && (
                    <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-700">
                        {t('nobodyWarning')}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
