Review of internal/relay/notify.go, most serious first:

1. Only 200 counts as success; Meridian may answer 202 or 204, which would be reported as a failure. Accept any 2xx.
2. Notify does not retry on 429 like Forward does; reuse the retry loop.
3. The notification struct could live next to the other wire types, and there is no test for this file.
