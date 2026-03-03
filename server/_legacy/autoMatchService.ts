export async function runAutoMatch(): Promise<void> {
  console.log("Auto-match is disabled");
}

export async function runAutoMatchForPayment(paymentId: string): Promise<void> {
  console.log("Auto-match for payment is disabled", paymentId);
}
