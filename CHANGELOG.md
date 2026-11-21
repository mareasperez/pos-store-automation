# Changelog

## Unreleased

- Sign-in theme fixtures serve the API-owned captcha configuration.

- Assign a dedicated cashier session to each worker without modulo reuse. Authenticated workers
  fail before starting their flows when there are insufficient sessions or the assigned sessions
  have missing or duplicate cashier IDs; replacement workers retain their slot's cashier.
- Use the effective browser API target for expense and combo preflights; combo mutations require
  local or explicitly selected dev, an authorized actor and that actor's existing open shift.
- Enter exact sale-line return quantities, wait for quote-sale eligibility, and select the requested
  POS product suggestion rather than unrelated native options.
- Run target and serial-repair helper checks with isolated configuration and blocked env-file reads.
- Select combo component quantities by their exact accessible label, including decimal text inputs.
- Wait for catalog readiness, the refreshed total and an enabled Save button before awaiting the
  combo recipe-change quote update response.
