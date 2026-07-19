package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type ServerAudioRecorder struct {
	mu         sync.Mutex
	file       *os.File
	sampleRate uint32
	numSamples uint32
	callID     string
	filePath   string

	inPos   uint64
	outPos  uint64
	basePos uint64
	mixBuf  []float32
}

func NewServerAudioRecorder(recordingsDir, callID string) (*ServerAudioRecorder, error) {
	if err := os.MkdirAll(recordingsDir, 0755); err != nil {
		return nil, err
	}
	filePath := filepath.Join(recordingsDir, fmt.Sprintf("%s.wav", callID))
	f, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}

	r := &ServerAudioRecorder{
		file:       f,
		sampleRate: 16000,
		callID:     callID,
		filePath:   filePath,
		mixBuf:     make([]float32, 0, 16000),
	}

	// Escreve o cabeçalho WAV de 44 bytes inicial
	if err := r.writeHeader(0); err != nil {
		f.Close()
		return nil, err
	}

	return r, nil
}

func (r *ServerAudioRecorder) writeHeader(dataSize uint32) error {
	var hdr [44]byte
	copy(hdr[0:4], "RIFF")
	binary.LittleEndian.PutUint32(hdr[4:8], 36+dataSize)
	copy(hdr[8:12], "WAVE")
	copy(hdr[12:16], "fmt ")
	binary.LittleEndian.PutUint32(hdr[16:20], 16) // Subchunk1Size (16 p/ PCM)
	binary.LittleEndian.PutUint16(hdr[20:22], 1)  // AudioFormat (1 p/ PCM)
	binary.LittleEndian.PutUint16(hdr[22:24], 1)  // NumChannels (1 mono)
	binary.LittleEndian.PutUint32(hdr[24:28], r.sampleRate)
	binary.LittleEndian.PutUint32(hdr[28:32], r.sampleRate*2) // ByteRate
	binary.LittleEndian.PutUint16(hdr[32:34], 2)               // BlockAlign
	binary.LittleEndian.PutUint16(hdr[34:36], 16)              // BitsPerSample
	copy(hdr[36:40], "data")
	binary.LittleEndian.PutUint32(hdr[40:44], dataSize)

	_, err := r.file.WriteAt(hdr[:], 0)
	return err
}

func (r *ServerAudioRecorder) WriteInbound(pcm []float32) {
	if len(pcm) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return
	}

	offset := r.inPos - r.basePos
	r.ensureCap(offset + uint64(len(pcm)))

	for i, s := range pcm {
		r.mixBuf[offset+uint64(i)] += s
	}
	r.inPos += uint64(len(pcm))
	r.flushLocked(false)
}

func (r *ServerAudioRecorder) WriteOutbound(pcm []float32) {
	if len(pcm) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return
	}

	offset := r.outPos - r.basePos
	r.ensureCap(offset + uint64(len(pcm)))

	for i, s := range pcm {
		r.mixBuf[offset+uint64(i)] += s
	}
	r.outPos += uint64(len(pcm))
	r.flushLocked(false)
}

func (r *ServerAudioRecorder) ensureCap(size uint64) {
	if uint64(len(r.mixBuf)) < size {
		needed := size - uint64(len(r.mixBuf))
		r.mixBuf = append(r.mixBuf, make([]float32, needed)...)
	}
}

func (r *ServerAudioRecorder) min64(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}

func (r *ServerAudioRecorder) max64(a, b uint64) uint64 {
	if a > b {
		return a
	}
	return b
}

func (r *ServerAudioRecorder) flushLocked(forceAll bool) {
	if r.file == nil {
		return
	}

	var targetPos uint64
	if forceAll {
		targetPos = r.max64(r.inPos, r.outPos)
	} else {
		targetPos = r.min64(r.inPos, r.outPos)

		// Se uma das vias ficar sem pacotes por mais de 3200 amostras (200ms), avança automaticamente
		maxPos := r.max64(r.inPos, r.outPos)
		if maxPos > targetPos+3200 {
			targetPos = maxPos - 3200
		}
	}

	if targetPos <= r.basePos {
		return
	}

	flushSamples := targetPos - r.basePos
	if uint64(len(r.mixBuf)) < flushSamples {
		r.ensureCap(flushSamples)
	}

	toWrite := r.mixBuf[:flushSamples]
	buf := make([]byte, len(toWrite)*2)
	for i, sample := range toWrite {
		if sample > 1.0 {
			sample = 1.0
		} else if sample < -1.0 {
			sample = -1.0
		}
		val := int16(sample * 32767.0)
		binary.LittleEndian.PutUint16(buf[i*2:(i+1)*2], uint16(val))
	}

	n, err := r.file.Write(buf)
	if err == nil {
		r.numSamples += uint32(n / 2)
	}

	r.mixBuf = r.mixBuf[flushSamples:]
	r.basePos = targetPos
	if r.inPos < r.basePos {
		r.inPos = r.basePos
	}
	if r.outPos < r.basePos {
		r.outPos = r.basePos
	}
}

func (r *ServerAudioRecorder) Close() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return r.filePath
	}

	r.flushLocked(true)

	dataSize := r.numSamples * 2
	_ = r.writeHeader(dataSize)
	_ = r.file.Close()
	r.file = nil
	return r.filePath
}
