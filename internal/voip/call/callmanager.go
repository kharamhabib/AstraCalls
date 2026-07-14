package call

import (
	"context"
	"log/slog"
	"sync"
	"time"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"
	"wacalls/internal/voip/signaling"
	"wacalls/internal/voip/transport"
	"wacalls/internal/voip/wanode"

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

	OnStateChange func(*CallInfo)
	OnIncoming    func(*CallInfo)
	OnEnded       func(*CallInfo)
	OnPeerAudio   func([]float32)

	recvMu        sync.Mutex
	lastRtpSeq    uint16
	rtpHistory    [64]uint16
	rtpHistoryIdx int
	hasRtpHistory bool
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

func (m *CallManager) emitState() {
	if m.OnStateChange != nil && m.currentCall != nil {
		m.OnStateChange(m.currentCall)
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
	creator := m.sock.OwnLID()
	if creator.IsEmpty() {
		creator = m.sock.OwnPN()
	}
	resolved := m.sock.ResolveLIDForPN(ctx, peerJid)

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
	m.emitState()
	m.mu.Unlock()

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
	m.emitState()
	key := call.EncryptionKey
	peer := wanode.MustJID(call.PeerJid)
	creator := wanode.MustJID(call.CallCreator)
	isVideo := call.MediaType == core.CallMediaTypeVideo
	relayData := call.RelayData
	m.mu.Unlock()

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

		// Frente 1: Notifica nossos próprios outros dispositivos para pararem de tocar
		ourBase := wanode.CleanJID(m.ownCredJid())
		ourDevice := ensureDeviceJid(findOurDevice(relayData.ParticipantJids, ourBase, m.ownCredJid()))
		m.log.Info("AcceptCall: notifying other devices", "ourDevice", ourDevice, "participants", relayData.ParticipantJids)
		go func() {
			for _, part := range relayData.ParticipantJids {
				if wanode.CleanJID(part) == ourBase {
					partDevice := ensureDeviceJid(part)
					if partDevice != ourDevice {
						m.log.Info("sending accepted_elsewhere terminate to own other device", "device", partDevice)
						termNode := signaling.BuildTerminateStanza(wanode.MustJID(partDevice), callID, creator, "accepted_elsewhere")
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
	m.emitState()
	m.mu.Unlock()

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
		ourBase := wanode.CleanJID(m.ownCredJid())
		for _, part := range call.RelayData.ParticipantJids {
			if wanode.CleanJID(part) != ourBase {
				nodes = append(nodes, signaling.BuildTerminateStanza(wanode.MustJID(part), call.CallID, wanode.MustJID(call.CallCreator), string(reason)))
			}
		}
	}

	ended := call
	m.emitState()
	m.mu.Unlock()

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

	if m.OnEnded != nil {
		m.OnEnded(ended)
	}
	m.cleanupMedia()
	return nil
}

func (m *CallManager) ownCredJid() string {
	lid := m.sock.OwnLID()
	if !lid.IsEmpty() {
		return lid.String()
	}
	return m.sock.OwnPN().String()
}

type CallError struct{ Msg string }

func (e *CallError) Error() string { return e.Msg }
