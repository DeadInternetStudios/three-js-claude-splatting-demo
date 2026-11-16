#!/usr/bin/env python3
"""Reduce the analysis that analyze.py wrote to the compact cue file the film reads.

    export_cues.py [--analysis .work/audio-analysis.json] [--out src/film/audio-cues.json]

The bar grid is fitted to the strong, evenly spaced impacts. Loudness envelopes are normalised to
0..1 so visuals can follow the music without knowing its absolute level.
"""
from __future__ import annotations

import argparse
import json

import numpy as np


def normalise(db: np.ndarray, lo_pct: float = 5.0, hi_pct: float = 98.0) -> np.ndarray:
    lo, hi = np.percentile(db, [lo_pct, hi_pct])
    return np.clip((db - lo) / max(hi - lo, 1e-6), 0.0, 1.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--analysis", default=".work/audio-analysis.json")
    ap.add_argument("--out", default="src/film/audio-cues.json")
    args = ap.parse_args()
    a = json.load(open(args.analysis))

    regular = [i for i in a["impacts"] if i["t"] < 18.0]
    t = np.array([i["t"] for i in regular])
    k = np.arange(1, len(t) + 1, dtype=float)
    bar, t0 = np.polyfit(k, t, 1)
    grid = {"t0": round(float(t0), 4), "bar": round(float(bar), 4), "beat": round(float(bar) / 4.0, 4)}

    env = a["envelope20Hz"]
    et = np.array(env["t"])
    hz = float(1.0 / np.median(np.diff(et)))
    keep = lambda key: [round(float(v), 3) for v in normalise(np.array(env[key]))]

    out = {
        "track": a["track"],
        "duration": round(float(a["duration"]), 3),
        "grid": grid,
        "impacts": [{"t": round(i["t"], 3), "strength": round(i["strength"], 2)} for i in a["impacts"]],
        "onsets": [{"t": round(o["t"], 3), "strength": round(o["strength"], 2)} for o in a["onsets"] if o["strength"] >= 3.0],
        "risers": [{"start": round(r["start"], 3), "end": round(r["end"], 3), "gainDb": round(r["gain_db"], 1)} for r in a["risers"]],
        "sections": [{"start": round(s["start"], 3), "end": round(s["end"], 3), "meanDb": s["meanDb"]} for s in a["sections"]],
        "envelope": {
            "hz": round(hz, 3),
            "rms": keep("rmsDb"),
            "bass": keep("bassDb"),
            "high": keep("highDb"),
        },
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"grid {grid}; {len(out['onsets'])} onsets; envelope {len(out['envelope']['rms'])} samples at {hz:.2f} Hz -> {args.out}")


if __name__ == "__main__":
    main()
