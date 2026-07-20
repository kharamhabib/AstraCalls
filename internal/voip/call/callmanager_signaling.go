package call

import (
	"context"
	"kallia/internal/voip/core"
	"kallia/internal/voip/media"
	"kallia/internal/voip/signaling"
	"kallia/internal/voip/wanode"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/types"
)

func (m *CallManager) HandleCallOffer(ctx context.Context, node *waBinary.Node, peerJid types.JID) {
	info := signaling.ExtractNodeInfo(node)
	if info == nil {
		return
	}
	callID := info.CallID
	creator := wanode.AttrString(info.InnerNode.Attrs, "call-creator")
	if creator == "" {
		creator = peerJid.String()
	}
	isVideo := hasChildTag(info.InnerNode, "video")

	callKey, err := signaling.DecryptCallKeyInNode(ctx, m.sock, info.InnerNode, peerJid)
	if err != nil {
		m.log.Error("offer decrypt call key", "err", err)
	}
	// O offer de ENTRADA traz o <relay> no formato te2 (igual ao ack da saída).
	// ExtractRelayEndpoints é do formato antigo (ip/token) e dava 0 relays = sem
	// áudio. ParseRelayFromAck lê o te2 corretamente.
	parsed := signaling.ParseRelayFromAck(info.InnerNode)

	mediaType := core.CallMediaTypeAudio
	if isVideo {
		mediaType = core.CallMediaTypeVideo
	}

	// Extrai os participantes do offer (o próprio criador e os destinatários)
	var participantJids []string
	if creator != "" {
		participantJids = append(participantJids, creator)
	}
	for _, c := range wanode.NodeChildren(info.InnerNode) {
		if c.Tag == "destination" {
			for _, toNode := range wanode.NodeChildren(&c) {
				if toNode.Tag == "to" {
					if toJidStr := wanode.AttrString(toNode.Attrs, "jid"); toJidStr != "" {
						dup := false
						for _, p := range participantJids {
							if p == toJidStr {
								dup = true
								break
							}
						}
						if !dup {
							participantJids = append(participantJids, toJidStr)
						}
					}
				}
			}
		}
	}

	m.mu.Lock()
	call := NewIncomingCall(callID, peerJid.String(), creator, "", mediaType)
	if callKey != nil {
		call.EncryptionKey = callKey
	}
	// Inicializa RelayData com os ParticipantJids extraídos do offer
	call.RelayData = &core.RelayData{
		ParticipantJids: participantJids,
	}
	if len(parsed.Relays) > 0 {
		call.RelayData.Endpoints = parsed.Relays
		call.RelayData.UUID = parsed.UUID
		call.RelayData.SelfPid = parsed.SelfPid
		call.RelayData.PeerPid = parsed.PeerPid
		call.RelayData.HbhKey = parsed.HbhKey
	}
	m.currentCall = call
	m.initialTransportSent = false

	selfJid := m.sock.OwnLID()
	if peerJid.Server == types.DefaultUserServer || selfJid.IsEmpty() {
		selfJid = m.sock.OwnPN()
	}
	sj := selfJid.String()
	m.selfSsrc = media.GenerateSecureSsrc(callID, sj, 0)
	m.rtpSession = media.NewWhatsAppOpusSession(m.selfSsrc)
	m.peerSsrcs = []uint32{}
	m.allowedPeerSsrcs = []uint32{
		media.GenerateSecureSsrc(callID, peerJid.String(), 0),
		media.GenerateSecureSsrc(callID, ensureDeviceJid(peerJid.String()), 0),
	}
	m.actualPeerSet = false
	// SSRC/SRTP a partir dos participantes do relay (igual à saída em HandleCallAck)
	if len(parsed.ParticipantJids) > 0 {
		ourDeviceJid := ensureDeviceJid(findOurDevice(m.sock, parsed.ParticipantJids, m.ownCredJid(), m.ownCredJid()))
		m.selfSsrc = media.GenerateSecureSsrc(callID, ourDeviceJid, 0)
		m.rtpSession = media.NewWhatsAppOpusSession(m.selfSsrc)
		m.allowedPeerSsrcs = []uint32{}
		pjOwn, _ := types.ParseJID(m.ownCredJid())
		for _, part := range parsed.ParticipantJids {
			pjPart, _ := types.ParseJID(part)
			if !matchJIDs(m.sock, pjPart, pjOwn) {
				m.allowedPeerSsrcs = append(m.allowedPeerSsrcs, media.GenerateSecureSsrc(callID, ensureDeviceJid(part), 0))
			}
		}
	}
	m.initCodec()
	if callKey != nil && len(parsed.Relays) > 0 {
		m.initSrtpKeysLocked()
	}
	m.mu.Unlock()

	preaccept := signaling.BuildPreacceptStanza(peerJid, callID, wanode.MustJID(creator))
	if err := m.sock.SendNode(ctx, preaccept); err != nil {
		m.log.Error("send preaccept", "err", err)
	}

	if fn := m.incomingHandler(); fn != nil {
		fn(call)
	}
	m.emitState()
	m.log.Info("incoming call", "call_id", callID, "peer", peerJid.String(), "video", isVideo, "relays", len(parsed.Relays))
}

