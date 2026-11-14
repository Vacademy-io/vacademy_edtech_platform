import React from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Helper functions to parse response data (same as in SurveyIndividualRespondentsTab)
const formatMcqAnswer = (responseData: any): string => {
  if (responseData.optionIds && responseData.optionIds.length > 0) {
    return i18next.t('assessmentResponseParsingDemo:response.selectedOptions', {
      options: responseData.optionIds.join(', '),
    });
  }
  return i18next.t('assessmentResponseParsingDemo:response.noOptionsSelected');
};

const formatNumericAnswer = (responseData: any): string => {
  if (responseData.validAnswer !== null && responseData.validAnswer !== undefined) {
    return i18next.t('assessmentResponseParsingDemo:response.answerValue', {
      value: responseData.validAnswer,
    });
  }
  return i18next.t('assessmentResponseParsingDemo:response.noNumericAnswer');
};

const formatTextAnswer = (responseData: any): string => {
  if (responseData.answer && responseData.answer.trim() !== '') {
    return responseData.answer;
  }
  return i18next.t('assessmentResponseParsingDemo:response.noTextAnswer');
};

const formatAnswerByType = (responseData: any): string => {
  switch (responseData.type) {
    case 'MCQS':
    case 'MCQM':
    case 'TRUE_FALSE':
      return formatMcqAnswer(responseData);
    case 'NUMERIC':
      return formatNumericAnswer(responseData);
    case 'ONE_WORD':
    case 'LONG_ANSWER':
      return formatTextAnswer(responseData);
    default:
      return i18next.t('assessmentResponseParsingDemo:response.unknownType');
  }
};

const parseResponseData = (responseString: string) => {
  try {
    const response = JSON.parse(responseString);
    const responseData = response.responseData || {};

    const formattedAnswer = formatAnswerByType(responseData);

    return createParsedResponse(response, responseData, formattedAnswer);
  } catch (error) {
    return createErrorResponse(responseString);
  }
};

const createParsedResponse = (response: any, responseData: any, formattedAnswer: string) => ({
  questionId: response.questionId || i18next.t('assessmentResponseParsingDemo:response.unknown'),
  questionType: responseData.type || i18next.t('assessmentResponseParsingDemo:response.unknown'),
  formattedAnswer,
  timeTaken: response.timeTakenInSeconds || 0,
  durationLeft: response.questionDurationLeftInSeconds || 0,
  isVisited: response.isVisited || false,
  isMarkedForReview: response.isMarkedForReview || false,
  rawResponse: response,
});

const createErrorResponse = (responseString: string) => ({
  questionId: i18next.t('assessmentResponseParsingDemo:response.unknown'),
  questionType: i18next.t('assessmentResponseParsingDemo:response.unknown'),
  formattedAnswer: i18next.t('assessmentResponseParsingDemo:response.parseError'),
  timeTaken: 0,
  durationLeft: 0,
  isVisited: false,
  isMarkedForReview: false,
  rawResponse: responseString,
});

// Example responses from your data
const exampleResponses = [
  {
    id: 'response-1',
    answer: '{"questionId":"3e34603c-711b-4c26-ad44-0d4063fab7d4","questionDurationLeftInSeconds":0,"timeTakenInSeconds":0,"isMarkedForReview":false,"isVisited":false,"responseData":{"type":"MCQS","optionIds":[]}}'
  },
  {
    id: 'response-2',
    answer: '{"questionId":"9861fe20-cd6d-4260-8fd3-6963e18d86df","questionDurationLeftInSeconds":0,"timeTakenInSeconds":3,"isMarkedForReview":false,"isVisited":true,"responseData":{"type":"NUMERIC","validAnswer":6}}'
  },
  {
    id: 'response-3',
    answer: '{"questionId":"0b7a6fe4-10f3-4997-bb0e-40677b544ab9","questionDurationLeftInSeconds":0,"timeTakenInSeconds":2,"isMarkedForReview":false,"isVisited":true,"responseData":{"type":"MCQM","optionIds":["69db8300-af8b-4df5-b977-e5e9ac01629c"]}}'
  },
  {
    id: 'response-4',
    answer: '{"questionId":"9540a63f-0986-4cd6-8dbf-5cd879e684a5","questionDurationLeftInSeconds":0,"timeTakenInSeconds":3,"isMarkedForReview":false,"isVisited":true,"responseData":{"type":"TRUE_FALSE","optionIds":["6a3303e0-1f32-4c47-af67-494c77fae470"]}}'
  },
  {
    id: 'response-5',
    answer: '{"questionId":"5b086385-1961-4111-aad8-e65051b485da","questionDurationLeftInSeconds":0,"timeTakenInSeconds":0,"isMarkedForReview":false,"isVisited":false,"responseData":{"type":"ONE_WORD","answer":""}}'
  }
];

export const ResponseParsingDemo: React.FC = () => {
  const { t } = useTranslation('assessmentResponseParsingDemo');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('header.title')}</h2>
        <p className="text-gray-600">{t('header.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {exampleResponses.map((response, index) => {
          const parsedResponse = parseResponseData(response.answer);

          return (
            <Card key={response.id} className="h-fit">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg font-semibold flex-1">
                    {t('card.title', { number: index + 1 })}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary-100 text-primary-800 border-primary-200">
                      {parsedResponse.questionType}
                    </Badge>
                    {parsedResponse.isVisited && (
                      <Badge variant="outline" className="text-xs">
                        {t('card.visited')}
                      </Badge>
                    )}
                    {parsedResponse.isMarkedForReview && (
                      <Badge variant="outline" className="text-xs">
                        {t('card.markedForReview')}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Before - Raw JSON */}
                  <div>
                    <div className="text-sm font-medium text-red-700 mb-2">{t('card.beforeLabel')}</div>
                    <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-xs font-mono text-red-800 break-all">
                        {response.answer}
                      </p>
                    </div>
                  </div>

                  {/* After - Parsed Response */}
                  <div>
                    <div className="text-sm font-medium text-green-700 mb-2">{t('card.afterLabel')}</div>
                    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-sm font-medium text-green-800">
                        {parsedResponse.formattedAnswer}
                      </p>
                    </div>
                  </div>

                  {/* Response Metadata */}
                  <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
                    <div className="flex items-center gap-4">
                      <span>{t('card.timeTaken', { seconds: parsedResponse.timeTaken })}</span>
                      <span>{t('card.durationLeft', { seconds: parsedResponse.durationLeft })}</span>
                    </div>
                    <span>{t('card.questionId', { id: parsedResponse.questionId })}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">{t('improvements.title')}</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>{t('improvements.humanReadable.bold')}</strong> {t('improvements.humanReadable.text')}</li>
          <li>• <strong>{t('improvements.questionTypeBadges.bold')}</strong> {t('improvements.questionTypeBadges.text')}</li>
          <li>• <strong>{t('improvements.statusIndicators.bold')}</strong> {t('improvements.statusIndicators.text')}</li>
          <li>• <strong>{t('improvements.timeTracking.bold')}</strong> {t('improvements.timeTracking.text')}</li>
          <li>• <strong>{t('improvements.questionIdReference.bold')}</strong> {t('improvements.questionIdReference.text')}</li>
          <li>• <strong>{t('improvements.surveySpecific.bold')}</strong> {t('improvements.surveySpecific.text')}</li>
        </ul>
      </div>
    </div>
  );
};
