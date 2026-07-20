package call

import (
	"kallia/internal/voip/core"
	"kallia/internal/voip/media"

	"go.mau.fi/whatsmeow/types"
)

func (m *CallManager) initSrtpKeysLocked() {
	call := m.currentCall
	if call == nil || call.EncryptionKey == nil {
		return
	}
	var participants []string
	if call.RelayData != nil {
		participants = call.RelayData.ParticipantJids
	}
	ourDeviceJid := ensureDeviceJid(findOurDevice(m.sock, participants, m.ownCredJid(), m.ownCredJid()))

	rawPeer := m.acceptedByJid
	if rawPeer == "" {
		rawPeer = call.PeerJid
		if p := firstPeerDevice(m.sock, participants, m.ownCredJid()); p != "" {
			rawPeer = p
		}
	}
	peerDeviceJid := ensureDeviceJid(rawPeer)

	sendKM, err1 := media.DerivePerJidSrtpKey(call.EncryptionKey, ourDeviceJid)
	recvKM, err2 := media.DerivePerJidSrtpKey(call.EncryptionKey, peerDeviceJid)
	if err1 != nil || err2 != nil {
		m.log.Error("srtp key derivation failed", "err1", err1, "err2", err2)
		return
	}
	sess, err := media.NewSrtpSession(sendKM, recvKM, core.SRTPSendAuthTagLen, core.SRTPRecvAuthTagLen)
	if err != nil {
		m.log.Error("srtp session failed", "err", err)
		return
	}
	m.srtpSession = sess
	m.log.Debug("srtp per-jid keys set", "send", ourDeviceJid, "recv", peerDeviceJid)
}

func (m *CallManager) reinitSrtpLocked(peerKey []byte, peerJid types.JID) {
	call := m.currentCall
	if call == nil || call.EncryptionKey == nil {
		return
	}
	var participants []string
	if call.RelayData != nil {
		participants = call.RelayData.ParticipantJids
	}
	ourDeviceJid := ensureDeviceJid(findOurDevice(m.sock, participants, m.ownCredJid(), m.ownCredJid()))
	sendKM, err1 := media.DerivePerJidSrtpKey(call.EncryptionKey, ourDeviceJid)
	recvKM, err2 := media.DerivePerJidSrtpKey(peerKey, peerJid.String())
	if err1 != nil || err2 != nil {
		return
	}
	if sess, err := media.NewSrtpSession(sendKM, recvKM, core.SRTPSendAuthTagLen, core.SRTPRecvAuthTagLen); err == nil {
		m.srtpSession = sess
		m.log.Debug("srtp re-initialized with peer call key")
	}
}

func (m *CallManager) findParticipantBySsrcLocked(ssrc uint32) string {
	call := m.currentCall
	if call == nil || call.RelayData == nil {
		return ""
	}
	for _, part := range call.RelayData.ParticipantJids {
		deviceJid := ensureDeviceJid(part)
		if media.GenerateSecureSsrc(call.CallID, deviceJid, 0) == ssrc {
			return deviceJid
		}
	}
	return ""
}

func (m *CallManager) updateSrtpRecvKeyLocked(peerDeviceJid string) {
	call := m.currentCall
	if call == nil || call.EncryptionKey == nil || m.srtpSession == nil {
		return
	}
	recvKM, err := media.DerivePerJidSrtpKey(call.EncryptionKey, peerDeviceJid)
	if err != nil {
		m.log.Error("failed to derive srtp key for peer device", "device", peerDeviceJid, "err", err)
		return
	}
	err = m.srtpSession.SetRecvKeying(recvKM)
	if err != nil {
		m.log.Error("failed to set srtp recv keying", "device", peerDeviceJid, "err", err)
	} else {
		m.log.Debug("srtp recv key updated for device", "device", peerDeviceJid)
	}
}
