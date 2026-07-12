package media

// Pre-computed tables for fast G.711 u-law conversion.
var (
	ulawToLinear [256]int16
	linearToUlaw [65536]byte
)

func init() {
	// Initialize lookup tables
	for i := 0; i < 256; i++ {
		ulawToLinear[i] = decodeMuLaw(byte(i))
	}
	for i := -32768; i <= 32767; i++ {
		linearToUlaw[uint16(i)] = encodeMuLaw(int16(i))
	}
}

func decodeMuLaw(u byte) int16 {
	u = ^u
	sign := int16(u & 0x80)
	exponent := int16((u >> 4) & 0x07)
	mantissa := int16(u & 0x0F)
	sample := int16((mantissa << 3) + 132)
	sample <<= uint(exponent)
	sample -= 132
	if sign != 0 {
		return -sample
	}
	return sample
}

func encodeMuLaw(number int16) byte {
	var sign, exponent, mantissa int16
	var mask int16
	if number < 0 {
		number = -number
		sign = 0x80
	}
	number += 132
	if number > 32635 {
		number = 32635
	}
	for exponent = 7; exponent >= 0; exponent-- {
		mask = 1 << uint(exponent+7)
		if (number & mask) != 0 {
			break
		}
	}
	mantissa = (number >> uint(exponent+3)) & 0x0F
	return ^byte(sign | (exponent << 4) | mantissa)
}

type pcmuCodec struct {
	frameSize int
}

func NewPCMUCodec(frameSize int) Codec {
	return &pcmuCodec{frameSize: frameSize}
}

func (c *pcmuCodec) FrameSize() int  { return c.frameSize }
func (c *pcmuCodec) SampleRate() int { return 8000 }
func (c *pcmuCodec) Close()          {}

func (c *pcmuCodec) Encode(pcm []float32) ([]byte, error) {
	out := make([]byte, len(pcm))
	for i, s := range pcm {
		if s > 1.0 {
			s = 1.0
		} else if s < -1.0 {
			s = -1.0
		}
		val := int16(s * 32767)
		out[i] = linearToUlaw[uint16(val)]
	}
	return out, nil
}

func (c *pcmuCodec) Decode(frame []byte) ([]float32, error) {
	out := make([]float32, len(frame))
	for i, u := range frame {
		val := ulawToLinear[u]
		out[i] = float32(val) / 32768.0
	}
	return out, nil
}
