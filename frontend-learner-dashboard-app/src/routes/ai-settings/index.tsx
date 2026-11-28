import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  useGetUserApiKeys,
  useSaveUserApiKeys,
  useDeleteUserApiKeys,
  useGetTokenUsage,
} from "@/services/ai-settings-api";
import { Eye, EyeSlash, Key, Trash, FloppyDisk, WarningCircle, CheckCircle, CurrencyDollar, Gear } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { format, isValid } from "date-fns";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { AI_SERVICE_BASE_URL } from "@/constants/urls";
import {
  setAiSettingsShortcutEnabled,
  useAiSettingsShortcutEnabled,
} from "@/services/ai-settings-shortcut";

import axios from "axios";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";

export const Route = createFileRoute("/ai-settings/")({
  component: AISettings,
});

interface Model {
  id: string;
  name: string;
  provider: string;
}

function APIKeyManagement() {
  const { t } = useTranslation("miscRoutesB");
  const { data: apiKeyData, isLoading } = useGetUserApiKeys();
  const saveApiKeys = useSaveUserApiKeys();
  const deleteApiKeys = useDeleteUserApiKeys();
  const [models, setModels] = useState<Model[]>([]);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [formData, setFormData] = useState({
    openai_key: "",
    gemini_key: "",
    default_model: apiKeyData?.default_model || "System Default",
  });

  // Fetch models list
  const fetchModels = useCallback(async () => {
    try {
      const token = await getTokenFromStorage(TokenKey.accessToken);
      const response = await axios({
        method: "GET",
        url: `${AI_SERVICE_BASE_URL}/models/v1/list`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      setModels(response.data.models || []);
    } catch (error) {
      console.error("Error fetching models:", error);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      await Promise.all([fetchModels()]);
    };
    initialize();
  }, [fetchModels]);

  // Set default model when models are loaded
  useEffect(() => {
    if (models.length > 0 && !formData.default_model) {
      setFormData((prev) => ({
        ...prev,
        default_model: apiKeyData?.default_model || models[0].id,
      }));
    }
  }, [models, apiKeyData?.default_model, formData.default_model]);

  const handleSave = async () => {
    try {
      const payload: Record<string, string> = {};

      if (
        formData.default_model &&
        formData.default_model !== "System Default"
      ) {
        payload.default_model = formData.default_model;
      }

      // Only include keys if they're not empty
      if (formData.openai_key) {
        payload.openai_key = formData.openai_key;
      }
      if (formData.gemini_key) {
        payload.gemini_key = formData.gemini_key;
      }

      // If no keys provided and no existing keys, show error
      if (
        !formData.openai_key &&
        !formData.gemini_key &&
        !apiKeyData?.has_openai_key &&
        !apiKeyData?.has_gemini_key
      ) {
        toast.error(t("aiSettings.apiKeys.toast.atLeastOneKey"));
        return;
      }

      await saveApiKeys.mutateAsync(payload);
      toast.success(t("aiSettings.apiKeys.toast.saveSuccess"));

      // Clear the input fields after successful save
      setFormData({
        ...formData,
        openai_key: "",
        gemini_key: "",
      });
    } catch (error) {
      toast.error(t("aiSettings.apiKeys.toast.saveError"));
      console.error(error);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("aiSettings.apiKeys.deleteConfirm"))) {
      return;
    }

    try {
      await deleteApiKeys.mutateAsync();
      toast.success(t("aiSettings.apiKeys.toast.deleteSuccess"));
      setFormData({
        openai_key: "",
        gemini_key: "",
        default_model: "System Default",
      });
    } catch (error) {
      toast.error(t("aiSettings.apiKeys.toast.deleteError"));
      console.error(error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          {t("aiSettings.apiKeys.title")}
        </CardTitle>
        <CardDescription>
          {t("aiSettings.apiKeys.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Alert */}
        {apiKeyData &&
          (apiKeyData.has_openai_key || apiKeyData.has_gemini_key) && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                {t("aiSettings.apiKeys.activeKeys", {
                  keys: [
                    apiKeyData.has_openai_key ? "OpenRouter" : null,
                    apiKeyData.has_gemini_key ? "Gemini" : null,
                  ]
                    .filter(Boolean)
                    .join(" & "),
                })}
              </AlertDescription>
            </Alert>
          )}

        {/* OpenAI Key */}
        <div className="space-y-2">
          <Label htmlFor="openai-key">{t("aiSettings.apiKeys.openrouter.label")}</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="openai-key"
                type={showOpenAIKey ? "text" : "password"}
                placeholder={
                  apiKeyData?.has_openai_key
                    ? t("aiSettings.apiKeys.openrouter.placeholderExisting")
                    : t("aiSettings.apiKeys.openrouter.placeholderNew")
                }
                value={formData.openai_key}
                onChange={(e) =>
                  setFormData({ ...formData, openai_key: e.target.value })
                }
                className="pe-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-0 top-0 h-full px-3"
                onClick={() => setShowOpenAIKey(!showOpenAIKey)}
              >
                {showOpenAIKey ? (
                  <EyeSlash className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          {apiKeyData?.has_openai_key && (
            <p className="text-xs text-muted-foreground">
              {t("aiSettings.apiKeys.openrouter.existingHint")}
            </p>
          )}
        </div>

        {/* Gemini Key */}
        <div className="space-y-2">
          <Label htmlFor="gemini-key">{t("aiSettings.apiKeys.gemini.label")}</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="gemini-key"
                type={showGeminiKey ? "text" : "password"}
                placeholder={
                  apiKeyData?.has_gemini_key
                    ? t("aiSettings.apiKeys.gemini.placeholderExisting")
                    : t("aiSettings.apiKeys.gemini.placeholderNew")
                }
                value={formData.gemini_key}
                onChange={(e) =>
                  setFormData({ ...formData, gemini_key: e.target.value })
                }
                className="pe-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-0 top-0 h-full px-3"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
              >
                {showGeminiKey ? (
                  <EyeSlash className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          {apiKeyData?.has_gemini_key && (
            <p className="text-xs text-muted-foreground">
              {t("aiSettings.apiKeys.gemini.existingHint")}
            </p>
          )}
        </div>

        {/* Default Model */}
        <div className="space-y-2">
          <Label htmlFor="default-model">{t("aiSettings.apiKeys.defaultModel.label")}</Label>
          <Select
            value={formData.default_model || models[0]?.id || ""}
            onValueChange={(value) =>
              setFormData({ ...formData, default_model: value })
            }
            disabled={models.length === 0}
          >
            <SelectTrigger id="default-model">
              <SelectValue
                placeholder={
                  models.length === 0
                    ? t("aiSettings.apiKeys.defaultModel.loading")
                    : t("aiSettings.apiKeys.defaultModel.placeholder")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("aiSettings.apiKeys.defaultModel.hint")}
          </p>
        </div>

        {/* Security Warning */}
        <Alert>
          <WarningCircle className="h-4 w-4" />
          <AlertDescription>
            {t("aiSettings.apiKeys.securityWarning")}
          </AlertDescription>
        </Alert>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            disabled={saveApiKeys.isPending}
            className="flex-1"
          >
            <FloppyDisk className="h-4 w-4 me-2" />
            {saveApiKeys.isPending
              ? t("aiSettings.apiKeys.actions.saving")
              : t("aiSettings.apiKeys.actions.save")}
          </Button>
          {apiKeyData &&
            (apiKeyData.has_openai_key || apiKeyData.has_gemini_key) && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteApiKeys.isPending}
              >
                <Trash className="h-4 w-4 me-2" />
                {t("aiSettings.apiKeys.actions.deleteAll")}
              </Button>
            )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Shown wherever the API has no value to report for a usage row. */
const EMPTY_CELL = "\u2014";

/**
 * created_at is a plain string from the API; anything unparseable would throw
 * out of `format` and take the tab down with it.
 */
function formatUsageDate(value: string | null | undefined): string {
  if (!value) return EMPTY_CELL;
  const date = new Date(value);
  return isValid(date) ? format(date, "MMM d, yyyy HH:mm") : EMPTY_CELL;
}

// Exported for the regression test that renders a priceless usage row.
export function TokenUsage() {
  const { t } = useTranslation("miscRoutesB");
  const [dateRange, setDateRange] = useState({
    start_date: format(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      "yyyy-MM-dd"
    ),
    end_date: format(new Date(), "yyyy-MM-dd"),
  });

  const { data: tokenUsage, isLoading } = useGetTokenUsage(dateRange);

  // The API leaves every price null for TTS rows and models with no configured
  // price, so nothing here may assume a number is present — a bare
  // `total_price.toFixed()` is what used to crash this whole tab.
  const rawRecords = tokenUsage?.records;
  const records = Array.isArray(rawRecords) ? rawRecords : [];

  const totalCost = records.reduce(
    (sum, record) => sum + (record.total_price ?? 0),
    0
  );
  const totalTokens = records.reduce(
    (sum, record) => sum + (record.total_tokens ?? 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CurrencyDollar className="h-5 w-5" />
          {t("aiSettings.tokenUsage.title")}
        </CardTitle>
        <CardDescription>
          {t("aiSettings.tokenUsage.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date Range Filter */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="start-date">{t("aiSettings.tokenUsage.dateRange.start")}</Label>
            <Input
              id="start-date"
              type="date"
              value={dateRange.start_date}
              onChange={(e) =>
                setDateRange({ ...dateRange, start_date: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end-date">{t("aiSettings.tokenUsage.dateRange.end")}</Label>
            <Input
              id="end-date"
              type="date"
              value={dateRange.end_date}
              onChange={(e) =>
                setDateRange({ ...dateRange, end_date: e.target.value })
              }
            />
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("aiSettings.tokenUsage.stats.totalRequests")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tokenUsage?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("aiSettings.tokenUsage.stats.totalTokens")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalTokens.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("aiSettings.tokenUsage.stats.totalCost")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalCost.toFixed(4)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Usage Records */}
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : records.length > 0 ? (
          <div className="space-y-3">
            <Label>{t("aiSettings.tokenUsage.recentActivity")}</Label>
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-start p-3 font-medium">{t("aiSettings.tokenUsage.table.date")}</th>
                      <th className="text-start p-3 font-medium">{t("aiSettings.tokenUsage.table.provider")}</th>
                      <th className="text-start p-3 font-medium">{t("aiSettings.tokenUsage.table.model")}</th>
                      <th className="text-end p-3 font-medium">{t("aiSettings.tokenUsage.table.tokens")}</th>
                      <th className="text-end p-3 font-medium">{t("aiSettings.tokenUsage.table.cost")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {records.map((record) => (
                      <tr key={record.id} className="hover:bg-muted/50">
                        <td className="p-3">
                          {formatUsageDate(record.created_at)}
                        </td>
                        <td className="p-3 capitalize">
                          {record.api_provider || EMPTY_CELL}
                        </td>
                        <td className="p-3">{record.model || EMPTY_CELL}</td>
                        <td className="p-3 text-end">
                          {(record.total_tokens ?? 0).toLocaleString()}
                        </td>
                        <td className="p-3 text-end">
                          {record.total_price == null
                            ? EMPTY_CELL
                            : `$${record.total_price.toFixed(4)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <Alert>
            <WarningCircle className="h-4 w-4" />
            <AlertDescription>
              {t("aiSettings.tokenUsage.empty")}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ChatbotPreferences() {
  const { t } = useTranslation("miscRoutesB");
  const shortcutEnabled = useAiSettingsShortcutEnabled();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gear className="h-5 w-5" />
          {t("aiSettings.chatbot.title")}
        </CardTitle>
        <CardDescription>
          {t("aiSettings.chatbot.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="chatbot-settings-shortcut">
              {t("aiSettings.chatbot.shortcut.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("aiSettings.chatbot.shortcut.hint")}
            </p>
          </div>
          <Switch
            id="chatbot-settings-shortcut"
            checked={shortcutEnabled}
            onCheckedChange={(checked) => {
              setAiSettingsShortcutEnabled(checked);
              toast.success(
                checked
                  ? t("aiSettings.chatbot.shortcut.toast.enabled")
                  : t("aiSettings.chatbot.shortcut.toast.disabled")
              );
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AISettings() {
  const { t } = useTranslation("miscRoutesB");
  return (
    <LayoutContainer>
      <div className="container mx-auto py-8 px-4 max-w-6xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("aiSettings.page.title")}</h1>
          <p className="text-muted-foreground mt-2">
            {t("aiSettings.page.description")}
          </p>
        </div>

        <ChatbotPreferences />

        <Tabs defaultValue="api-keys" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="api-keys">{t("aiSettings.page.tabs.apiKeys")}</TabsTrigger>
            <TabsTrigger value="usage">{t("aiSettings.page.tabs.usage")}</TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys">
            <APIKeyManagement />
          </TabsContent>

          <TabsContent value="usage">
            <TokenUsage />
          </TabsContent>
        </Tabs>
      </div>
    </LayoutContainer>
  );
}
