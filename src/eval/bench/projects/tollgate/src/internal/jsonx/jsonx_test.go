package jsonx

import "testing"

func TestCanonicalSortsKeysAndDropsSpaces(t *testing.T) {
	got, err := Canonical(map[string]any{"b": 1, "a": map[string]any{"z": true, "y": []any{2, "x"}}})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"a":{"y":[2,"x"],"z":true},"b":1}`; string(got) != want {
		t.Fatalf("Canonical() = %s, want %s", got, want)
	}
}

func TestCanonicalOfRawJSONIsStable(t *testing.T) {
	a, _ := Canonical([]byte(`{"id": "evt_1", "amount": 1200}`))
	b, _ := Canonical([]byte(`{"amount":1200,"id":"evt_1"}`))
	if string(a) != string(b) {
		t.Fatalf("Canonical differs for equal documents: %s vs %s", a, b)
	}
}
