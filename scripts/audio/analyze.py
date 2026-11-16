#!/usr/bin/env python3
"""Analyze a music track into a timing sheet used to cut the trailer.

Writes a JSON file with band energies, onsets, impacts, risers, sections and a
tempo estimate, plus a diagnostic PNG. Everything is derived from the audio so
the edit can be re-synced if the track changes.

Usage:
    analyze.py TRACK.mp3 --json .work/audio-analysis.json --png .work/audio-analysis.png

Needs ffmpeg on the PATH and the packages in requirements.txt.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage, signal

SR = 44100
N_FFT = 4096
HOP = 512

BANDS: dict[str, tuple[float, float]] = {
    "sub": (20, 90),
    "bass": (90, 250),
    "lowmid": (250, 800),
    "mid": (800, 3000),
    "high": (3000, 8000),
    "air": (8000, 16000),
}


def decode_mono(path: str) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def stft_mag(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    freqs, times, z = signal.stft(x, fs=SR, nperseg=N_FFT, noverlap=N_FFT - HOP, window="hann", boundary=None, padded=False)
    return freqs, times, np.abs(z)


def band_db(mag: np.ndarray, freqs: np.ndarray) -> dict[str, np.ndarray]:
    out = {}
    for name, (lo, hi) in BANDS.items():
        sel = (freqs >= lo) & (freqs < hi)
        power = (mag[sel] ** 2).sum(axis=0)
        out[name] = 10 * np.log10(power + 1e-12)
    return out


def rms_db(x: np.ndarray, times: np.ndarray) -> np.ndarray:
    win = N_FFT
    out = np.empty(len(times))
    for i, t in enumerate(times):
        c = int(t * SR)
        seg = x[max(0, c - win // 2) : c + win // 2]
        out[i] = 20 * np.log10(np.sqrt(np.mean(seg**2)) + 1e-9) if len(seg) else -120
    return out


def spectral_flux(mag: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sel = (freqs >= lo) & (freqs < hi)
    logm = np.log1p(30.0 * mag[sel])
    diff = np.diff(logm, axis=1, prepend=logm[:, :1])
    return np.maximum(diff, 0).sum(axis=0)


def pick_onsets(flux: np.ndarray, times: np.ndarray, min_gap_s: float, prominence: float) -> list[dict]:
    smooth = ndimage.gaussian_filter1d(flux, 1.0)
    baseline = ndimage.uniform_filter1d(smooth, size=int(1.5 * SR / HOP))
    novelty = np.maximum(smooth - baseline, 0)
    peaks, props = signal.find_peaks(novelty, distance=int(min_gap_s * SR / HOP), prominence=prominence)
    return [{"t": float(times[p]), "strength": float(novelty[p])} for p in peaks]


def estimate_tempo(flux: np.ndarray) -> list[dict]:
    env = flux - ndimage.uniform_filter1d(flux, size=int(1.0 * SR / HOP))
    env = np.maximum(env, 0)
    ac = signal.correlate(env, env, mode="full")[len(env) - 1 :]
    ac /= ac[0] + 1e-12
    fps = SR / HOP
    lo_lag, hi_lag = int(fps * 60 / 180), int(fps * 60 / 50)
    seg = ac[lo_lag:hi_lag]
    peaks, _ = signal.find_peaks(seg, prominence=0.02)
    cands = sorted(((float(seg[p]), 60.0 * fps / (p + lo_lag)) for p in peaks), reverse=True)[:5]
    return [{"bpm": round(b, 2), "score": round(s, 3)} for s, b in cands]


@dataclass
class Section:
    start: float
    end: float
    mean_db: float


def sections_from_energy(times: np.ndarray, db: np.ndarray, min_len_s: float = 2.5) -> list[Section]:
    sm = ndimage.gaussian_filter1d(db, sigma=int(0.6 * SR / HOP))
    step = int(0.25 * SR / HOP)
    coarse = sm[::step]
    ct = times[::step]
    grad = np.gradient(ndimage.gaussian_filter1d(coarse, 2))
    peaks, _ = signal.find_peaks(np.abs(grad), distance=int(min_len_s / 0.25), prominence=0.4)
    cuts = [0.0] + [float(ct[p]) for p in peaks] + [float(times[-1])]
    out = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        m = (times >= a) & (times < b)
        out.append(Section(a, b, float(db[m].mean()) if m.any() else -120.0))
    return out


def find_risers(times: np.ndarray, high_db: np.ndarray, min_len_s: float = 2.0) -> list[dict]:
    """A riser is a sustained monotonic climb in the smoothed high band."""
    sm = ndimage.gaussian_filter1d(high_db, sigma=int(0.4 * SR / HOP))
    slope = np.gradient(sm) * (SR / HOP)
    rising = ndimage.binary_opening(slope > 0.8, structure=np.ones(int(0.5 * SR / HOP)))
    labels, n = ndimage.label(rising)
    out = []
    for i in range(1, n + 1):
        idx = np.where(labels == i)[0]
        t0, t1 = float(times[idx[0]]), float(times[idx[-1]])
        if t1 - t0 >= min_len_s:
            out.append({"start": t0, "end": t1, "gain_db": float(sm[idx[-1]] - sm[idx[0]])})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("track")
    ap.add_argument("--json", required=True)
    ap.add_argument("--png")
    args = ap.parse_args()
    for target in (args.json, args.png):
        if target:
            Path(target).parent.mkdir(parents=True, exist_ok=True)

    x = decode_mono(args.track)
    freqs, times, mag = stft_mag(x)
    bands = band_db(mag, freqs)
    rdb = rms_db(x, times)

    flux_all = spectral_flux(mag, freqs, 30, 12000)
    flux_low = spectral_flux(mag, freqs, 30, 250)
    onsets = pick_onsets(flux_all, times, min_gap_s=0.18, prominence=0.6)
    impacts = pick_onsets(flux_low, times, min_gap_s=0.6, prominence=float(np.percentile(flux_low, 97)) * 0.6)
    for imp in impacts:
        i = int(np.searchsorted(times, imp["t"]))
        pre = rdb[max(0, i - int(0.8 * SR / HOP)) : max(1, i - 2)]
        post = rdb[i : i + int(0.25 * SR / HOP)]
        imp["jump_db"] = float(post.max() - pre.mean()) if len(pre) and len(post) else 0.0
    impacts.sort(key=lambda d: d["t"])

    secs = sections_from_energy(times, rdb)
    risers = find_risers(times, bands["high"])
    tempo = estimate_tempo(flux_all)

    stride = max(1, int(round((SR / HOP) / 20)))
    out = {
        "track": args.track.split("/")[-1],
        "duration": float(len(x) / SR),
        "sampleRate": SR,
        "tempoCandidates": tempo,
        "sections": [{"start": s.start, "end": s.end, "meanDb": round(s.mean_db, 2)} for s in secs],
        "risers": risers,
        "impacts": impacts,
        "onsets": onsets,
        "envelope20Hz": {
            "t": [round(float(t), 3) for t in times[::stride]],
            "rmsDb": [round(float(v), 2) for v in rdb[::stride]],
            **{f"{k}Db": [round(float(v), 2) for v in b[::stride]] for k, b in bands.items()},
        },
    }
    with open(args.json, "w") as f:
        json.dump(out, f, indent=1)

    if args.png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(4, 1, figsize=(18, 11), sharex=True)
        tt = np.arange(len(x)) / SR
        ax[0].plot(tt[::64], x[::64], lw=0.4, color="#335")
        ax[0].set_ylabel("wave")
        spec = 20 * np.log10(mag + 1e-7)
        keep = freqs <= 12000
        ax[1].imshow(spec[keep][::-1], aspect="auto", extent=[times[0], times[-1], 0, 12000], vmin=-110, vmax=-20, cmap="magma")
        ax[1].set_yscale("linear")
        ax[1].set_ylabel("spectrogram Hz")
        for k, b in bands.items():
            ax[2].plot(times, ndimage.gaussian_filter1d(b, 2), label=k, lw=1)
        ax[2].plot(times, rdb, color="k", lw=1.4, label="rms")
        ax[2].legend(ncol=7, fontsize=8)
        ax[2].set_ylabel("dB")
        ax[3].plot(times, flux_all, lw=0.6, color="#555", label="flux")
        ax[3].plot(times, flux_low, lw=0.8, color="#c33", label="low flux")
        for o in onsets:
            ax[3].axvline(o["t"], color="#38a", alpha=0.25, lw=0.7)
        for imp in impacts:
            ax[3].axvline(imp["t"], color="#d22", alpha=0.9, lw=1.5)
            ax[3].text(imp["t"], ax[3].get_ylim()[1] * 0.9, f"{imp['t']:.2f}", rotation=90, fontsize=8, color="#d22")
        for s in secs:
            for a in ax:
                a.axvline(s.start, color="#2a2", ls="--", alpha=0.5, lw=1)
        for r in risers:
            ax[2].axvspan(r["start"], r["end"], color="#fa0", alpha=0.18)
        ax[3].legend(fontsize=8)
        ax[3].set_xlabel("seconds")
        ax[3].set_xticks(np.arange(0, 49, 2))
        plt.tight_layout()
        fig.savefig(args.png, dpi=70)

    print(f"duration {out['duration']:.3f}s  onsets {len(onsets)}  impacts {len(impacts)}  sections {len(secs)}  risers {len(risers)}")
    print("tempo:", tempo[:3])
    print("impacts:", [(round(i["t"], 2), round(i["jump_db"], 1)) for i in impacts])
    print("sections:", [(round(s.start, 1), round(s.end, 1), round(s.mean_db, 1)) for s in secs])
    print("risers:", [(round(r["start"], 1), round(r["end"], 1), round(r["gain_db"], 1)) for r in risers])


if __name__ == "__main__":
    main()
