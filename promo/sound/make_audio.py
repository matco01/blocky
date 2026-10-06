"""
Blocky promo sound: a bright, playful 25-second track and its sound effects,
synthesised from scratch with numpy — nothing sampled, nothing licensed.

    python sound/make_audio.py

Writes public/audio/music.wav and public/audio/sfx-*.wav.

The track is 120 BPM (a beat every 0.5 s — 15 frames at 30fps), in C major:
marimba arpeggios over C–G–Am–F, drums in at 2 s, a breakdown and riser at
18 s, everything back at 20 s, a final hit at 23.5 s.
"""

import os
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
LENGTH = 25.0
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio')
rng = np.random.default_rng(7)


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def env(n, attack=0.004, decay=0.3):
    t = np.arange(n) / SR
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / decay)


def lowpass(x, cutoff):
    """Windowed-sinc FIR: plenty for drums and noise."""
    taps = 101
    fc = cutoff / SR
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * fc * n) * np.hamming(taps)
    h /= h.sum()
    return np.convolve(x, h, mode='same')


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def note(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    semis = names[name[0]] + (1 if '#' in name else 0)
    octave = int(name[-1])
    return 440.0 * 2 ** ((semis + 12 * (octave + 1) - 69) / 12)


def marimba(freq, dur=0.45, vel=1.0):
    t = t_of(dur)
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t / 0.05) + 0.12 * np.sin(2 * np.pi * freq * 10 * t) * np.exp(-t / 0.01)
    return vel * tone * env(len(t), 0.002, 0.28)


def pluck_bass(freq, dur=0.35):
    t = t_of(dur)
    tone = sum((1 / k) * np.sin(2 * np.pi * freq * k * t) for k in range(1, 6))
    return 0.8 * lowpass(tone, 900) * env(len(t), 0.003, 0.22)


def kick(dur=0.35):
    t = t_of(dur)
    f = 50 + 110 * np.exp(-t / 0.04)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * env(len(t), 0.001, 0.16) * 1.2


def clap(dur=0.25):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    body = highpass(lowpass(noise, 4000), 800)
    e = env(n, 0.001, 0.07)
    # three quick flams, like hands
    for d in (0.008, 0.018):
        k = int(d * SR)
        e[k:] += 0.6 * env(n - k, 0.001, 0.02)
    return 0.55 * body * e


def hat(dur=0.08, open_=False):
    n = int((0.25 if open_ else dur) * SR)
    noise = highpass(rng.standard_normal(n), 7000)
    return 0.22 * noise * env(n, 0.001, 0.12 if open_ else 0.025)


