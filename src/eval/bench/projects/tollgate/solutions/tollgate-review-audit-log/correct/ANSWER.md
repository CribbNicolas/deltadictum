Review of internal/intake/audit.go and its call in the handler, most serious first:

1. `audit` logs the full payload of every accepted event. Payloads carry customer emails, phone numbers and card last4, so this puts personal data into the logs. Pass the payload through `redact.Payload` before logging it, or log only the id and type.
2. It logs at info for every event, which multiplies log volume under load; consider sampling or a debug level.
3. No test covers it.
