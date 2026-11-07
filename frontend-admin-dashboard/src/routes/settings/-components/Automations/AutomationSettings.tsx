/**
 * Automations tab body — the entry point to the recipe-based UI for
 * non-technical admins. Renders feature cards grouped by section heading
 * (Automations / Parents / Admin & Team); clicking a card opens
 * FeatureRecipesDialog with the recipes for that feature.
 *
 * Discovers existing automations by listing active workflows and parsing
 * the `[auto:<recipeId>]` marker we write into each managed workflow's
 * description. Workflows created in the advanced builder do not have this
 * marker and are intentionally hidden from this page.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lightning, ArrowRight } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { getActiveWorkflowsQuery } from '@/services/workflow-service';
import { getInstituteId } from '@/constants/helper';
import {
    AUTOMATION_FEATURES,
    extractRecipeMarker,
    type AutomationFeature,
    type AutomationSection,
} from './automation-recipes';
import { FeatureRecipesDialog } from './FeatureRecipesDialog';

interface Props {
    isTab?: boolean;
}

const buildSectionMeta = (
    t: TFunction
): Record<AutomationSection, { label: string; tagline: string }> => ({
    general: {
        label: t('sections.general.label'),
        tagline: t('sections.general.tagline'),
    },
    parents: {
        label: t('sections.parents.label'),
        tagline: t('sections.parents.tagline'),
    },
    admin: {
        label: t('sections.admin.label'),
        tagline: t('sections.admin.tagline'),
    },
});

const SECTION_ORDER: AutomationSection[] = ['general', 'parents', 'admin'];

export default function AutomationSettings({ isTab = true }: Props) {
    const { t } = useTranslation('settingsAutomation');
    const instituteId = getInstituteId() ?? '';
    const { data: workflows = [], refetch, isLoading } = useQuery(getActiveWorkflowsQuery(instituteId));

    const [openFeature, setOpenFeature] = useState<AutomationFeature | null>(null);

    const sectionMeta = useMemo(() => buildSectionMeta(t), [t]);

    /** recipeId → workflowId (only counts workflows managed by this Settings tab). */
    const enabledMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const wf of workflows) {
            const recipeId = extractRecipeMarker(wf.description);
            if (recipeId && !map[recipeId]) map[recipeId] = wf.id;
        }
        return map;
    }, [workflows]);

    /** Group features by their section (defaults to 'general' if unset). */
    const featuresBySection = useMemo(() => {
        const map: Record<AutomationSection, AutomationFeature[]> = {
            general: [],
            parents: [],
            admin: [],
        };
        for (const feature of AUTOMATION_FEATURES) {
            const section: AutomationSection = feature.section ?? 'general';
            map[section].push(feature);
        }
        return map;
    }, []);

    const renderCard = (feature: AutomationFeature) => {
        const totalRecipes = feature.recipes.length;
        const onCount = feature.recipes.filter((r) => enabledMap[r.id]).length;
        return (
            <button
                key={feature.id}
                type="button"
                onClick={() => setOpenFeature(feature)}
                className="group rounded-xl border border-gray-200 bg-white p-5 text-left transition-all hover:border-primary-400 hover:shadow-md"
            >
                <div className="flex items-start justify-between gap-3">
                    <span className="text-3xl">{feature.icon}</span>
                    {onCount > 0 ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            {t('card.onCount', { count: onCount })}
                        </Badge>
                    ) : (
                        <Badge className="bg-gray-100 text-gray-500 hover:bg-gray-100">
                            {t('card.off')}
                        </Badge>
                    )}
                </div>
                <h3 className="mt-3 text-base font-semibold text-gray-800 group-hover:text-primary-600">
                    {feature.title}
                </h3>
                <p className="mt-1 text-xs text-gray-500">{feature.description}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>{t('card.optionsAvailable', { count: totalRecipes })}</span>
                    <span className="flex items-center gap-1 font-medium text-primary-500 opacity-0 transition-opacity group-hover:opacity-100">
                        {t('card.open')} <ArrowRight size={12} />
                    </span>
                </div>
            </button>
        );
    };

    return (
        <div className="space-y-8">
            {isTab && (
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
                        <Lightning weight="fill" className="text-primary-500" /> {t('header.title')}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">{t('header.subtitle')}</p>
                </div>
            )}

            {SECTION_ORDER.map((section) => {
                const features = featuresBySection[section];
                if (features.length === 0) return null;
                const meta = sectionMeta[section];
                return (
                    <section key={section} className="space-y-3">
                        {/* The first (general) section doesn't need its own heading,
                            because the page header above already says "Automations". */}
                        {section !== 'general' && (
                            <div className="border-l-4 border-primary-300 pl-3">
                                <h3 className="text-base font-semibold text-gray-800">
                                    {meta.label}
                                </h3>
                                <p className="mt-0.5 text-xs text-gray-500">{meta.tagline}</p>
                            </div>
                        )}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {features.map(renderCard)}
                        </div>
                    </section>
                );
            })}

            {isLoading && (
                <p className="text-xs text-gray-400">{t('loading')}</p>
            )}

            {/* Help card */}
            <Card className="border-dashed border-gray-200 bg-gray-50">
                <CardHeader className="py-3">
                    <CardTitle className="text-sm text-gray-700">{t('helpCard.title')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <p className="text-xs text-gray-500">
                        <Trans i18nKey="settingsAutomation:helpCard.description">
                            Looking for an automation that isn’t listed here, or want to fine-tune
                            recipients and conditions? You can use the{' '}
                            <a href="/workflow/create" className="font-medium text-primary-600 hover:underline">
                                advanced workflow builder
                            </a>{' '}
                            to design exactly what you need.
                        </Trans>
                    </p>
                </CardContent>
            </Card>

            <FeatureRecipesDialog
                feature={openFeature}
                enabledMap={enabledMap}
                onClose={() => setOpenFeature(null)}
                onChanged={() => {
                    refetch();
                }}
            />
        </div>
    );
}