def place(track, sound, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    j = min(len(track), i + len(sound))
    if i >= len(track):
        return
    left = gain * np.sqrt(0.5 * (1 - pan))
    right = gain * np.sqrt(0.5 * (1 + pan))
    track[i:j, 0] += sound[: j - i] * left * np.sqrt(2)
    track[i:j, 1] += sound[: j - i] * right * np.sqrt(2)


def write(path, stereo):
    stereo = stereo / max(1e-9, np.max(np.abs(stereo))) * 0.89
    data = (stereo * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def music():
    track = np.zeros((int(LENGTH * SR), 2))
    chords = [
        ['C4', 'E4', 'G4', 'C5'],
        ['G3', 'B3', 'D4', 'G4'],
        ['A3', 'C4', 'E4', 'A4'],
        ['F3', 'A3', 'C4', 'F4'],
    ]
    roots = ['C2', 'G1', 'A1', 'F1']
    pattern = [0, 1, 2, 3, 2, 1, 0, 2]  # eight 8th notes per bar
    bar = 4 * BEAT

    def section(t):
        if t < 2.0:
            return 'intro'
        if 18.0 <= t < 20.0:
            return 'break'
        if t >= 23.5:
            return 'outro'
        return 'full'

    t = 0.0
    bar_index = 0
    while t < 23.5:
        chord = chords[bar_index % 4]
        for step in range(8):
            at = t + step * BEAT / 2
            if at >= 23.5:
                break
            s = section(at)
            f = note(chord[pattern[step]])
            if s != 'break' or step % 2 == 0:
                place(track, marimba(f, vel=0.9 if step % 2 == 0 else 0.6), at, 0.5, pan=-0.35 if step % 2 else 0.35)
            # a sparkle an octave up on the offbeats once it's going
            if s == 'full' and step % 2 == 1 and at > 8:
                place(track, marimba(f * 2, 0.3, 0.35), at, 0.25, pan=0.5)
        for beat in range(4):
            at = t + beat * BEAT
            if at >= 23.5:
                break
            s = section(at)
            if s in ('full',):
                place(track, kick(), at, 0.9)
                if beat in (1, 3):
                    place(track, clap(), at, 0.7)
                place(track, hat(), at + BEAT / 2, 0.55, pan=0.2)
                place(track, hat(), at, 0.3, pan=-0.2)
                if beat in (0, 2):
                    place(track, pluck_bass(note(roots[bar_index % 4]) * 2), at, 0.7)
                else:
                    place(track, pluck_bass(note(roots[bar_index % 4]) * 2), at + BEAT / 2, 0.55)
        t += bar
        bar_index += 1

    # the riser into the drop at 20 s
    n = int(2.0 * SR)
    noise = rng.standard_normal(n)
    sweep = np.zeros(n)
    chunk = 2205
    for k in range(0, n, chunk):
        cutoff = 300 + (k / n) ** 2 * 9000
        seg = noise[k : k + chunk]
        sweep[k : k + chunk] = lowpass(seg, cutoff) if len(seg) > 101 else seg
    place(track, sweep * np.linspace(0, 0.5, n), 18.0, 0.8)
    place(track, kick(), 20.0, 1.2)

    # the final hit and ring-out
    hit = np.zeros(int(1.5 * SR))
    for name in ['C3', 'G3', 'C4', 'E4', 'G4', 'C5']:
        hit += marimba(note(name), 1.5, 0.8)[: len(hit)]
    place(track, hit, 23.5, 0.8)
    place(track, kick(), 23.5, 1.3)
    crash = highpass(rng.standard_normal(int(1.4 * SR)), 5000) * env(int(1.4 * SR), 0.001, 0.5)
    place(track, 0.35 * crash, 23.5, 0.8)

    # gentle fade at the very end
    fade = int(0.4 * SR)
    track[-fade:] *= np.linspace(1, 0, fade)[:, None]
    write(os.path.join(OUT, 'music.wav'), track)


def sfx():
    def mono_to_stereo(x):
        return np.stack([x, x], axis=1)

    # pop: a quick upward blip — things appearing
    t = t_of(0.09)
    f = 500 + 1400 * (t / t[-1])
    pop = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.001, 0.035)
    write(os.path.join(OUT, 'sfx-pop.wav'), mono_to_stereo(pop))

    # whoosh: filtered noise swelling and falling — transitions
    n = int(0.4 * SR)
    noise = rng.standard_normal(n)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    whoosh = np.zeros(n)
    for k in range(0, n, 1764):
        cutoff = 600 + 3000 * np.sin(np.pi * k / n)
        seg = noise[k : k + 1764]
        whoosh[k : k + 1764] = lowpass(seg, cutoff) if len(seg) > 101 else seg
    write(os.path.join(OUT, 'sfx-whoosh.wav'), mono_to_stereo(0.8 * whoosh * shape))

    # tap: a soft click — the cursor pressing
    n = int(0.05 * SR)
    tap = highpass(rng.standard_normal(n), 2000) * env(n, 0.0005, 0.006) + 0.6 * np.sin(2 * np.pi * 1800 * t_of(0.05)) * env(n, 0.0005, 0.01)
    write(os.path.join(OUT, 'sfx-tap.wav'), mono_to_stereo(tap))

    # type: a tiny tick per key
    n = int(0.03 * SR)
    typ = highpass(rng.standard_normal(n), 3500) * env(n, 0.0003, 0.004)
    write(os.path.join(OUT, 'sfx-type.wav'), mono_to_stereo(typ))

    # coin: two bright partials — money landing
    t = t_of(0.5)
    coin = (np.sin(2 * np.pi * 1318 * t) + 0.7 * np.sin(2 * np.pi * 1976 * t)) * env(len(t), 0.001, 0.12)
    coin[int(0.07 * SR) :] += (0.8 * np.sin(2 * np.pi * 2637 * t[: len(t) - int(0.07 * SR)])) * env(len(t) - int(0.07 * SR), 0.001, 0.2)
    write(os.path.join(OUT, 'sfx-coin.wav'), mono_to_stereo(coin))

    # success: a rising major arpeggio chime — Sent!
    out = np.zeros(int(0.9 * SR))
    for i, name in enumerate(['C5', 'E5', 'G5', 'C6']):
        s = marimba(note(name), 0.6, 1.0)
        k = int(i * 0.07 * SR)
        out[k : k + len(s)] += s[: len(out) - k]
    write(os.path.join(OUT, 'sfx-success.wav'), mono_to_stereo(out))

    # boing: a springy glide with wobble — Blocky bouncing
    t = t_of(0.45)
    f = 180 + 260 * np.exp(-t / 0.12) + 25 * np.sin(2 * np.pi * 14 * t) * np.exp(-t / 0.2)
    boing = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.002, 0.18)
    write(os.path.join(OUT, 'sfx-boing.wav'), mono_to_stereo(boing))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    music()
    sfx()
    print('written to', os.path.abspath(OUT))
