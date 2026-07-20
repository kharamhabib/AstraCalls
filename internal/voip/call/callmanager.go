package call

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
	"kallia/internal/voip/core"
	"kallia/internal/voip/media"
	"kallia/internal/voip/signaling"
	"kallia/internal/voip/transport"
	"kallia/internal/voip/wanode"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
)

type CallManager struct {
	sock core.VoipSocket
	log  *slog.Logger

	mu          sync.Mutex
	currentCall *CallInfo

	rtpSession  *media.RtpSession
	srtpSession *media.SrtpSession
	codec       media.Codec
	relay       RelayTransport

	fallbackCodec   media.Codec
	decodeFailCount int
	rtpRecvCount    uint64
	decodeOkCount   uint64

	selfSsrc          uint32
	peerSsrcs         []uint32
	allowedPeerSsrcs  []uint32
	actualPeerSet     bool

	firstPacketSent       bool
	initialTransportSent  bool
	outgoingPreacceptSent bool
	acceptedByJid         string
	debeEnabled           bool

	encodeBuf    []float32
	encodeBufPos int

	lastCaptureAt time.Time
	keepaliveStop chan struct{}

	// Callbacks protegidos por cbMu. Listeners de estado são uma lista (sem
	// wrapping): cada interessado (broker, agente IA) registra o seu com
	// AddStateListener, eliminando as corridas de "ler → embrulhar → reatribuir".
	cbMu                   sync.RWMutex
	stateListeners         []func(*CallInfo)
	onIncoming             func(*CallInfo)
	onEnded                func(*CallInfo)
	peerAudioListeners     []func([]float32)
	outgoingAudioListeners []func([]float32)

	recvMu        sync.Mutex
	lastRtpSeq    uint16
	rtpHistory    [64]uint16
	rtpHistoryIdx int
	hasRtpHistory bool
}

// AddStateListener registra um listener de mudança de estado. Seguro para
// chamadas concorrentes; os listeners são invocados fora de qualquer lock.
func (m *CallManager) AddStateListener(fn func(*CallInfo)) {
	if fn == nil {
		return
	}
	m.cbMu.Lock()
	m.stateListeners = append(m.stateListeners, fn)
	m.cbMu.Unlock()
}

// AddPeerAudioListener registra um listener para áudio vindo do cliente.
func (m *CallManager) AddPeerAudioListener(fn func([]float32)) {
	if fn == nil {
		return
	}
	m.cbMu.Lock()
	m.peerAudioListeners = append(m.peerAudioListeners, fn)
	m.cbMu.Unlock()
}

// AddOutgoingAudioListener registra um listener para áudio enviado ao cliente (IA/Operador).
func (m *CallManager) AddOutgoingAudioListener(fn func([]float32)) {
	if fn == nil {
		return
	}
	m.cbMu.Lock()
	m.outgoingAudioListeners = append(m.outgoingAudioListeners, fn)
	m.cbMu.Unlock()
}

// SetOnIncoming define o handler de chamada recebida (1 por chamada).
func (m *CallManager) SetOnIncoming(fn func(*CallInfo)) {
	m.cbMu.Lock()
	m.onIncoming = fn
	m.cbMu.Unlock()
}

// SetOnEnded define o handler de encerramento (1 por chamada).
func (m *CallManager) SetOnEnded(fn func(*CallInfo)) {
	m.cbMu.Lock()
	m.onEnded = fn
	m.cbMu.Unlock()
}

// SetOnPeerAudio registra um handler de áudio do peer.
func (m *CallManager) SetOnPeerAudio(fn func([]float32)) {
	m.AddPeerAudioListener(fn)
}

func (m *CallManager) incomingHandler() func(*CallInfo) {
	m.cbMu.RLock()
	defer m.cbMu.RUnlock()
	return m.onIncoming
}

func (m *CallManager) endedHandler() func(*CallInfo) {
	m.cbMu.RLock()
	defer m.cbMu.RUnlock()
	return m.onEnded
}

func (m *CallManager) peerAudioHandler() func([]float32) {
	m.cbMu.RLock()
	listeners := make([]func([]float32), len(m.peerAudioListeners))
	copy(listeners, m.peerAudioListeners)
	m.cbMu.RUnlock()
	if len(listeners) == 0 {
		return nil
	}
	return func(pcm []float32) {
		for _, fn := range listeners {
			if fn != nil {
				fn(pcm)
			}
		}
	}
}

func (m *CallManager) outgoingAudioHandler() func([]float32) {
	m.cbMu.RLock()
	listeners := make([]func([]float32), len(m.outgoingAudioListeners))
	copy(listeners, m.outgoingAudioListeners)
	m.cbMu.RUnlock()
	if len(listeners) == 0 {
		return nil
	}
	return func(pcm []float32) {
		for _, fn := range listeners {
			if fn != nil {
				fn(pcm)
			}
		}
	}
}

