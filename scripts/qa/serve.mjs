import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** A port nothing is listening on, so a script never talks to somebody else's dev server by mistake. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts `npx vite <args>` on a free port in its own process group and waits until it answers.
 * `stop()` ends the whole group, because `npx` leaves its child running when it alone is killed.
 */
export async function serve(args, { timeoutMs = 60_000 } = {}) {
  const port = await freePort();
  const child = spawn("npx", ["vite", ...args, "--port", String(port), "--strictPort"], { stdio: "ignore", detached: true });
  const stop = () => {
    try {
      process.kill(-child.pid);
    } catch {
      // already gone
    }
  };
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(base)).ok) return { base, stop };
    } catch {
      // still starting
    }
    if (Date.now() > until) {
      stop();
      throw new Error(`Vite did not start within ${timeoutMs / 1000} s`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
