import { useState } from 'react';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Calendar, Repeat, CalendarDays, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type RecurrenceScope = 'ONLY_THIS' | 'ALL_FUTURE' | 'CURRENT_DAY_ALL_SESSIONS' | 'ALL_FUTURE_ALL_SESSIONS';

interface LiveClassLinkFieldProps {
    value: string;
    onChange: (value: string) => void;
    onApplyWithScope: (scope: RecurrenceScope) => void;
    isEdit: boolean;
    dayName?: string;
}

export const LiveClassLinkField = ({ value, onChange, onApplyWithScope, isEdit, dayName }: LiveClassLinkFieldProps) => {
    const { t } = useTranslation('studyLibraryLiveClassLinkField');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedScope, setSelectedScope] = useState<RecurrenceScope | null>(null);
    const resolvedDayName = dayName ?? t('defaultDayName');

    const handleApplyClick = () => {
        setIsDialogOpen(true);
    };

    const handleConfirm = () => {
        if (selectedScope) {
            onApplyWithScope(selectedScope);
            setIsDialogOpen(false);
        }
    };

    return (
        <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('urlInputPlaceholder')}
                    input={value}
                    onChangeFunction={(e) => onChange(e.target.value)}
                    className="w-full"
                />
            </div>
            {isEdit && (
                <MyButton
                    type="button"
                    buttonType="primary"
                    onClick={handleApplyClick}
                    className="h-10 px-4"
                >
                    {t('actions.apply')}
                </MyButton>
            )}

            <MyDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                heading={t('dialog.heading')}
                className="w-[600px]"
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {/* Option 1: Only This Session */}
                        <div
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all hover:bg-gray-50 ${selectedScope === 'ONLY_THIS' ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}
                            onClick={() => setSelectedScope('ONLY_THIS')}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-full bg-blue-100 p-2 text-blue-600">
                                    <Calendar className="size-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{t('options.onlyThis.title')}</h3>
                                    <p className="mt-1 text-sm text-gray-500">{t('options.onlyThis.description')}</p>
                                    <p className="mt-2 text-xs font-medium text-gray-400">{t('options.onlyThis.example', { dayName: resolvedDayName })}</p>
                                </div>
                            </div>
                        </div>

                        {/* Option 2: Current Day All Sessions */}
                        <div
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all hover:bg-gray-50 ${selectedScope === 'CURRENT_DAY_ALL_SESSIONS' ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}
                            onClick={() => setSelectedScope('CURRENT_DAY_ALL_SESSIONS')}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-full bg-green-100 p-2 text-green-600">
                                    <CalendarDays className="size-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{t('options.currentDayAllSessions.title', { dayName: resolvedDayName })}</h3>
                                    <p className="mt-1 text-sm text-gray-500">{t('options.currentDayAllSessions.description', { dayName: resolvedDayName })}</p>
                                    <p className="mt-2 text-xs font-medium text-gray-400">{t('options.currentDayAllSessions.example', { dayName: resolvedDayName })}</p>
                                </div>
                            </div>
                        </div>

                        {/* Option 3: All Upcoming Sessions (same time slot) */}
                        <div
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all hover:bg-gray-50 ${selectedScope === 'ALL_FUTURE' ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}
                            onClick={() => setSelectedScope('ALL_FUTURE')}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-full bg-purple-100 p-2 text-purple-600">
                                    <Repeat className="size-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{t('options.allFuture.title')}</h3>
                                    <p className="mt-1 text-sm text-gray-500">{t('options.allFuture.description')}</p>
                                    <p className="mt-2 text-xs font-medium text-gray-400">{t('options.allFuture.example', { dayName: resolvedDayName })}</p>
                                </div>
                            </div>
                        </div>

                        {/* Option 4: All Upcoming Days All Sessions */}
                        <div
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all hover:bg-gray-50 ${selectedScope === 'ALL_FUTURE_ALL_SESSIONS' ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}
                            onClick={() => setSelectedScope('ALL_FUTURE_ALL_SESSIONS')}
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-full bg-orange-100 p-2 text-orange-600">
                                    <RefreshCw className="size-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{t('options.allFutureAllSessions.title', { dayName: resolvedDayName })}</h3>
                                    <p className="mt-1 text-sm text-gray-500">{t('options.allFutureAllSessions.description', { dayName: resolvedDayName })}</p>
                                    <p className="mt-2 text-xs font-medium text-gray-400">{t('options.allFutureAllSessions.example', { dayName: resolvedDayName })}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setIsDialogOpen(false)}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirm}
                            disable={!selectedScope}
                        >
                            {t('actions.confirmAndApply')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>
        </div>
    );
};
