// Package schema lists the event types tollgate accepts.
package schema

//go:generate go run tollgate/cmd/schemagen -in ../../schema/events.json -out types_gen.go

// Field is one field of an event payload.
type Field struct {
	Name string
	Type string
}
