#!/usr/bin/env node
import { parseArgs } from "node:util";
import { launchBrowser } from "./browsers.mjs";
import { serve } from "./serve.mjs";

/**
 * Times the shader program of each layer, built alone with a cold shader cache. It is the table to read when a first
 * visit is slow, and the check to run after adding a layer or a wonder. It opens the page, takes the exact source three.js
 * sent to the GPU for every distinct layer program, and then builds each one in a blank page in the same browser. A
 * program is linked and drawn once into a 64 by 64 target with the three outputs of a layer, and the clock stops when a
 * pixel has been read back, because engines finish the work at the link or at the first draw. The line after
 * `shadeSurfel` multiplies the colour by 1 plus a number of the run, which is a source nobody on this machine has
 * compiled, so the browser's cache and the operating system's cannot answer.
 *
 *   node scripts/qa/shader-cost.mjs [--browser chrome] [--seed 1]
 *
 * The page starts all of its programs together and Chrome overlaps their links, so the total here is longer than the
 * wait that `cold-start.mjs` reports. Layers that share a program share a row.
 */
const { values } = parseArgs({
  options: {
    browser: { type: "string", default: "chrome" },
    seed: { type: "string", default: "1" },
  },
});
const ANCHOR = "vec3 col = shadeSurfel(s, n, p);";

/** Runs in the page. The layers grouped by program, each with the source the GPU got. */
function collectPrograms() {
  const world = window.__origami.world;
  const gl = world.stage.renderer.getContext();
  const display = world.stage.spark.display;
  const groups = new Map();
  for (const layer of world.layers) {
    const { material } = display.prepareProgramMaterial(layer.generator, layer.covGenerator);
    const group = groups.get(material.fragmentShader) ?? { names: [], source: material.fragmentShader };
    group.names.push(layer.name);
    groups.set(material.fragmentShader, group);
  }
  const compiled = world.stage.renderer.info.programs.map((info) => {
    const parts = gl.getAttachedShaders(info.program).map((shader) => ({ vertex: gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER, text: gl.getShaderSource(shader) }));
    return { vs: parts.find((p) => p.vertex).text, fs: parts.find((p) => !p.vertex).text };
  });
  return [...groups.values()].map((group) => {
    const built = compiled.find((p) => p.fs.includes(group.source.slice(group.source.length >> 1)));
    if (!built) throw new Error(`no program on the GPU matches the layers ${group.names.join(",")}`);
    return { names: group.names.join(","), ...built };
  });
}

/** Runs in a blank page. Builds each program with a source of its own and says how long that took. */
function buildEach({ programs, anchor, nonce }) {
  const gl = document.getElementById("c").getContext("webgl2");
  gl.getExtension("EXT_color_buffer_float");
  const targets = [gl.RGBA32UI, gl.RGBA32UI, gl.RGBA32F].map((format, i) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, 64, 64);
    return { texture, attachment: gl.COLOR_ATTACHMENT0 + i };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  for (const { texture, attachment } of targets) gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0);
  gl.drawBuffers(targets.map((t) => t.attachment));
  gl.viewport(0, 0, 64, 64);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const samplerTextures = {
    [gl.SAMPLER_2D]: [gl.TEXTURE_2D, gl.RGBA32F],
    [gl.UNSIGNED_INT_SAMPLER_2D]: [gl.TEXTURE_2D, gl.RGBA32UI],
    [gl.SAMPLER_2D_ARRAY]: [gl.TEXTURE_2D_ARRAY, gl.RGBA32F],
    [gl.UNSIGNED_INT_SAMPLER_2D_ARRAY]: [gl.TEXTURE_2D_ARRAY, gl.RGBA32UI],
  };
  const pixel = new Float32Array(4);
  return programs.map((program, index) => {
    const start = performance.now();
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const handle = gl.createProgram();
    gl.attachShader(handle, compile(gl.VERTEX_SHADER, program.vs));
    gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, program.fs.replace(anchor, `${anchor} col *= 1.0 + float(${nonce + index}) * 1.2e-7;`)));
    gl.bindAttribLocation(handle, 0, "position");
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) return { names: program.names, error: gl.getProgramInfoLog(handle).slice(0, 200) };
    const linked = performance.now();
    gl.useProgram(handle);
    let unit = 0;
    for (let i = 0; i < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(handle, i);
      const kind = samplerTextures[info.type];
      if (!kind) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(kind[0], gl.createTexture());
      gl.texParameteri(kind[0], gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(kind[0], gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (kind[0] === gl.TEXTURE_2D) gl.texStorage2D(kind[0], 1, kind[1], 1, 1);
      else gl.texStorage3D(kind[0], 1, kind[1], 1, 1, 1);
      gl.uniform1i(gl.getUniformLocation(handle, info.name), unit++);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const error = gl.getError();
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
    return { names: program.names, lines: program.fs.split("\n").length, linkMs: linked - start, drawMs: performance.now() - linked, error: error === 0 ? null : `GL error ${error}` };
  });
}

const server = await serve([]);
const browser = await launchBrowser(values.browser);
try {
  const game = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await game.goto(`${server.base}/?debug&calm&seed=${values.seed}`);
  await game.waitForFunction(() => window.__origami, null, { timeout: 120_000, polling: 100 });
  const programs = await game.evaluate(collectPrograms);
  await game.close();
  const blank = await browser.newPage();
  await blank.setContent('<canvas id="c" width="64" height="64"></canvas>');
  const rows = await blank.evaluate(buildEach, { programs, anchor: ANCHOR, nonce: 1000 + Math.floor(Math.random() * 90_000) });
  let total = 0;
  for (const row of rows) {
    if (row.error) {
      console.log(`${row.names}: ${row.error}`);
      continue;
    }
    total += row.linkMs + row.drawMs;
    console.log(`${String(Math.round(row.linkMs + row.drawMs)).padStart(6)} ms  link ${String(Math.round(row.linkMs)).padStart(5)}  draw ${String(Math.round(row.drawMs)).padStart(5)}  ${String(row.lines).padStart(5)} lines  ${row.names}`);
  }
  console.log(`${String(Math.round(total)).padStart(6)} ms  for ${rows.length} programs, one after the other`);
  process.exitCode = rows.some((row) => row.error) ? 1 : 0;
} finally {
  await browser.close();
  server.stop();
}
