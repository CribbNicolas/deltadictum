package schema

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGeneratedFileIsCurrent(t *testing.T) {
	spec, err := os.ReadFile(filepath.Join("..", "..", "schema", "events.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := Generate(spec)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("types_gen.go")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatal("types_gen.go is not what schemagen writes for schema/events.json")
	}
}

func TestKnownTypes(t *testing.T) {
	for _, name := range []string{"customer.updated", "invoice.created", "invoice.paid"} {
		if _, ok := Known[name]; !ok {
			t.Errorf("Known lacks %s", name)
		}
	}
	if fields := Known["invoice.created"]; len(fields) != 3 || fields[1] != (Field{Name: "amount_cents", Type: "int"}) {
		t.Errorf("invoice.created fields = %+v", fields)
	}
}

func TestGenerateRefusesAnUnknownFieldType(t *testing.T) {
	if _, err := Generate([]byte(`{"types":[{"name":"x.y","fields":[{"name":"a","type":"decimal"}]}]}`)); err == nil {
		t.Fatal("Generate accepted an unknown field type")
	}
}
