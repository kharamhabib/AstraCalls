package call

import (
	"context"
	"encoding/binary"
	"time"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"
	"wacalls/internal/voip/transport"
)

func (m *CallManager) initCodec() {
	if m.codec == nil {
		codec, err := media.NewMLowCodec(media.DefaultCodecOptions)
		if err != nil {
			m.log.Warn("MLow codec unavailable — call will run signaling-only (no audio)", "err", err)
			return
		}
		m.codec = codec
	}

	// Cria automaticamente um codec genérico para DECODIFICAÇÃO de frames do peer.
	// O opusGeneric usa a mesma opus_decode mas SEM o flag ctlSetUsingSmpl=1,
	// evitando o resampler SILK customizado que causa abort() fatal quando o peer
	// é outro servidor AstraCalls. Frames de celulares também são decodificados
	// corretamente pelo Opus padrão. O MLow fica apenas para ENCODING (envio).
	if m.peerCodec == nil {
		if pc, pcErr := media.NewOpusCodec(16000, 960); pcErr == nil {
			m.peerCodec = pc
		} else {
			m.log.Warn("opusGeneric fallback unavailable — using MLow for decode (server↔server may crash)", "err", pcErr)
		}
	}
}

func (m *CallManager) FeedCapturedPCM(data []float32) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.codec == nil || m.rtpSession == nil || m.srtpSession == nil || !m.relay.HasConnection() {
		return
	}
	m.lastCaptureAt = time.Now()
	frameSize := m.codec.FrameSize()
	if m.encodeBuf == nil {
		m.encodeBuf = make([]float32, frameSize)
		m.encodeBufPos = 0
	}

	offset := 0
	for offset < len(data) {
		toCopy := min(len(data)-offset, frameSize-m.encodeBufPos)
		copy(m.encodeBuf[m.encodeBufPos:], data[offset:offset+toCopy])
		m.encodeBufPos += toCopy
		offset += toCopy
		if m.encodeBufPos < frameSize {
			break
		}
		frame := make([]float32, frameSize)
		copy(frame, m.encodeBuf)
		m.encodeBufPos = 0

		opus, err := m.codec.Encode(frame)
		if err != nil {
			m.log.Debug("encode error", "err", err)
			continue
		}
		m.sendOpusFrameLocked(opus)
	}
}

func (m *CallManager) sendOpusFrameLocked(opus []byte) {
	if m.rtpSession == nil || m.srtpSession == nil {
		return
	}
	marker := !m.firstPacketSent
	pkt := m.rtpSession.CreatePacketWithDuration(opus, m.codec.FrameSize(), marker)
	if m.debeEnabled {
		pkt.Header.Extension = true
		pkt.Header.ExtensionProfile = 0xbede
		pkt.Header.ExtensionData = nil
	}
	m.firstPacketSent = true

	srtp, err := m.srtpSession.Protect(pkt)
	if err != nil {
		m.log.Debug("srtp protect error", "err", err)
		return
	}
	m.relay.Broadcast(srtp)
}

func (m *CallManager) startSilenceKeepaliveLocked() {
	if m.keepaliveStop != nil || m.codec == nil {
		return
	}
	stop := make(chan struct{})
	m.keepaliveStop = stop
	frameSize := m.codec.FrameSize()
	go func() {
		ticker := time.NewTicker(60 * time.Millisecond)
		defer ticker.Stop()
		silence := make([]float32, frameSize)
		lastConnectionTime := time.Now()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				m.mu.Lock()
				hasConn := m.relay.HasConnection()
				if hasConn {
					lastConnectionTime = time.Now()
				} else if time.Since(lastConnectionTime) > 12*time.Second {
					m.log.Warn("relay connection lost for more than 12s, terminating call")
					m.mu.Unlock()
					_ = m.EndCall(context.Background(), core.EndCallReasonTimeout)
					return
				}
				ready := m.codec != nil && m.rtpSession != nil && m.srtpSession != nil && hasConn
				idle := time.Since(m.lastCaptureAt) > 120*time.Millisecond
				if ready && idle {
					if opus, err := m.codec.Encode(silence); err == nil {
						m.sendOpusFrameLocked(opus)
					}
				}
				m.mu.Unlock()
			}
		}
	}()
}

func (m *CallManager) onRelayData(data []byte) {
	if transport.IsStunPacket(data) {
		return
	}
	if !transport.IsRtpPacket(data) {
		return
	}
	if len(data) < 12 {
		return
	}
	pt := data[1] & 0x7f
	if pt != core.PayloadTypeWhatsAppOpus {
		return
	}

	seq := binary.BigEndian.Uint16(data[2:4])

	m.recvMu.Lock()
	defer m.recvMu.Unlock()

	if m.isDuplicateRtp(seq) {
		return
	}

	m.mu.Lock()
	if m.srtpSession == nil || m.codec == nil {
		m.mu.Unlock()
		return
	}
	ssrc := uint32(data[8])<<24 | uint32(data[9])<<16 | uint32(data[10])<<8 | uint32(data[11])
	if ssrc == m.selfSsrc {
		m.mu.Unlock()
		return
	}
	if !m.actualPeerSet {
		m.actualPeerSet = true
		if !containsSsrc(m.peerSsrcs, ssrc) {
			m.peerSsrcs = []uint32{ssrc}
			m.relay.SetSubscriptionSsrc(ssrc)
			go m.relay.ResendSubscriptions()
		}
	}
	srtp := m.srtpSession
	codec := m.codec
	decCodec := m.peerCodec // codec alternativo para peers servidor (evita crash SILK resampler)
	if decCodec == nil {
		decCodec = codec
	}
	m.mu.Unlock()

	pkt, err := srtp.Unprotect(data)
	if err != nil {
		m.log.Debug("srtp unprotect error", "err", err)
		return
	}
	if len(pkt.Payload) == 0 {
		return
	}
	pcm, err := decCodec.Decode(pkt.Payload)
	if err != nil {
		return
	}
	pcm = media.NormalizeFrame(pcm, decCodec.FrameSize())
	if m.OnPeerAudio != nil {
		m.OnPeerAudio(pcm)
	}
}
