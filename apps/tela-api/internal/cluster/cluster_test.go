package cluster_test

import (
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/cluster"
)

func TestParsePeersEnv(t *testing.T) {
	// Unset / blank: no peers, no error -- the single-node default.
	peers, err := cluster.ParsePeersEnv("")
	if err != nil || peers != nil {
		t.Fatalf("empty = %v, %v; want nil, nil", peers, err)
	}
	peers, err = cluster.ParsePeersEnv("   ")
	if err != nil || peers != nil {
		t.Fatalf("blank = %v, %v; want nil, nil", peers, err)
	}

	peers, err = cluster.ParsePeersEnv("no2=http://tela-api-2:8000, no3=http://tela-api-3:8000/")
	if err != nil {
		t.Fatalf("valid list: %v", err)
	}
	if len(peers) != 2 {
		t.Fatalf("parsed %d peers, want 2", len(peers))
	}
	if peers[0].Name != "no2" || peers[0].Base != "http://tela-api-2:8000" {
		t.Fatalf("peer 0 = %+v", peers[0])
	}
	if peers[1].Base != "http://tela-api-3:8000" { // trailing slash trimmed: base joins paths
		t.Fatalf("peer 1 = %+v", peers[1])
	}

	// A malformed entry must be a loud startup failure, not a silently
	// half-working cluster.
	for _, bad := range []string{"sem-igual", "=http://host:8000", "nome="} {
		if _, err := cluster.ParsePeersEnv(bad); err == nil {
			t.Errorf("%q parsed without error, want a failure", bad)
		}
	}
}