func (m *CallManager) HandleCallAccept(ctx context.Context, node *waBinary.Node, peerJid types.JID) {
	m.mu.Lock()
	call := m.currentCall
	m.mu.Unlock()
	if call == nil {
		return
	}
	info := signaling.ExtractNodeInfo(node)
	if info == nil {
		return
	}

	var peerKey []byte
	if signaling.NeedsDecryption(info.Tag) {
		var err error
		peerKey, err = signaling.DecryptCallKeyInNode(ctx, m.sock, info.InnerNode, peerJid)
		if err != nil {
			m.log.Error("accept decrypt call key failed", "err", err)
		}
	}

	m.mu.Lock()
	_ = call.ApplyTransition(Transition{Type: TransitionRemoteAccepted})
	m.acceptedByJid = peerJid.String()

	var reinitialized bool
	if peerKey != nil && call.EncryptionKey != nil && !equalBytes(call.EncryptionKey, peerKey) {
		m.reinitSrtpLocked(peerKey, peerJid)
		reinitialized = true
	}

	peerJidStr := peerJid.String()
	peerDeviceJid := ensureDeviceJid(peerJidStr)
	activeSsrc := media.GenerateSecureSsrc(call.CallID, peerDeviceJid, 0)
	m.peerSsrcs = []uint32{activeSsrc}
	m.allowedPeerSsrcs = []uint32{activeSsrc}
	m.actualPeerSet = true
	m.relay.SetSubscriptionSsrc(firstSsrc(m.peerSsrcs))
	if !reinitialized {
		m.initSrtpKeysLocked()
	}
	if m.codec != nil {
		_ = m.codec.ResetDecoder()
	}
	hasConn := m.relay.HasConnection()
	relayData := call.RelayData
	m.mu.Unlock()
	m.emitState()

	m.log.Info("remote accepted call", "call_id", call.CallID, "peer", peerJid.String(),
		"relay_connected", hasConn, "relay_endpoints", relayEndpointCount(relayData))

	m.relay.ResendSubscriptions()

	callID := call.CallID
	creator := wanode.MustJID(call.CallCreator)
	transport := waBinary.Node{
		Tag:   "call",
		Attrs: waBinary.Attrs{"to": peerJid, "id": signaling.GenerateCallStanzaID()},
		Content: []waBinary.Node{{
			Tag: "transport",
			Attrs: waBinary.Attrs{
				"call-id": callID, "call-creator": creator,
				"transport-message-type": "1", "p2p-cand-round": "1",
			},
			Content: []waBinary.Node{{Tag: "net", Attrs: waBinary.Attrs{"medium": "2", "protocol": "0"}}},
		}},
	}
	_ = m.sock.SendNode(ctx, transport)
	_ = m.sock.SendNode(ctx, signaling.BuildMuteV2Stanza(peerJid, callID, creator, 0))
	if acceptMsgID := wanode.AttrString(node.Attrs, "id"); acceptMsgID != "" {
		ourJid := m.sock.OwnLID()
		if peerJid.Server == types.DefaultUserServer || ourJid.IsEmpty() {
			ourJid = m.sock.OwnPN()
		}
		_ = m.sock.SendNode(ctx, signaling.BuildAcceptReceiptStanza(peerJid, acceptMsgID, callID, creator, ourJid))
	}

	if relayData != nil {
		m.log.Info("HandleCallAccept: notifying other devices", "participants", relayData.ParticipantJids)
		pjPeer, _ := types.ParseJID(call.PeerJid)
		acceptDevice := ensureDeviceJid(peerJid.String())
		pjAcceptDevice, _ := types.ParseJID(acceptDevice)
		for _, part := range relayData.ParticipantJids {
			pjPart, _ := types.ParseJID(part)
			if matchJIDs(m.sock, pjPart, pjPeer) {
				partDevice := ensureDeviceJid(part)
				pjPartDevice, _ := types.ParseJID(partDevice)
				if !matchDevices(m.sock, pjPartDevice, pjAcceptDevice) {
					m.log.Info("sending accepted_elsewhere terminate to other device", "device", partDevice)
					termNode := signaling.BuildTerminateStanza(wanode.MustJID(partDevice), call.CallID, creator, "accepted_elsewhere")
					go func(td string, tn waBinary.Node) {
						if err := m.sock.SendNode(context.Background(), tn); err != nil {
							m.log.Error("failed to send accepted_elsewhere terminate", "device", td, "err", err)
						}
					}(partDevice, termNode)
				}
			}
		}
	}


	if hasConn {
		m.mu.Lock()
		activated := false
		hasCodec := m.codec != nil
		if call.StateData.State == core.CallStateRinging {
			_ = call.ApplyTransition(Transition{Type: TransitionRemoteAccepted})
		}
		if err := call.ApplyTransition(Transition{Type: TransitionMediaConnected}); err == nil {
			m.startSilenceKeepaliveLocked()
			activated = true
		}
		m.mu.Unlock()
		if activated {
			m.emitState()
			m.log.Info("call ACTIVE (media path established)", "call_id", call.CallID, "audio", hasCodec)
		}
	} else if relayData != nil {
		m.mu.Lock()
		accepted := false
		if err := call.ApplyTransition(Transition{Type: TransitionRemoteAccepted}); err == nil {
			accepted = true
		}
		m.mu.Unlock()
		if accepted {
			m.emitState()
			m.log.Info("call accepted by peer", "call_id", call.CallID)
		}
		m.connectRelays(relayData.Endpoints)
	}
}

