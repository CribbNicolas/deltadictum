// Command schemagen writes internal/schema/types_gen.go from schema/events.json.
package main

import (
	"flag"
	"fmt"
	"os"

	"tollgate/internal/schema"
)

func main() {
	in := flag.String("in", "schema/events.json", "event types document")
	out := flag.String("out", "internal/schema/types_gen.go", "generated Go file")
	flag.Parse()
	data, err := os.ReadFile(*in)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	src, err := schema.Generate(data)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, src, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
