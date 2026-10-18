# tollgate

tollgate receives webhooks from internal services, keeps every delivery in an append-only log and relays
each one to Meridian, signed.

## Build and run

```sh
go build ./cmd/tollgate
cp config.example.json config.json   # set partner_url
TOLLGATE_SECRET=... ./tollgate serve -config config.json
```

Services post events to `POST /v1/events`:

```json
{ "id": "evt_123", "type": "invoice.paid", "occurred_at": "2026-04-01T12:00:00Z", "payload": { ... } }
```

Other commands:

- `tollgate replay --list` prints every delivery as one JSON line.
- `tollgate replay <id>` sends a stored delivery again.
- `tollgate migrate` upgrades the delivery log after an upgrade.

## Develop

```sh
go test ./...
go vet ./...
go generate ./...   # after editing schema/events.json
```

Layout:

- `cmd/tollgate`: the server and its subcommands.
- `cmd/schemagen`: writes `internal/schema/types_gen.go` from `schema/events.json`.
- `internal/intake`: the webhook endpoint and deduplication.
- `internal/relay`: forwarding, retries and the HTTP client.
- `internal/store`: the delivery log and its migrations.
- `internal/sign`: request signatures.
- `internal/logx`, `internal/redact`, `internal/jsonx`, `internal/fsx`, `internal/clock`, `internal/config`: helpers.
- `testdata/events`: one sample event per type, listed in `index.txt`.
