# Generates 3 notification tones (chime, bell, alarm) as WAV files into ./sounds
import wave, struct, math, os
os.makedirs("sounds", exist_ok=True)
RATE = 22050

def write(name, samples):
    with wave.open(os.path.join("sounds", name), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 30000)) for s in samples))

def tone(freq, dur, vol=0.6, decay=4.0):
    n = int(RATE * dur)
    return [vol * math.sin(2 * math.pi * freq * i / RATE) * math.exp(-decay * i / n) for i in range(n)]

def silence(dur):
    return [0.0] * int(RATE * dur)

# chime: rising 3 notes
write("chime.wav", tone(659, 0.35) + tone(784, 0.35) + tone(988, 0.7, decay=5))
# bell: bell-like with harmonics, twice
def bell():
    n = int(RATE * 1.2)
    return [0.5 * (math.sin(2*math.pi*523*i/RATE) + 0.5*math.sin(2*math.pi*1046*i/RATE) + 0.25*math.sin(2*math.pi*1569*i/RATE)) * math.exp(-3.5*i/n) for i in range(n)]
write("bell.wav", bell() + silence(0.15) + bell())
# alarm: urgent beeps
beep = tone(1000, 0.18, vol=0.8, decay=0.3) + silence(0.08)
write("alarm.wav", (beep * 3 + silence(0.25)) * 2)

# soft: gentle two-note
write("soft.wav", tone(523, 0.6, vol=0.4, decay=3) + tone(659, 0.9, vol=0.4, decay=3))
# beep: short single beeps
b = tone(880, 0.12, vol=0.7, decay=0.2) + silence(0.12)
write("beep.wav", b * 4)
# melody: 6-note tune
notes = [523, 659, 784, 659, 784, 1047]
m = []
for f in notes:
    m += tone(f, 0.22, vol=0.55, decay=2.5)
write("melody.wav", m + silence(0.2) + m)
