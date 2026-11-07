import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Sparkle } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    getAllRoles,
    type CustomRole,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    ASSISTANT_ROLE_PRESETS,
    ASSISTANT_TOOL_CATALOG,
    ASSISTANT_TOOLS_SETTING_KEY,
    NON_LEARNER_SYSTEM_ROLES,
    defaultAssistantToolsSetting,
    type AssistantToolsSettingData,
} from '../-constants/assistant-tools';

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

const LEARNER_ROLE_NAMES = new Set(['STUDENT', 'LEARNER']);

function mergeWithDefaults(
    raw: Partial<AssistantToolsSettingData> | null
): AssistantToolsSettingData {
    const base = defaultAssistantToolsSetting();
    if (!raw) return base;
    return {
        enabled_tools: Array.isArray(raw.enabled_tools) ? raw.enabled_tools : base.enabled_tools,
        role_overrides:
            raw.role_overrides && typeof raw.role_overrides === 'object' ? raw.role_overrides : {},
    };
}

const fetchSettings = async (): Promise<AssistantToolsSettingData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: ASSISTANT_TOOLS_SETTING_KEY },
    });
    // `/get` returns a SettingDto shape: { key, name, data }.
    return mergeWithDefaults(response.data?.data ?? null);
};

const saveSettings = async (data: AssistantToolsSettingData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Vacademy Assistant Tools', setting_data: data },
        { params: { instituteId, settingKey: ASSISTANT_TOOLS_SETTING_KEY } }
    );
};

export default function AssistantToolsSettings() {
    const { t } = useTranslation('settingsAssistantTools');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<AssistantToolsSettingData>(
        defaultAssistantToolsSetting
    );
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['assistant-tools-settings'],
        queryFn: fetchSettings,
        staleTime: 5 * 60 * 1000,
    });

    const { data: customRoles } = useQuery({ queryKey: ['custom-roles'], queryFn: getAllRoles });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveSettings,
        onSuccess: () => {
            toast.success(t('toasts.settingsSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['assistant-tools-settings'] });
        },
        onError: () => toast.error(t('toasts.saveFailed')),
    });

    // Non-learner roles: the system set + any custom roles (excluding learners).
    const roleNames = useMemo(() => {
        const names = new Set(NON_LEARNER_SYSTEM_ROLES);
        for (const r of customRoles || []) {
            const upper = (r as CustomRole).name?.toUpperCase();
            if (upper && !LEARNER_ROLE_NAMES.has(upper)) names.add(upper);
        }
        return Array.from(names);
    }, [customRoles]);

    const isToolEnabled = (key: string) => settings.enabled_tools.includes(key);

    const toggleTool = (key: string, on: boolean) => {
        setSettings((prev) => ({
            ...prev,
            enabled_tools: on
                ? Array.from(new Set([...prev.enabled_tools, key]))
                : prev.enabled_tools.filter((k) => k !== key),
        }));
        setHasChanges(true);
    };

    const isRoleCustomized = (role: string) => Boolean(settings.role_overrides[role]);

    const toggleRoleCustomized = (role: string, on: boolean) => {
        setSettings((prev) => {
            const next = { ...prev.role_overrides };
            if (on) next[role] = { enabled_tools: [...prev.enabled_tools] };
            else delete next[role];
            return { ...prev, role_overrides: next };
        });
        setHasChanges(true);
    };

    const isToolEnabledForRole = (role: string, key: string) =>
        settings.role_overrides[role]?.enabled_tools.includes(key) ?? false;

    /** One-click preset: grant the given tool groups to a role (additive). */
    const applyPreset = (role: string, tools: string[]) => {
        setSettings((prev) => {
            const current = prev.role_overrides[role]?.enabled_tools ?? [];
            return {
                ...prev,
                role_overrides: {
                    ...prev.role_overrides,
                    [role]: { enabled_tools: Array.from(new Set([...current, ...tools])) },
                },
            };
        });
        setHasChanges(true);
        toast.info(t('toasts.presetApplied'));
    };

    const toggleToolForRole = (role: string, key: string, on: boolean) => {
        setSettings((prev) => {
            const current = prev.role_overrides[role]?.enabled_tools ?? [];
            const updated = on
                ? Array.from(new Set([...current, key]))
                : current.filter((k) => k !== key);
            return {
                ...prev,
                role_overrides: { ...prev.role_overrides, [role]: { enabled_tools: updated } },
            };
        });
        setHasChanges(true);
    };

    if (isLoading) {
        return <div className="p-6 text-body text-neutral-500">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Sparkle size={20} weight="fill" className="text-primary-500" />
                        <CardTitle>{t('header.title')}</CardTitle>
                    </div>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('capabilities.title')}</CardTitle>
                    <CardDescription>{t('capabilities.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {ASSISTANT_TOOL_CATALOG.map((tool) => (
                        <div key={tool.key} className="flex items-start gap-3">
                            <Switch
                                id={`tool-${tool.key}`}
                                checked={isToolEnabled(tool.key)}
                                onCheckedChange={(v) => toggleTool(tool.key, v)}
                            />
                            <div>
                                <Label
                                    htmlFor={`tool-${tool.key}`}
                                    className="cursor-pointer text-body font-medium text-neutral-800"
                                >
                                    {t(`tools.${tool.key}.label`)}
                                </Label>
                                <p className="mt-0.5 text-caption text-neutral-600">
                                    {t(`tools.${tool.key}.description`)}
                                </p>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('perRole.title')}</CardTitle>
                    <CardDescription>{t('perRole.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 p-3">
                        <span className="text-caption font-medium text-neutral-600">
                            {t('perRole.suggestedPresets')}
                        </span>
                        {ASSISTANT_ROLE_PRESETS.map((preset) => (
                            <MyButton
                                key={preset.role}
                                buttonType="secondary"
                                scale="small"
                                onClick={() => applyPreset(preset.role, preset.tools)}
                            >
                                {t(`presets.${preset.role}`)}
                            </MyButton>
                        ))}
                    </div>
                    {roleNames.map((role) => {
                        const customized = isRoleCustomized(role);
                        return (
                            <div
                                key={role}
                                className="space-y-3 rounded-lg border border-neutral-200 p-3"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-body font-medium text-neutral-800">
                                        {role}
                                    </span>
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={customized}
                                            onCheckedChange={(v) => toggleRoleCustomized(role, v)}
                                        />
                                        <span className="text-caption text-neutral-600">
                                            {t('perRole.customize')}
                                        </span>
                                    </label>
                                </div>

                                {customized && (
                                    <div className="space-y-2 border-t border-neutral-100 pt-3">
                                        {ASSISTANT_TOOL_CATALOG.map((tool) => (
                                            <label
                                                key={tool.key}
                                                className="flex items-center gap-2"
                                            >
                                                <Switch
                                                    checked={isToolEnabledForRole(role, tool.key)}
                                                    onCheckedChange={(v) =>
                                                        toggleToolForRole(role, tool.key, v)
                                                    }
                                                />
                                                <span className="text-caption text-neutral-700">
                                                    {t(`tools.${tool.key}.label`)}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => save(settings)}
                    disable={saving || !hasChanges}
                >
                    {saving ? t('footer.saving') : t('footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
