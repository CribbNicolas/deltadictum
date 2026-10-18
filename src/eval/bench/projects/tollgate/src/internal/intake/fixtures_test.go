package intake

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEveryFixtureIsAccepted(t *testing.T) {
	dir := filepath.Join("..", "..", "testdata", "events")
	index, err := os.ReadFile(filepath.Join(dir, "index.txt"))
	if err != nil {
		t.Fatal(err)
	}
	f := newFixture(t)
	for _, name := range strings.Fields(string(index)) {
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if res := post(f.h, string(body)); res.Code != http.StatusAccepted {
			t.Errorf("%s: status %d %s", name, res.Code, res.Body)
		}
	}
}
