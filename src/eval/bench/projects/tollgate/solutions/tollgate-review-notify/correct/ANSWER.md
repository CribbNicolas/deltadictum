Review of internal/relay/notify.go, most serious first:

1. The signature is computed over `jsonx.Canonical(n)` but the request sends `json.Marshal(n)`. Canonical sorts the keys (delivery_id, event_type, status) while the struct marshals in field order (delivery_id, status, event_type), so Meridian verifies the HMAC over different bytes than it receives and every notification gets a 401. Sign the exact body slice that is sent.
2. Only 200 counts as success; Meridian may answer 202 or 204, which would be reported as a failure. Accept any 2xx.
3. There is no test. Add one with an httptest server that verifies the signature over the received body.