func (m *CallManager) isDuplicateRtp(seq uint16) bool {
	if !m.hasRtpHistory {
		m.hasRtpHistory = true
		m.rtpHistory[0] = seq
		m.rtpHistoryIdx = 1
		m.lastRtpSeq = seq
		return false
	}
	for i := 0; i < len(m.rtpHistory); i++ {
		if m.rtpHistory[i] == seq {
			return true
		}
	}
	m.rtpHistory[m.rtpHistoryIdx] = seq
	m.rtpHistoryIdx = (m.rtpHistoryIdx + 1) % len(m.rtpHistory)
	m.lastRtpSeq = seq
	return false
}

func NewCallManager(sock core.VoipSocket, log *slog.Logger) *CallManager {
	if log == nil {
		log = slog.Default()
	}
	m := &CallManager{
		sock:        sock,
		log:         log,
		debeEnabled: true,
	}
	relay := transport.NewSctpRelayManager(log)
	relay.SetOnConnected(func(ip string, port int) { m.onRelayConnected() })
	relay.SetOnReceive(func(data []byte) { m.onRelayData(data) })
	m.relay = relay
	return m
}

func (m *CallManager) CurrentCall() *CallInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.currentCall
}

// emitState notifica os listeners de estado. Adquire os locks internamente e
// invoca os handlers SEM segurar m.mu nem cbMu — listeners podem chamar
// métodos do próprio CallManager sem risco de deadlock. Nunca chamar com
// m.mu segurado.
func (m *CallManager) emitState() {
	m.mu.Lock()
	info := m.currentCall
	m.mu.Unlock()
	if info == nil {
		return
	}
	m.cbMu.RLock()
	listeners := make([]func(*CallInfo), len(m.stateListeners))
	copy(listeners, m.stateListeners)
	m.cbMu.RUnlock()
	for _, fn := range listeners {
		fn(info)
	}
}

func (m *CallManager) StartCall(ctx context.Context, callID string, peerJid types.JID, isVideo bool) error {
	m.mu.Lock()
	if m.currentCall != nil && !m.currentCall.IsEnded() {
		m.mu.Unlock()
		return &CallError{"a call is already in progress"}
	}

	mediaType := core.CallMediaTypeAudio
	if isVideo {
		mediaType = core.CallMediaTypeVideo
	}
	resolved := m.sock.ResolveLIDForPN(ctx, peerJid)
	creator := m.sock.OwnLID()
	if resolved.Server == types.DefaultUserServer || creator.IsEmpty() {
		creator = m.sock.OwnPN()
	}

	call := NewOutgoingCall(callID, resolved.String(), creator.String(), mediaType)
	callKey := media.GenerateCallKey()
	call.EncryptionKey = callKey
	m.currentCall = call
	m.initialTransportSent = false
	m.outgoingPreacceptSent = false

	selfJid := creator.String()
	m.selfSsrc = media.GenerateSecureSsrc(callID, selfJid, 0)
	m.rtpSession = media.NewWhatsAppOpusSession(m.selfSsrc)
	m.peerSsrcs = []uint32{}
	m.allowedPeerSsrcs = []uint32{media.GenerateSecureSsrc(callID, resolved.String(), 0)}
	m.actualPeerSet = false
	m.initCodec()
	m.mu.Unlock()

	offer, err := signaling.BuildOfferStanza(ctx, m.sock, callID, callKey, resolved, isVideo)
	if err != nil {
		return err
	}

	m.mu.Lock()
	_ = m.currentCall.ApplyTransition(Transition{Type: TransitionOfferSent})
	m.mu.Unlock()
	m.emitState()

	// Envia o offer e trata o ack em background: o aparelho toca quando recebe o
	// offer, não quando o Query retorna. Antes travava até 15s no timeout do Query.
	go func() {
		ackNode, qerr := m.sock.Query(context.Background(), offer)
		if qerr != nil {
			m.log.Error("offer query error", "err", qerr)
			return
		}
		if ackNode != nil {
			m.log.Info("offer ack", "xml", ackNode.String())
			m.HandleCallAck(context.Background(), ackNode)
		}
	}()

	m.log.Info("call offer sent", "call_id", callID, "peer", resolved.String())
	return nil
}

