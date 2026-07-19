package call

import (
	"context"
	"encoding/binary"
	"fmt"
	"time"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"
	"wacalls/internal/voip/transport"
)

func (m *CallManager) initCodec() {
	if m.codec != nil {
		return
	}
	codec, err := media.NewMLowCodec(media.DefaultCodecOptions)
	if err != nil {
		m.log.Warn("MLow codec unavailable — call will run signaling-only (no audio)", "err", err)
		return
	}
	m.codec = codec

	// F3: Inicializa codec fallback para chamadas servidor->servidor
	fallback, err := media.NewOpusCodec(16000, 320)
	if err != nil {
		m.log.Warn("Opus fallback codec unavailable", "err", err)
	} else {
		m.fallbackCodec = fallback
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
		if containsSsrc(m.allowedPeerSsrcs, ssrc) {
			m.actualPeerSet = true
			m.peerSsrcs = []uint32{ssrc}
			m.relay.SetSubscriptionSsrc(ssrc)
			go m.relay.ResendSubscriptions()

			// Atualiza dinamicamente a chave de recebimento com a chave específica do dispositivo que está enviando esta SSRC
			if peerDeviceJid := m.findParticipantBySsrcLocked(ssrc); peerDeviceJid != "" {
				m.updateSrtpRecvKeyLocked(peerDeviceJid)
			}
		}
	}
	if !containsSsrc(m.peerSsrcs, ssrc) {
		m.mu.Unlock()
		return
	}
	srtp := m.srtpSession
	codec := m.codec
	m.mu.Unlock()

	pkt, err := srtp.Unprotect(data)
	if err != nil {
		m.log.Debug("srtp unprotect error", "err", err)
		return
	}
	if len(pkt.Payload) == 0 {
		return
	}

	m.rtpRecvCount++

	var pcm []float32
	var decodeErr error

	func() {
		defer func() {
			if r := recover(); r != nil {
				m.log.Error("RECOVERED panic in MLow decode", "panic", r)
				decodeErr = fmt.Errorf("panic in decode: %v", r)
			}
		}()
		pcm, decodeErr = codec.Decode(pkt.Payload)
	}()

	if decodeErr != nil {
		m.mu.Lock()
		m.decodeFailCount++
		shouldFallback := m.decodeFailCount > 5 && m.fallbackCodec != nil
		fallback := m.fallbackCodec
		m.mu.Unlock()

		if shouldFallback {
			func() {
				defer func() {
					if r := recover(); r != nil {
						m.log.Error("RECOVERED panic in Fallback decode", "panic", r)
						decodeErr = fmt.Errorf("panic in fallback decode: %v", r)
					}
				}()
				pcm, decodeErr = fallback.Decode(pkt.Payload)
			}()
			if decodeErr != nil {
				return // fallback falhou também
			}
			m.log.Debug("using fallback opus decoder", "fail_count", m.decodeFailCount)
		} else {
			return
		}
	}

	m.mu.Lock()
	m.decodeFailCount = 0
	m.mu.Unlock()
	m.decodeOkCount++

	if m.rtpRecvCount%100 == 1 {
		m.log.Info("RTP stats",
			"received", m.rtpRecvCount,
			"decode_ok", m.decodeOkCount,
			"ssrc", ssrc,
			"payload_len", len(pkt.Payload),
		)
	}

	pcm = media.NormalizeFrame(pcm, codec.FrameSize())
	if fn := m.peerAudioHandler(); fn != nil {
		fn(pcm)
	}
}
