// Response negotiation only; this header grants no identity or permission.
// Old tabs expect a bare account and rejected HTTP failures. New clients retain
// the registrar's structured failure status without relying on English text.
export const CONNECTION_RESULT_HEADER = 'Dombot-Connection-Result';
export const CONNECTION_RESULT_CONTRACT = 'structured-v1';
