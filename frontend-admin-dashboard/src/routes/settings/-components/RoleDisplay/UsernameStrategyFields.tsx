import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getCustomFieldSettings } from '@/services/custom-field-settings';
import type { StudentSignupSettings, UsernameStrategy } from '@/types/student-display-settings';

// Field types whose value can be a login name. Dropdowns, radios and the like give
// every learner one of a few shared values, so they can never identify one person.
const USERNAME_FIELD_TYPES = new Set(['text', 'number', 'phone']);

interface UsernameStrategyFieldsProps {
    signup: StudentSignupSettings;
    onChange: (signup: StudentSignupSettings) => void;
}

export function UsernameStrategyFields({ signup, onChange }: UsernameStrategyFieldsProps) {
    const { t } = useTranslation('settingsStudentDisplay');
    const strategy = signup.usernameStrategy;
    const usesValue = strategy === 'phone' || strategy === 'customField';

    const customFieldsQuery = useQuery({
        queryKey: ['username-strategy-custom-fields'],
        queryFn: () => getCustomFieldSettings(),
        enabled: strategy === 'customField',
        staleTime: 5 * 60 * 1000,
    });

    const eligibleFields = useMemo(() => {
        const data = customFieldsQuery.data;
        if (!data) return [];
        const seen = new Set<string>();
        return [...data.fixedFields, ...data.instituteFields, ...data.customFields].filter(
            (field) => {
                if (!field.id || seen.has(field.id) || !USERNAME_FIELD_TYPES.has(field.type)) {
                    return false;
                }
                seen.add(field.id);
                return true;
            }
        );
    }, [customFieldsQuery.data]);

    const selectedField = eligibleFields.find((f) => f.id === signup.usernameCustomFieldId);
    const prefix = (signup.usernamePrefix ?? '').trim().toLowerCase();

    const preview = (() => {
        if (strategy === 'phone') return `${prefix}9876543210`;
        if (strategy === 'customField') return `${prefix}101`;
        if (strategy === 'email') return 'asha@example.com';
        return null;
    })();

    const set = (patch: Partial<StudentSignupSettings>) => onChange({ ...signup, ...patch });

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <Label className="text-xs">{t('loginSignup.usernameStrategy')}</Label>
                <Select
                    value={strategy}
                    onValueChange={(v) => set({ usernameStrategy: v as UsernameStrategy })}
                >
                    <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue placeholder={t('loginSignup.selectStrategy')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="email">email</SelectItem>
                        <SelectItem value="random">random</SelectItem>
                        <SelectItem value="manual">manual</SelectItem>
                        <SelectItem value="phone">{t('loginSignup.usernamePhone')}</SelectItem>
                        <SelectItem value="customField">
                            {t('loginSignup.usernameCustomField')}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {strategy === 'customField' && (
                <div className="flex flex-wrap items-center gap-3 pl-4">
                    <Label className="text-xs">{t('loginSignup.usernameField')}</Label>
                    <Select
                        value={signup.usernameCustomFieldId ?? ''}
                        onValueChange={(v) => set({ usernameCustomFieldId: v })}
                        disabled={customFieldsQuery.isLoading}
                    >
                        <SelectTrigger className="h-8 w-48 text-xs">
                            <SelectValue
                                placeholder={
                                    customFieldsQuery.isLoading
                                        ? t('loginSignup.usernameFieldLoading')
                                        : t('loginSignup.usernameFieldPlaceholder')
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {eligibleFields.map((field) => (
                                <SelectItem key={field.id} value={field.id}>
                                    {field.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {customFieldsQuery.isError && (
                        <span className="text-xs text-danger-600">
                            {t('loginSignup.usernameFieldLoadError')}
                        </span>
                    )}
                    {!customFieldsQuery.isLoading &&
                        !customFieldsQuery.isError &&
                        eligibleFields.length === 0 && (
                            <span className="text-xs text-neutral-500">
                                {t('loginSignup.usernameFieldEmpty')}
                            </span>
                        )}
                    {selectedField && !selectedField.required && (
                        <span className="text-xs text-warning-600">
                            {t('loginSignup.usernameFieldNotRequired', {
                                field: selectedField.name,
                            })}
                        </span>
                    )}
                </div>
            )}

            {usesValue && (
                <div className="flex flex-wrap items-center gap-3 pl-4">
                    <Label className="text-xs">{t('loginSignup.usernamePrefix')}</Label>
                    <Input
                        className="h-8 w-48 text-xs"
                        value={signup.usernamePrefix ?? ''}
                        placeholder={t('loginSignup.usernamePrefixPlaceholder')}
                        onChange={(e) => set({ usernamePrefix: e.target.value })}
                    />
                    <span className="text-xs text-neutral-500">
                        {t('loginSignup.usernamePrefixHint')}
                    </span>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pl-4">
                <Switch
                    checked={!!signup.usernameApplyToAll}
                    onCheckedChange={(checked) => set({ usernameApplyToAll: checked })}
                    disabled={strategy === 'manual'}
                />
                <Label className="text-xs">{t('loginSignup.usernameApplyToAll')}</Label>
                <span className="text-xs text-neutral-500">
                    {t('loginSignup.usernameApplyToAllHint')}
                </span>
            </div>

            {signup.usernameApplyToAll && strategy !== 'manual' && strategy !== 'random' && (
                <div className="flex flex-wrap items-center gap-3 pl-8">
                    <Switch
                        checked={!!signup.usernameOverrideTyped}
                        onCheckedChange={(checked) => set({ usernameOverrideTyped: checked })}
                    />
                    <Label className="text-xs">{t('loginSignup.usernameOverrideTyped')}</Label>
                    <span className="text-xs text-neutral-500">
                        {t('loginSignup.usernameOverrideTypedHint')}
                    </span>
                </div>
            )}

            <p className="pl-4 text-xs text-neutral-500">
                {preview
                    ? t('loginSignup.usernamePreview', { example: preview })
                    : t('loginSignup.usernamePreviewNone')}{' '}
                {t('loginSignup.usernameRulesNote')}
            </p>
        </div>
    );
}
