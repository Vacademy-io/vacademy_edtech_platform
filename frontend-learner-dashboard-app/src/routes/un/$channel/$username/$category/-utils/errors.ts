import { isAxiosError } from "axios";
import type { TFunction } from "i18next";

export const getUnsubscribeErrorMessage = (error: unknown, t: TFunction) => {
  if (!error) {
    return t("unsubscribe.errors.generic");
  }

  if (
    isAxiosError<{ message?: string }>(error) &&
    (error.response?.data?.message || error.message)
  ) {
    return error.response?.data?.message ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t("unsubscribe.errors.generic");
};

