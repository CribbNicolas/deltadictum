package p

import "testing"

func TestBenchPasses(t *testing.T) {
	if One() != 1 {
		t.Fatal("One")
	}
}

func TestBenchFails(t *testing.T) { t.Fatal("fails on purpose") }
