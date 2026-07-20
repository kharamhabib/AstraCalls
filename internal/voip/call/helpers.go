package call

import (
	"context"
	"strings"
	"kallia/internal/voip/core"
	"kallia/internal/voip/wanode"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
)

func hasChildTag(n *waBinary.Node, tag string) bool {
	for _, c := range wanode.NodeChildren(n) {
		if c.Tag == tag {
			return true
		}
	}
	return false
}

func ensureDeviceJid(jid string) string {
	if strings.Contains(jid, ":") {

		if at := strings.Index(jid, "@"); at > strings.Index(jid, ":") {
			return jid
		}
	}
	return strings.Replace(jid, "@", ":0@", 1)
}

func matchJIDs(sock core.VoipSocket, j1, j2 types.JID) bool {
	ctx := context.Background()
	if j1.User == j2.User {
		return true
	}
	if j1.Server == types.HiddenUserServer {
		if pn := sock.ResolvePNForLID(ctx, j1); !pn.IsEmpty() && pn.User == j2.User {
			return true
		}
	} else if j1.Server == types.DefaultUserServer {
		if lid := sock.ResolveLIDForPN(ctx, j1); !lid.IsEmpty() && lid.User == j2.User {
			return true
		}
	}
	if j2.Server == types.HiddenUserServer {
		if pn := sock.ResolvePNForLID(ctx, j2); !pn.IsEmpty() && pn.User == j1.User {
			return true
		}
	} else if j2.Server == types.DefaultUserServer {
		if lid := sock.ResolveLIDForPN(ctx, j2); !lid.IsEmpty() && lid.User == j1.User {
			return true
		}
	}
	return false
}

func findOurDevice(sock core.VoipSocket, participants []string, ownJid string, fallback string) string {
	pjOwn, err := types.ParseJID(ownJid)
	if err != nil {
		return fallback
	}
	for _, jid := range participants {
		pj, err := types.ParseJID(jid)
		if err == nil {
			if matchJIDs(sock, pj, pjOwn) && strings.Contains(jid, ":") {
				return jid
			}
		}
	}
	return fallback
}

func firstPeerDevice(sock core.VoipSocket, participants []string, ownJid string) string {
	pjOwn, err := types.ParseJID(ownJid)
	if err != nil {
		return ""
	}
	for _, jid := range participants {
		pj, err := types.ParseJID(jid)
		if err == nil {
			if !matchJIDs(sock, pj, pjOwn) {
				return jid
			}
		}
	}
	return ""
}

func firstSsrc(s []uint32) uint32 {
	if len(s) > 0 {
		return s[0]
	}
	return 0
}

func relayEndpointCount(rd *core.RelayData) int {
	if rd == nil {
		return 0
	}
	return len(rd.Endpoints)
}

func containsSsrc(s []uint32, v uint32) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func matchDevices(sock core.VoipSocket, j1, j2 types.JID) bool {
	ctx := context.Background()
	r1 := j1
	if j1.Server == types.HiddenUserServer {
		if pn := sock.ResolvePNForLID(ctx, j1); !pn.IsEmpty() {
			r1 = pn
		}
	}
	r2 := j2
	if j2.Server == types.HiddenUserServer {
		if pn := sock.ResolvePNForLID(ctx, j2); !pn.IsEmpty() {
			r2 = pn
		}
	}
	return r1.User == r2.User && r1.Device == r2.Device
}
