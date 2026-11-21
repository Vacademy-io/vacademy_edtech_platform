import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { USER_AI_KEY, USER_TOKEN_USAGE } from "@/constants/urls";
import { getUserId } from "@/constants/getUserId";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  getTokenFromCookie,
  getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { toast } from "sonner";

// Types for API responses
export interface ApiKeyData {
  id: string;
  institute_id: string;
  user_id: string;
  has_openai_key: boolean;
  has_gemini_key: boolean;
  default_model: string;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SaveApiKeyRequest {
  openai_key?: string;
  gemini_key?: string;
  default_model?: string;
}

export interface TokenUsageRecord {
  id: string;
  institute_id: string;
  user_id: string;
  api_provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // Pricing is only stamped when the model has a known price, so every one of
  // these comes back null for TTS rows and unpriced models.
  input_token_price: number | null;
  output_token_price: number | null;
  total_price: number | null;
  request_type: string;
  request_id: string | null;
  request_metadata: string | null;
  created_at: string;
}

export interface TokenUsageResponse {
  records: TokenUsageRecord[];
  total: number;
}

export interface TokenUsageParams {
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
}

// Get user's API keys
export const getUserApiKeys = async (): Promise<ApiKeyData | null> => {
  try {
    const userId = await getUserId();
    const token = getTokenFromStorage(TokenKey.accessToken);
    const response = await axios({
      method: "GET",
      url: `${USER_AI_KEY}/${userId}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    return response.data;
  } catch (error: any) {
    // Return null if no keys found (404)
    if (error?.response?.status === 404) {
      toast.info("No keys found!");
      return null;
    }
    console.error("Error fetching API keys:", error);
    throw error;
  }
};

// Save or update user's API keys
export const saveUserApiKeys = async (
  data: SaveApiKeyRequest
): Promise<ApiKeyData> => {
  const userId = await getUserId();
  const token = getTokenFromStorage(TokenKey.accessToken);
  const response = await axios({
    method: "POST",
    url: `${USER_AI_KEY}/${userId}`,
    data: data,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data;
};

// Deactivate user's API keys
export const deactivateUserApiKeys = async (): Promise<void> => {
  const userId = await getUserId();
  const token = getTokenFromStorage(TokenKey.accessToken);
  await axios({
    method: "DELETE",
    url: `${USER_AI_KEY}/${userId}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
};

// Permanently delete user's API keys
export const deleteUserApiKeys = async (): Promise<void> => {
  const userId = await getUserId();
  const token = getTokenFromStorage(TokenKey.accessToken);
  await axios({
    method: "DELETE",
    url: `${USER_AI_KEY}/${userId}/delete`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
};

// Get token usage
export const getTokenUsage = async (
  params: TokenUsageParams = {}
): Promise<TokenUsageResponse> => {
  const userId = await getUserId();
  const token = getTokenFromStorage(TokenKey.accessToken);
  const response = await axios({
    method: "GET",
    url: `${USER_TOKEN_USAGE}/${userId}`,
    params,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
};

// React Query Hooks

export const useGetUserApiKeys = () => {
  return useQuery({
    queryKey: ["user-api-keys"],
    queryFn: getUserApiKeys,
    staleTime: 300000, // 5 minutes
  });
};

export const useSaveUserApiKeys = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveUserApiKeys,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-api-keys"] });
    },
  });
};

export const useDeactivateUserApiKeys = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deactivateUserApiKeys,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-api-keys"] });
    },
  });
};

export const useDeleteUserApiKeys = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUserApiKeys,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-api-keys"] });
    },
  });
};

export const useGetTokenUsage = (params: TokenUsageParams = {}) => {
  return useQuery({
    queryKey: ["token-usage", params],
    queryFn: () => getTokenUsage(params),
    staleTime: 60000, // 1 minute
  });
};
