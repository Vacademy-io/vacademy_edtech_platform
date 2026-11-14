import axios from "axios";
import { PEYMENT_LOG_STATUS_URL } from "@/constants/urls";
import { classifyPaymentStatus, type PaymentOutcome } from "./pending-purchases";

/**
 * Outcome of a noted redirect payment, from the same open payment-log status
 * endpoint the payment-result page polls (getPaymentCompletionStatus). Called
 * directly so the header's cart button does not load the enrolment services.
 */
export const fetchPaymentOutcome = async (paymentLogId: string): Promise<PaymentOutcome> => {
  const response = await axios.get(PEYMENT_LOG_STATUS_URL, { params: { paymentLogId } });
  return classifyPaymentStatus(response?.data);
};
