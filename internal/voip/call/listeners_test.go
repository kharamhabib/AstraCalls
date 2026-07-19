package call

import (
	"context"
	"sync"
	"testing"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"

	"wacalls/internal/voip/core"
)

// fakeSocket implementa core.VoipSocket para testes dos listeners.
type fakeSocket struct{}

func (fakeSocket) OwnPN() types.JID  { return types.NewJID("5511999999999", types.DefaultUserServer) }
func (fakeSocket) OwnLID() types.JID { return types.NewJID("123456789", types.HiddenUserServer) }
func (fakeSocket) AccountDeviceIdentityNode() (waBinary.Node, bool) {
	return waBinary.Node{}, false
}
func (fakeSocket) SendNode(ctx context.Context, node waBinary.Node) error { return nil }
func (fakeSocket) Query(ctx context.Context, node waBinary.Node) (*waBinary.Node, error) {
	return nil, nil
}
func (fakeSocket) GetUSyncDevices(ctx context.Context, jids []types.JID) ([]types.JID, error) {
	return nil, nil
}
func (fakeSocket) AssertSessions(ctx context.Context, jids []types.JID, force bool) error {
	return nil
}
func (fakeSocket) CreateParticipantNodes(ctx context.Context, devices []types.JID, callKey []byte, encAttrs waBinary.Attrs) ([]waBinary.Node, bool, error) {
	return nil, false, nil
}
func (fakeSocket) DecryptCallKey(ctx context.Context, from types.JID, encChild *waBinary.Node) ([]byte, error) {
	return nil, nil
}
func (fakeSocket) GetTCToken(ctx context.Context, jid types.JID) ([]byte, error) {
	return nil, nil
}
func (fakeSocket) ResolveLIDForPN(ctx context.Context, pn types.JID) types.JID { return pn }
func (fakeSocket) ResolvePNForLID(ctx context.Context, lid types.JID) types.JID { return lid }

// TestStateListenersConcurrent registra listeners e emite estados
// concorrentemente — deve rodar limpo com -race e invocar todos os listeners.
func TestStateListenersConcurrent(t *testing.T) {
	m := NewCallManager(fakeSocket{}, nil)

	var wg sync.WaitGroup
	var mu sync.Mutex
	counts := map[int]int{}

	const listeners = 8
	for i := 0; i < listeners; i++ {
		idx := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.AddStateListener(func(*CallInfo) {
				mu.Lock()
				counts[idx]++
				mu.Unlock()
			})
		}()
	}
	wg.Wait()

	// Simula uma chamada corrente e emite estados de várias goroutines.
	m.mu.Lock()
	m.currentCall = NewOutgoingCall("CID", "peer@lid", "me@lid", core.CallMediaTypeAudio)
	m.mu.Unlock()

	const emissions = 50
	for i := 0; i < emissions; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.emitState()
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	for i := 0; i < listeners; i++ {
		if counts[i] != emissions {
			t.Fatalf("listener %d recebeu %d emissões, esperado %d", i, counts[i], emissions)
		}
	}
}

// TestCallbackSettersConcurrent valida os setters/getters sob concorrência (-race).
func TestCallbackSettersConcurrent(t *testing.T) {
	m := NewCallManager(fakeSocket{}, nil)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.SetOnPeerAudio(func([]float32) {})
			m.SetOnIncoming(func(*CallInfo) {})
			m.SetOnEnded(func(*CallInfo) {})
			_ = m.peerAudioHandler()
			_ = m.incomingHandler()
			_ = m.endedHandler()
		}()
	}
	wg.Wait()
}

// TestEmitStateWithoutCall não deve panicar sem chamada corrente.
func TestEmitStateWithoutCall(t *testing.T) {
	m := NewCallManager(fakeSocket{}, nil)
	called := false
	m.AddStateListener(func(*CallInfo) { called = true })
	m.emitState()
	if called {
		t.Fatal("listener não deveria ser chamado sem chamada corrente")
	}
}