func (m *CallManager) HandleCallTransport(ctx context.Context, node *waBinary.Node, peerJid types.JID) {
	m.mu.Lock()
	call := m.currentCall
	m.mu.Unlock()
	if call == nil {
		return
	}
	info := signaling.ExtractNodeInfo(node)
	if info == nil {
		return
	}
	relays := signaling.ExtractRelayEndpoints(info.InnerNode)
	if len(relays) > 0 && !m.relay.HasConnection() {
		m.mu.Lock()
		if call.RelayData == nil {
			call.RelayData = &core.RelayData{}
		}
		call.RelayData.Endpoints = relays
		m.mu.Unlock()
		m.connectRelays(relays)
	}
}

func (m *CallManager) HandleCallAck(ctx context.Context, node *waBinary.Node) {
	if t := wanode.AttrString(node.Attrs, "type"); t != "offer" {
		return
	}
	if e := wanode.AttrString(node.Attrs, "error"); e != "" {
		m.log.Error("offer ack error", "error", e)
		return
	}
	parsed := signaling.ParseRelayFromAck(node)
	m.log.Info("offer ack received", "relays", len(parsed.Relays), "participants", len(parsed.ParticipantJids))
	if len(parsed.Relays) == 0 {
		return
	}

	m.mu.Lock()
	call := m.currentCall
	if call == nil {
		m.mu.Unlock()
		return
	}
	call.RelayData = &core.RelayData{
		Endpoints:       parsed.Relays,
		ParticipantJids: parsed.ParticipantJids,
		UUID:            parsed.UUID,
		SelfPid:         parsed.SelfPid,
		PeerPid:         parsed.PeerPid,
		HbhKey:          parsed.HbhKey,
	}

	if len(parsed.ParticipantJids) > 0 {
		ourDeviceJid := ensureDeviceJid(findOurDevice(m.sock, parsed.ParticipantJids, m.ownCredJid(), m.ownCredJid()))
		newSelf := media.GenerateSecureSsrc(call.CallID, ourDeviceJid, 0)
		if newSelf != m.selfSsrc {
			m.selfSsrc = newSelf
			m.rtpSession = media.NewWhatsAppOpusSession(newSelf)
		}
		m.peerSsrcs = []uint32{}
		m.allowedPeerSsrcs = []uint32{}
		pjOwn, _ := types.ParseJID(m.ownCredJid())
		for _, part := range parsed.ParticipantJids {
			pjPart, _ := types.ParseJID(part)
			if !matchJIDs(m.sock, pjPart, pjOwn) {
				m.allowedPeerSsrcs = append(m.allowedPeerSsrcs, media.GenerateSecureSsrc(call.CallID, ensureDeviceJid(part), 0))
			}
		}
		m.actualPeerSet = false
		call.CallCreator = ourDeviceJid
		if call.EncryptionKey != nil {
			m.initSrtpKeysLocked()
		}
	}
	isInitiator := call.IsInitiator()
	peer := wanode.MustJID(call.PeerJid)
	callID := call.CallID
	creator := wanode.MustJID(call.CallCreator)
	sendPreaccept := isInitiator && !m.outgoingPreacceptSent
	if sendPreaccept {
		m.outgoingPreacceptSent = true
	}
	endpoints := parsed.Relays
	m.mu.Unlock()

	if sendPreaccept {
		_ = m.sock.SendNode(ctx, signaling.BuildPreacceptStanza(peer, callID, creator))
	}
	m.connectRelays(endpoints)
}

func (m *CallManager) HandleCallTerminate(node *waBinary.Node) {
	m.mu.Lock()
	call := m.currentCall
	if call == nil {
		m.mu.Unlock()
		return
	}
	info := signaling.ExtractNodeInfo(node)
	reason := core.EndCallReasonUserEnded
	if info != nil {
		if r := wanode.AttrString(info.InnerNode.Attrs, "reason"); r != "" {
			reason = core.EndCallReason(r)
		}
	}
	m.log.Info("call terminated by peer", "call_id", call.CallID, "reason", string(reason))
	_ = call.ApplyTransition(Transition{Type: TransitionTerminated, Reason: reason})
	ended := call
	m.mu.Unlock()
	m.emitState()

	if fn := m.endedHandler(); fn != nil {
		fn(ended)
	}
	m.cleanupMedia()
}
