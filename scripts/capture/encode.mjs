import { spawn } from "node:child_process";

/**
 * Encodes numbered PNG frames and the soundtrack into an H.264 MP4.
 *
 *   node scripts/capture/encode.mjs --frames .work/frames/1080 --audio theme.mp3 --out out/reality-origami-1080p.mp4
 *
 * Options: --fps 24, --crf 14, --preset slow, --gain -1 (dB), --size 1920,1080 (scales if different from the frames),
 * --seconds 48.04, --fade-out 1.0
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const need = (name) => {
  if (!args[name]) throw new Error(`missing --${name}`);
  return args[name];
};

const frames = need("frames");
const audio = need("audio");
const out = need("out");
const fps = args.fps ?? "24";
const crf = args.crf ?? "14";
const preset = args.preset ?? "slow";
const gain = args.gain ?? "-1";
const seconds = Number(args.seconds ?? 48.04);
const fadeOut = Number(args["fade-out"] ?? 1.0);
const scale = args.size ? args.size.replace(",", ":") : null;

const video = [scale ? `scale=${scale}:flags=lanczos` : null, "scale=in_range=pc:out_range=tv:out_color_matrix=bt709", "format=yuv420p"].filter(Boolean).join(",");
const sound = `volume=${gain}dB,afade=t=in:st=0:d=0.04,afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut}`;

const ffmpeg = [
  "-y",
  "-framerate", fps,
  "-i", `${frames}/f%05d.png`,
  "-i", audio,
  "-vf", video,
  "-af", sound,
  "-c:v", "libx264", "-preset", preset, "-crf", crf, "-profile:v", "high",
  "-pix_fmt", "yuv420p",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "256k",
  "-movflags", "+faststart",
  "-t", String(seconds),
  out,
];

console.log(`ffmpeg ${ffmpeg.join(" ")}`);
const child = spawn("ffmpeg", ffmpeg, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
