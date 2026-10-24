import { DripCondition } from '@/types/course-settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    formatDripRule,
    formatBehavior,
    getLevelDisplayName,
    getLevelColor,
} from '@/utils/drip-conditions';
import { PencilSimple, Trash, Lock, Eye, Target, List } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

interface DripConditionItemProps {
    condition: DripCondition;
    onEdit: (condition: DripCondition) => void;
    onDelete: (id: string) => void;
    onToggle: (id: string, enabled: boolean) => void;
}

export const DripConditionItem: React.FC<DripConditionItemProps> = ({
    condition,
    onEdit,
    onDelete,
    onToggle,
}) => {
    const { t, i18n } = useTranslation('settingsDripConditionItem');

    const getBehaviorIcon = () => {
        const behavior = condition.drip_condition[0]?.behavior;
        switch (behavior) {
            case 'lock':
                return <Lock className="size-4 text-amber-600" />;
            case 'hide':
                return <Eye className="size-4 text-blue-600" />;
            case 'both':
                return (
                    <div className="flex items-center gap-1">
                        <Lock className="size-3 text-purple-600" />
                        <Eye className="size-3 text-purple-600" />
                    </div>
                );
            default:
                return <Lock className="size-4 text-gray-600" />;
        }
    };

    return (
        <Card className={`p-4 ${!condition.enabled ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                    {/* Header */}
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge className={getLevelColor(condition.level)}>
                            <Target className="mr-1 size-3" />
                            {getLevelDisplayName(condition.level)}
                        </Badge>

                        <Badge variant="outline" className="font-mono text-xs">
                            {t('badge.id', { id: condition.level_id })}
                        </Badge>

                        {condition.level === 'package' && condition.drip_condition[0]?.target && (
                            <Badge variant="secondary" className="text-xs">
                                {t('badge.appliesTo', {
                                    target: `${condition.drip_condition[0].target}s`,
                                })}
                            </Badge>
                        )}

                        <Badge variant="outline" className="flex items-center gap-1">
                            {getBehaviorIcon()}
                            {formatBehavior(condition.drip_condition[0]?.behavior || 'lock')}
                        </Badge>
                    </div>

                    {/* Rules */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <List className="size-3" />
                            {t('rules.title', {
                                count: condition.drip_condition[0]?.rules.length || 0,
                            })}
                        </div>
                        <div className="space-y-1.5 pl-5">
                            {(condition.drip_condition[0]?.rules || []).map((rule, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-sm">
                                    <span className="min-w-4 text-muted-foreground">
                                        {idx + 1}.
                                    </span>
                                    <span className="text-gray-700">{formatDripRule(rule)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Metadata */}
                    {condition.created_at && (
                        <div className="text-xs text-muted-foreground">
                            {t('metadata.created', {
                                date: new Date(condition.created_at).toLocaleDateString(i18n.language),
                            })}
                            {condition.updated_at &&
                                condition.updated_at !== condition.created_at &&
                                t('metadata.updatedSuffix', {
                                    date: new Date(condition.updated_at).toLocaleDateString(i18n.language),
                                })}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <Switch
                        checked={condition.enabled}
                        onCheckedChange={(checked) => onToggle(condition.id, checked)}
                        title={condition.enabled ? t('actions.disable') : t('actions.enable')}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(condition)}
                        className="size-8 p-0"
                        title={t('actions.edit')}
                    >
                        <PencilSimple className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(condition.id)}
                        className="size-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                        title={t('actions.delete')}
                    >
                        <Trash className="size-4" />
                    </Button>
                </div>
            </div>
        </Card>
    );
};