func (m *CallManager) AcceptCall(ctx context.Context, callID string) error {
	m.mu.Lock()
	call := m.currentCall
	if call == nil || call.CallID != callID {
		m.mu.Unlock()
		return &CallError{"no incoming call with id " + callID}
	}
	if !call.CanAccept() {
		m.mu.Unlock()
		return &CallError{"call cannot be accepted in state " + string(call.StateData.State)}
	}
	_ = call.ApplyTransition(Transition{Type: TransitionLocalAccepted})
	key := call.EncryptionKey
	peer := wanode.MustJID(call.PeerJid)
	creator := wanode.MustJID(call.CallCreator)
	isVideo := call.MediaType == core.CallMediaTypeVideo
	relayData := call.RelayData
	m.mu.Unlock()
	m.emitState()

	if key != nil {
		acceptNode, err := signaling.BuildAcceptStanza(ctx, m.sock, callID, key, peer, creator, isVideo)
		if err != nil {
			m.log.Error("build accept failed", "err", err)
		} else {
			// envia o accept em background: não bloquear a UI até 15s no timeout do ack
			go func() {
				if _, err := m.sock.Query(context.Background(), acceptNode); err != nil {
					m.log.Error("accept query error", "err", err)
				}
			}()
		}
	}

	if relayData != nil {
		m.connectRelays(relayData.Endpoints)

		ourDevice := ensureDeviceJid(findOurDevice(m.sock, relayData.ParticipantJids, m.ownCredJid(), m.ownCredJid()))
		m.log.Info("AcceptCall: notifying other devices", "ourDevice", ourDevice, "participants", relayData.ParticipantJids)
		go func() {
			ctx := context.Background()
			var ownDevices []types.JID
			if ownLid := m.sock.OwnLID(); !ownLid.IsEmpty() {
				if devs, err := m.sock.GetUSyncDevices(ctx, []types.JID{ownLid}); err == nil {
					ownDevices = append(ownDevices, devs...)
				}
			}
			if ownPn := m.sock.OwnPN(); !ownPn.IsEmpty() {
				if devs, err := m.sock.GetUSyncDevices(ctx, []types.JID{ownPn}); err == nil {
					for _, d := range devs {
						dup := false
						for _, od := range ownDevices {
							if od.User == d.User && od.Device == d.Device {
								dup = true
								break
							}
						}
						if !dup {
							ownDevices = append(ownDevices, d)
						}
					}
				}
			}

			pjOwn, _ := types.ParseJID(m.ownCredJid())
			ourDeviceJid, _ := types.ParseJID(ourDevice)
			for _, dev := range ownDevices {
				if matchJIDs(m.sock, dev, pjOwn) {
					if !matchDevices(m.sock, dev, ourDeviceJid) {
						partDevice := dev.String()
						m.log.Info("sending accepted_elsewhere terminate to own other device", "device", partDevice)
						termNode := signaling.BuildTerminateStanza(dev, callID, creator, "accepted_elsewhere")
						if err := m.sock.SendNode(context.Background(), termNode); err != nil {
							m.log.Error("failed to send accepted_elsewhere to own device", "device", partDevice, "err", err)
						}
					}
				}
			}
		}()
	}
	m.log.Info("call accepted", "call_id", callID)
	return nil
}

func (m *CallManager) RejectCall(ctx context.Context, callID string, reason core.EndCallReason) error {
	m.mu.Lock()
	call := m.currentCall
	if call == nil || call.CallID != callID {
		m.mu.Unlock()
		return &CallError{"no call with id " + callID}
	}
	_ = call.ApplyTransition(Transition{Type: TransitionLocalRejected, Reason: reason})
	node := signaling.BuildRejectStanza(wanode.MustJID(call.PeerJid), call.CallID, wanode.MustJID(call.CallCreator))
	m.mu.Unlock()
	m.emitState()

	go func() { _, _ = m.sock.Query(context.Background(), node) }()
	m.cleanupMedia()
	return nil
}

func (m *CallManager) EndCall(ctx context.Context, reason core.EndCallReason) error {
	m.mu.Lock()
	call := m.currentCall
	if call == nil || call.IsEnded() {
		m.mu.Unlock()
		return nil
	}
	_ = call.ApplyTransition(Transition{Type: TransitionTerminated, Reason: reason})

	var nodes []waBinary.Node
	nodes = append(nodes, signaling.BuildTerminateStanza(wanode.MustJID(call.PeerJid), call.CallID, wanode.MustJID(call.CallCreator), string(reason)))

	if call.RelayData != nil && len(call.RelayData.ParticipantJids) > 0 {
		pjOwn, _ := types.ParseJID(m.ownCredJid())
		for _, part := range call.RelayData.ParticipantJids {
			pjPart, _ := types.ParseJID(part)
			if !matchJIDs(m.sock, pjPart, pjOwn) {
				nodes = append(nodes, signaling.BuildTerminateStanza(wanode.MustJID(part), call.CallID, wanode.MustJID(call.CallCreator), string(reason)))
			}
		}
	}

	ended := call
	m.mu.Unlock()
	m.emitState()

	go func() {
		for _, node := range nodes {
			go func(n waBinary.Node) {
				toAttr, _ := n.Attrs["to"].(types.JID)
				res, err := m.sock.Query(context.Background(), n)
				if err != nil {
					m.log.Error("Failed to send terminate stanza", "to", toAttr.String(), "err", err)
				} else if res != nil {
					m.log.Debug("Terminate stanza ack received", "to", toAttr.String(), "xml", res.String())
				}
			}(node)
		}
	}()

	if fn := m.endedHandler(); fn != nil {
		fn(ended)
	}
	m.cleanupMedia()
	return nil
}

func (m *CallManager) ownCredJid() string {
	var usePn bool
	if m.currentCall != nil {
		usePn = strings.Contains(m.currentCall.PeerJid, "@s.whatsapp.net")
	}
	if !usePn {
		lid := m.sock.OwnLID()
		if !lid.IsEmpty() {
			return lid.String()
		}
	}
	return m.sock.OwnPN().String()
}

type CallError struct{ Msg string }

func (e *CallError) Error() string { return e.Msg }
