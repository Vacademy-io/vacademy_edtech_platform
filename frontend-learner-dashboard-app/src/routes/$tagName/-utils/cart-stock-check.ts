import axios from "axios";
import { STOCK_AVAILABILITY_URL } from "@/constants/urls";

interface StockLine {
  id: string;
  packageSessionId?: string;
  quantity: number;
}

/** Copies left, keyed by package session, for the sessions the cart wants more of than exist. */
export type StockShortages = Record<string, number>;

const sessionOf = (line: StockLine): string => line.packageSessionId || line.id;

/** Copies this cart wants per session: two lines can sell the same session through different invites. */
const quantityBySession = (lines: StockLine[]): Record<string, number> => {
  const wanted: Record<string, number> = {};
  lines.forEach((line) => {
    const session = sessionOf(line);
    wanted[session] = (wanted[session] ?? 0) + line.quantity;
  });
  return wanted;
};

export const findStockShortages = (
  lines: StockLine[],
  copiesLeft: Record<string, number>,
): StockShortages => {
  const shortages: StockShortages = {};
  Object.entries(quantityBySession(lines)).forEach(([session, wanted]) => {
    const left = copiesLeft[session];
    if (left !== undefined && wanted > left) {
      shortages[session] = left;
    }
  });
  return shortages;
};

/** Copies left for this line, while the cart still wants more than that; undefined once it is fine. */
export const copiesLeftForLine = (
  line: StockLine,
  lines: StockLine[],
  shortages: StockShortages,
): number | undefined => {
  const session = sessionOf(line);
  const left = shortages[session];
  return left !== undefined && quantityBySession(lines)[session] > left ? left : undefined;
};

/**
 * Stock problems in the cart, checked when the learner clicks Checkout. A failed check reports
 * none and lets them continue: the server still refuses an order it cannot fill at payment.
 */
export const checkCartStock = async (lines: StockLine[]): Promise<StockShortages> => {
  try {
    const sessions = Object.keys(quantityBySession(lines));
    const response = await axios.post<Record<string, number>>(STOCK_AVAILABILITY_URL, sessions);
    return findStockShortages(lines, response.data ?? {});
  } catch (error) {
    console.warn("[Cart] Could not check stock before checkout", error);
    return {};
  }
};
