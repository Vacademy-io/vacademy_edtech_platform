import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { X } from '@phosphor-icons/react';
import { useUserAutosuggestDebounced, USER_ROLES, UserDTO } from '@/services/user-autosuggest';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ADMIN_DETAILS_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

interface CounsellorData {
    autoAssignEnabled: boolean;
    assignmentStrategy: string;
    counsellorIds: string[];
}

interface CounsellorProps {
    data: CounsellorData;
    onChange: (data: CounsellorData) => void;
}

export default function Counsellor({ data, onChange }: CounsellorProps) {
    const { t } = useTranslation('settingsCounsellor');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCounsellors, setSelectedCounsellors] = useState<UserDTO[]>([]);

    // Fetch counsellors with autosuggest
    const { data: counsellors, isLoading: isLoadingCounsellors } = useUserAutosuggestDebounced(
        searchQuery,
        [USER_ROLES.ADMIN, USER_ROLES.COUNSELLOR],
        300
    );

    // Load counsellor details for existing IDs
    useEffect(() => {
        const loadCounsellorDetails = async () => {
            if (data.counsellorIds.length === 0) return;

            const instituteId = getCurrentInstituteId();
            const promises = data.counsellorIds.map((id) =>
                authenticatedAxiosInstance({
                    method: 'GET',
                    url: ADMIN_DETAILS_URL,
                    params: { instituteId, userId: id },
                }).then((res) => res.data)
            );

            try {
                const results = await Promise.all(promises);
                setSelectedCounsellors(results);
            } catch (error) {
                // Internal debug log, not user-facing — not translated.
                console.error('Failed to load counsellor details:', error);
            }
        };

        loadCounsellorDetails();
    }, [data.counsellorIds.length]); // Only reload when count changes

    const handleToggleAutoAssign = (checked: boolean) => {
        onChange({
            ...data,
            autoAssignEnabled: checked,
        });
    };

    const handleStrategyChange = (value: string) => {
        onChange({
            ...data,
            assignmentStrategy: value,
        });
    };

    const handleAddCounsellor = (counsellor: UserDTO) => {
        // Check if already added
        if (data.counsellorIds.includes(counsellor.id)) {
            return;
        }

        const newIds = [...data.counsellorIds, counsellor.id];
        setSelectedCounsellors([...selectedCounsellors, counsellor]);
        onChange({
            ...data,
            counsellorIds: newIds,
        });
        setSearchQuery(''); // Clear search
    };

    const handleRemoveCounsellor = (counsellorId: string) => {
        const newIds = data.counsellorIds.filter((id) => id !== counsellorId);
        setSelectedCounsellors(selectedCounsellors.filter((c) => c.id !== counsellorId));
        onChange({
            ...data,
            counsellorIds: newIds,
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-base font-semibold">{t('header.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('header.subtitle')}</p>
            </div>

            {/* Auto-Assign Toggle */}
            <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label htmlFor="auto-assign">{t('autoAssign.label')}</Label>
                    <p className="text-sm text-muted-foreground">{t('autoAssign.hint')}</p>
                </div>
                <Switch
                    id="auto-assign"
                    checked={data.autoAssignEnabled}
                    onCheckedChange={handleToggleAutoAssign}
                />
            </div>

            {/* Assignment Strategy */}
            {data.autoAssignEnabled && (
                <div className="space-y-2">
                    <Label htmlFor="assignment-strategy">{t('strategy.label')}</Label>
                    <Select
                        value={data.assignmentStrategy}
                        onValueChange={handleStrategyChange}
                        disabled={!data.autoAssignEnabled}
                    >
                        <SelectTrigger id="assignment-strategy">
                            <SelectValue placeholder={t('strategy.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="round_robin">
                                {t('strategy.options.roundRobin')}
                            </SelectItem>
                            <SelectItem value="least_assigned">
                                {t('strategy.options.leastAssigned')}
                            </SelectItem>
                            <SelectItem value="random">{t('strategy.options.random')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t('strategy.hint')}</p>
                </div>
            )}

            {/* Counsellor Selection */}
            <div className="space-y-4">
                <Label>{t('pool.label')}</Label>
                <p className="text-sm text-muted-foreground">{t('pool.hint')}</p>

                {/* Search Input */}
                <div>
                    <Label htmlFor="counsellor-search">{t('search.label')}</Label>
                    <Input
                        id="counsellor-search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('search.placeholder')}
                        className="mt-1"
                    />
                    {isLoadingCounsellors && (
                        <p className="mt-2 text-sm text-gray-500">{t('search.loading')}</p>
                    )}
                    {counsellors && counsellors.length > 0 && searchQuery && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border">
                            {counsellors.map((counsellor) => (
                                <button
                                    key={counsellor.id}
                                    type="button"
                                    onClick={() => handleAddCounsellor(counsellor)}
                                    disabled={data.counsellorIds.includes(counsellor.id)}
                                    className="w-full border-b p-3 text-left transition-colors last:border-0 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <div className="font-medium">{counsellor.full_name}</div>
                                    <div className="text-sm text-gray-500">{counsellor.email}</div>
                                    {data.counsellorIds.includes(counsellor.id) && (
                                        <div className="text-xs text-green-600">
                                            {t('search.alreadyAdded')}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                    {searchQuery &&
                        counsellors &&
                        counsellors.length === 0 &&
                        !isLoadingCounsellors && (
                            <p className="mt-2 text-sm text-gray-500">{t('search.noneFound')}</p>
                        )}
                </div>

                {/* Selected Counsellors */}
                {data.counsellorIds.length > 0 ? (
                    <div className="space-y-2">
                        <Label>
                            {t('selected.label', { count: data.counsellorIds.length })}
                        </Label>
                        <div className="space-y-2">
                            {data.counsellorIds.map((id) => {
                                const counsellor = selectedCounsellors.find((c) => c.id === id);
                                return (
                                    <div
                                        key={id}
                                        className="flex items-center justify-between rounded-md border bg-gray-50 p-3"
                                    >
                                        <div>
                                            <div className="font-medium">
                                                {counsellor?.full_name ||
                                                    t('selected.unknownName')}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                {counsellor?.email || id}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCounsellor(id)}
                                            className="text-gray-400 hover:text-red-600"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                        {t('selected.empty')}
                    </div>
                )}
            </div>
        </div>
    );
}
