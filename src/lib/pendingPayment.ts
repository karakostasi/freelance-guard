import type { FundingForm } from "../hooks/useFiatFunding";

// The Jobs page hands a bank-transfer payment to the Payment flow page, which runs and shows it.
let pending: FundingForm | null = null;

export const setPendingPayment = (form: FundingForm) => {
  pending = form;
};

export const takePendingPayment = () => {
  const form = pending;
  pending = null;
  return form;
};
