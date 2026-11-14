# Changelog

## Unreleased

- Use the effective browser API target for expense and combo preflights; combo mutations require
  local or explicitly selected dev, an authorized actor and that actor's existing open shift.
- Enter exact sale-line return quantities, wait for quote-sale eligibility, and select the requested
  POS product suggestion rather than unrelated native options.
- Run target and serial-repair helper checks with isolated configuration and blocked env-file reads.
- Select combo component quantities by their exact accessible label, including decimal text inputs.
- Wait for catalog readiness, the refreshed total and an enabled Save button before awaiting the
  combo recipe-change quote update response.
