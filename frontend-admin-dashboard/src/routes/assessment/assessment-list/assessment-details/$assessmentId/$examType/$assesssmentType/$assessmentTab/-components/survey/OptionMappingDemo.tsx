import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Example data showing the mapping process
const exampleData = {
  response: {
    questionId: "3170a913-5ec9-4418-b7c0-f4f09173a89c",
    responseData: {
      type: "MCQS",
      optionIds: ["90697e0b-3923-4712-8652-6b2fed62e39a"]
    }
  },
  questionData: {
    questionContent: "hello survey",
    questionOrder: 1,
    questionType: "MCQS",
    optionsMap: new Map([
      ["90697e0b-3923-4712-8652-6b2fed62e39a", "hii"],
      ["4ddcdad9-c041-4de0-89aa-250532137b6f", "hhhhhh"],
      ["ff0ef9cf-faf6-45f8-9bf4-7d84979ad0c0", "jj"],
      ["91162e42-77bb-40d1-8357-7d034d0ee1d0", "hh"]
    ])
  }
};

interface ProcessStep {
  key: string;
  label: string;
  description: string;
}

const buildProcessSteps = (t: TFunction): ProcessStep[] => [
  {
    key: 'fetchQuestions',
    label: t('process.steps.fetchQuestions.label'),
    description: t('process.steps.fetchQuestions.description'),
  },
  {
    key: 'createOptionsMap',
    label: t('process.steps.createOptionsMap.label'),
    description: t('process.steps.createOptionsMap.description'),
  },
  {
    key: 'parseResponse',
    label: t('process.steps.parseResponse.label'),
    description: t('process.steps.parseResponse.description'),
  },
  {
    key: 'mapIdsToContent',
    label: t('process.steps.mapIdsToContent.label'),
    description: t('process.steps.mapIdsToContent.description'),
  },
  {
    key: 'displayEnhancedUi',
    label: t('process.steps.displayEnhancedUi.label'),
    description: t('process.steps.displayEnhancedUi.description'),
  },
];

export const OptionMappingDemo: React.FC = () => {
  const { t } = useTranslation('assessmentOptionMappingDemo');
  const { response, questionData } = exampleData;

  // Simulate the parsing process
  const selectedOptionIds = response.responseData.optionIds;
  const selectedOptions = selectedOptionIds.map(optionId =>
    questionData.optionsMap.get(optionId) || optionId
  );

  const processSteps = buildProcessSteps(t);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('title')}</h2>
        <p className="text-gray-600">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Before - Raw IDs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-red-700">
              ❌ {t('before.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">{t('common.questionLabel')}</div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm">{questionData.questionContent}</p>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">{t('common.responseLabel')}</div>
                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <p className="text-sm font-mono text-red-800">
                    {t('before.selectedOptions', { ids: selectedOptionIds.join(', ') })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* After - Mapped Content */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-green-700">
              ✅ {t('after.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">{t('common.questionLabel')}</div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm">{questionData.questionContent}</p>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">{t('common.responseLabel')}</div>
                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-800">
                    {t('after.selected', { options: selectedOptions.join(', ') })}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Options Display */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('allOptions.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from(questionData.optionsMap.entries()).map(([optionId, optionContent]) => (
              <div
                key={optionId}
                className={`p-3 rounded-lg border text-sm ${
                  selectedOptionIds.includes(optionId)
                    ? 'bg-blue-100 border-blue-300 text-blue-800'
                    : 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{optionContent}</span>
                    <span className="text-xs text-gray-500 ml-2">({optionId})</span>
                  </div>
                  {selectedOptionIds.includes(optionId) && (
                    <Badge variant="outline" className="text-xs">
                      {t('allOptions.selectedBadge')}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Process Explanation */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">🔄 {t('process.title')}</h3>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
          {processSteps.map((step) => (
            <li key={step.key}>
              <strong>{step.label}</strong> {step.description}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};
