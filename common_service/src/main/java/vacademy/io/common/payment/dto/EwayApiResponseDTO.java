package vacademy.io.common.payment.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class EwayApiResponseDTO {
    @JsonProperty("AuthorisationCode") public String AuthorisationCode;
    @JsonProperty("ResponseCode") public String ResponseCode;
    @JsonProperty("ResponseMessage") public String ResponseMessage;
    @JsonProperty("TransactionID") public String TransactionID;
    @JsonProperty("TransactionStatus") public Boolean TransactionStatus;
    @JsonProperty("TransactionType") public String TransactionType;
    @JsonProperty("BeagleScore") public String BeagleScore;
    @JsonProperty("Verification") public Verification Verification;
    @JsonProperty("Customer") public Customer Customer;
    @JsonProperty("Payment") public PaymentDetails Payment;
    @JsonProperty("Errors") public String Errors;
    /** Responsive Shared Page: echoed back by GetAccessCodeResult. */
    @JsonProperty("AccessCode") public String AccessCode;

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Verification {
        @JsonProperty("CVN") public int CVN;
        @JsonProperty("Address") public int Address;
        @JsonProperty("Email") public int Email;
        @JsonProperty("Mobile") public int Mobile;
        @JsonProperty("Phone") public int Phone;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @Data
    public static class Customer {
        @JsonProperty("CardDetails") public CardDetails CardDetails;
        @JsonProperty("TokenCustomerID") public String TokenCustomerID;
        @JsonProperty("Reference") public String Reference;
        @JsonProperty("Title") public String Title;
        @JsonProperty("FirstName") public String FirstName;
        @JsonProperty("LastName") public String LastName;
        @JsonProperty("CompanyName") public String CompanyName;
        @JsonProperty("JobDescription") public String JobDescription;
        @JsonProperty("Street1") public String Street1;
        @JsonProperty("Street2") public String Street2;
        @JsonProperty("City") public String City;
        @JsonProperty("State") public String State;
        @JsonProperty("PostalCode") public String PostalCode;
        @JsonProperty("Country") public String Country;
        @JsonProperty("Email") public String Email;
        @JsonProperty("Phone") public String Phone;
        @JsonProperty("Mobile") public String Mobile;
        @JsonProperty("Comments") public String Comments;
        @JsonProperty("Fax") public String Fax;
        @JsonProperty("Url") public String Url;
    }

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class CardDetails {
        @JsonProperty("Number") public String Number;
        @JsonProperty("Name") public String Name;
        @JsonProperty("ExpiryMonth") public String ExpiryMonth;
        @JsonProperty("ExpiryYear") public String ExpiryYear;
        @JsonProperty("StartMonth") public String StartMonth;
        @JsonProperty("StartYear") public String StartYear;
        @JsonProperty("IssueNumber") public String IssueNumber;
        @JsonProperty("CVN") public String CVN; // Added missing field
    }

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class PaymentDetails {
        @JsonProperty("TotalAmount") public int TotalAmount;
        @JsonProperty("InvoiceNumber") public String InvoiceNumber;
        @JsonProperty("InvoiceDescription") public String InvoiceDescription;
        @JsonProperty("InvoiceReference") public String InvoiceReference;
        @JsonProperty("CurrencyCode") public String CurrencyCode;
    }

    // Added missing Transaction class
    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Transaction {
        @JsonProperty("Customer") public Customer Customer;
        @JsonProperty("Payment") public PaymentDetails Payment;
        @JsonProperty("Method") public String Method;
        @JsonProperty("TransactionType") public String TransactionType;
        /**
         * Responsive Shared Page only: where eWay sends the learner's browser once they have
         * paid on eWay's own page. eWay appends ?AccessCode=... to it. Ignored by the Direct
         * (/Transaction) calls, which never leave our page.
         */
        @JsonProperty("RedirectUrl") public String RedirectUrl;
        /** Responsive Shared Page only: where "cancel" on eWay's page returns the learner. */
        @JsonProperty("CancelUrl") public String CancelUrl;
    }
}
