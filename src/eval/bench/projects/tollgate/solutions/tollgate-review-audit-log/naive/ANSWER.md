Review of internal/intake/audit.go and its call in the handler, most serious first:

1. It logs at info for every event, which multiplies log volume under load; consider sampling or a debug level.
2. `string(ev.Payload)` allocates a copy of every body; for large events that is wasteful.
3. The function name `audit` is vague, and no test covers it.
