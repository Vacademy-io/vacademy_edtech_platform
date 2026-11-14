/**
 * Dialog that opens when the admin clicks one of the feature cards on the
 * Automations Settings tab. Lists each recipe for that feature as a row
 * with a Switch and short copy.
 *
 *  - Switch Off → On  : opens an inline RecipeConfigureForm
 *  - Switch On  → Off : opens a small confirm; deletes the workflow
 *  - Edit button      : opens RecipeConfigureForm pre-loaded as "replace"
 *                        (delete the existing workflow then create the new)
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { CheckCircle, Plus } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { deleteWorkflow } from '@/services/workflow-service';
import type { AutomationFeature, AutomationRecipe } from './automation-recipes';
import { RecipeConfigureForm } from './RecipeConfigureForm';

interface Props {
    feature: AutomationFeature | null;
    /** Map of recipeId → workflowId for recipes currently turned on. */
    enabledMap: Record<string, string>;
    onClose: () => void;
    onChanged: () => void;
}

export function FeatureRecipesDialog({ feature, enabledMap, onClose, onChanged }: Props) {
    const { t } = useTranslation('settingsFeatureRecipesDialog');
    const queryClient = useQueryClient();
    const [configuring, setConfiguring] = useState<string | null>(null);
    const [confirmOff, setConfirmOff] = useState<AutomationRecipe | null>(null);
    const [busy, setBusy] = useState(false);

    if (!feature) return null;

    const handleStartSetup = (recipe: AutomationRecipe) => {
        setConfiguring(recipe.id);
    };

    const handleTurnOffRequested = (recipe: AutomationRecipe) => {
        setConfirmOff(recipe);
    };

    const handleTurnOff = async () => {
        if (!confirmOff) return;
        const workflowId = enabledMap[confirmOff.id];
        if (!workflowId) {
            setConfirmOff(null);
            return;
        }
        setBusy(true);
        try {
            await deleteWorkflow(workflowId);
            await queryClient.invalidateQueries({
                queryKey: ['GET_ACTIVE_WORKFLOWS_WITH_SCHEDULES'],
                refetchType: 'all',
            });
            toast.success(t('toasts.turnedOff'));
            onChanged();
            setConfirmOff(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('toasts.unknownError');
            toast.error(t('toasts.turnOffFailed', { message: msg }));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Dialog open={!!feature} onOpenChange={(open) => { if (!open) onClose(); }}>
                <DialogContent className="w-dialog-md max-h-dialog-tall overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <span className="text-2xl">{feature.icon}</span>
                            {feature.title}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-gray-500">
                            {feature.description}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 pt-2">
                        {feature.recipes.map((recipe) => {
                            const isOn = !!enabledMap[recipe.id];
                            const isConfiguring = configuring === recipe.id;
                            return (
                                <div
                                    key={recipe.id}
                                    className={
                                        isOn
                                            ? 'rounded-lg border border-green-200 bg-green-50/60 p-4'
                                            : 'rounded-lg border border-gray-200 bg-white p-4 hover:border-primary-300 hover:bg-primary-50/20 transition-colors'
                                    }
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="text-2xl">{recipe.icon}</span>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between gap-3">
                                                <h4 className="text-sm font-semibold text-gray-800">
                                                    {recipe.label}
                                                </h4>
                                                {isOn ? (
                                                    <div className="flex items-center gap-2">
                                                        <CheckCircle weight="fill" className="size-4 text-green-600" />
                                                        <Switch
                                                            checked
                                                            onCheckedChange={(checked) => {
                                                                if (!checked) handleTurnOffRequested(recipe);
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    !isConfiguring && (
                                                        <Button
                                                            size="sm"
                                                            className="h-8 gap-1 bg-primary-500 px-3 text-xs text-white hover:bg-primary-600"
                                                            onClick={() => handleStartSetup(recipe)}
                                                        >
                                                            <Plus size={12} weight="bold" />
                                                            {t('recipe.setUpButton')}
                                                        </Button>
                                                    )
                                                )}
                                            </div>
                                            <p className="mt-1 text-xs text-gray-500">
                                                {recipe.whatHappens}
                                            </p>
                                            <p className="mt-1 text-2xs uppercase tracking-wide text-gray-400">
                                                {recipe.mode === 'scheduled'
                                                    ? t('recipe.modeScheduled')
                                                    : t('recipe.modeTriggered')}
                                            </p>
                                        </div>
                                    </div>

                                    {isConfiguring && (
                                        <div className="mt-4">
                                            <RecipeConfigureForm
                                                recipe={recipe}
                                                onCancel={() => setConfiguring(null)}
                                                onSaved={() => {
                                                    setConfiguring(null);
                                                    onChanged();
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Turn-off confirm */}
            <Dialog open={!!confirmOff} onOpenChange={(open) => { if (!open) setConfirmOff(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('turnOffDialog.title')}</DialogTitle>
                        <DialogDescription>
                            {t('turnOffDialog.descriptionPart1')}
                            <strong>{confirmOff?.label}</strong>
                            {t('turnOffDialog.descriptionPart2')}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setConfirmOff(null)} disabled={busy}>
                            {t('turnOffDialog.cancel')}
                        </Button>
                        <MyButton buttonType="primary" disabled={busy} onClick={handleTurnOff}>
                            {busy ? t('turnOffDialog.turningOff') : t('turnOffDialog.turnOff')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
