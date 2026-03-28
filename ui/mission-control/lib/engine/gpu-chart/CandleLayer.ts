import type { OhlcBar } from "./sharedBuffer";
import { createArrayBuffer, createProgram } from "./glUtils";

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aLocal;
layout(location = 1) in float aCenterX;
layout(location = 2) in float aOpenY;
layout(location = 3) in float aHighY;
layout(location = 4) in float aLowY;
layout(location = 5) in float aCloseY;
layout(location = 6) in float aHalfWidth;
layout(location = 7) in vec3 aColor;

out vec3 vColor;

void main() {
  float bodyTop = max(aOpenY, aCloseY);
  float bodyBottom = min(aOpenY, aCloseY);
  float wickMask = 1.0 - step(0.2, abs(aLocal.x));
  float yTop = mix(bodyTop, aHighY, wickMask);
  float yBottom = mix(bodyBottom, aLowY, wickMask);

  float x = aCenterX + aLocal.x * aHalfWidth;
  float y = mix(yBottom, yTop, (aLocal.y + 1.0) * 0.5);
  vColor = aColor;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
out vec4 outColor;

void main() {
  outColor = vec4(vColor, 0.98);
}
`;

const INSTANCE_STRIDE_FLOATS = 10;
const LAST_BAR_SMOOTH_TIME_MS_DEFAULT = 140;

type LastBarAnimState = {
  target: OhlcBar;
  display: OhlcBar;
  lastFrameMs: number;
  displaySig: string;
};

type ViewportState = {
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  maxInstances: number;
  instanceData: Float32Array;
  previousCount: number;
  previousRangeSig: string;
  previousLastSig: string;
  minPrice: number;
  span: number;
  halfWidth: number;
  lastBarAnim: LastBarAnimState | null;
};

export class CandleLayer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private localBuffer: WebGLBuffer;
  private viewportStates = new Map<string, ViewportState>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);

    const localQuad = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);

    this.localBuffer = createArrayBuffer(gl, localQuad, gl.STATIC_DRAW);
  }

  dispose(): void {
    const gl = this.gl;
    for (const state of this.viewportStates.values()) {
      gl.deleteBuffer(state.instanceBuffer);
      gl.deleteVertexArray(state.vao);
    }
    this.viewportStates.clear();
    gl.deleteBuffer(this.localBuffer);
    gl.deleteProgram(this.program);
  }

  evictUnusedViewports(activeIds: Set<string>): void {
    const gl = this.gl;
    for (const [id, state] of this.viewportStates) {
      if (!activeIds.has(id)) {
        gl.deleteBuffer(state.instanceBuffer);
        gl.deleteVertexArray(state.vao);
        this.viewportStates.delete(id);
      }
    }
  }

  draw(viewportId: string, bars: OhlcBar[], options?: { allowUpload?: boolean; frameTimeMs?: number; smoothingMs?: number }): void {
    if (bars.length === 0) {
      return;
    }

    const gl = this.gl;
    const count = bars.length;
    const state = this.getOrCreateViewportState(viewportId);
    const allowUpload = options?.allowUpload ?? true;
    const frameTimeMs = Number.isFinite(options?.frameTimeMs) ? Number(options?.frameTimeMs) : performance.now();
    const smoothingMs = Number.isFinite(options?.smoothingMs)
      ? Math.max(0, Number(options?.smoothingMs))
      : LAST_BAR_SMOOTH_TIME_MS_DEFAULT;

    const lastBar = bars[count - 1];
    const displayLastBar = resolveDisplayLastBar(state, lastBar, frameTimeMs, smoothingMs);

    if (!allowUpload && state.previousCount > 0) {
      gl.useProgram(this.program);
      gl.bindVertexArray(state.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, state.previousCount);
      gl.bindVertexArray(null);
      return;
    }

    this.ensureInstanceCapacity(state, count);

    const range = resolvePriceRange(bars, count);
    const rangeSig = `${count}|${range.minPrice}|${range.maxPrice}`;
    const lastSig = buildLastBarSignature(lastBar);
    const isFullUpload = state.previousCount !== count || state.previousRangeSig !== rangeSig;

    gl.useProgram(this.program);
    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.instanceBuffer);

    if (isFullUpload) {
      const packed = packAllBars(bars, count, range.minPrice, range.maxPrice, state.instanceData);
      const lastBase = (count - 1) * INSTANCE_STRIDE_FLOATS;
      writePackedBar(
        state.instanceData,
        lastBase,
        count - 1,
        count,
        displayLastBar,
        range.minPrice,
        Math.max(1e-6, range.maxPrice - range.minPrice),
        Math.min(0.028, 0.76 / Math.max(1, count)),
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.subarray(0, count * INSTANCE_STRIDE_FLOATS));
      state.minPrice = range.minPrice;
      state.span = Math.max(1e-6, range.maxPrice - range.minPrice);
      state.halfWidth = Math.min(0.028, 0.76 / Math.max(1, count));
      state.previousCount = count;
      state.previousRangeSig = rangeSig;
      state.previousLastSig = lastSig;
    } else {
      const index = count - 1;
      const base = index * INSTANCE_STRIDE_FLOATS;
      const displaySig = buildLastBarSignature(displayLastBar);
      const shouldUploadLast = state.previousLastSig !== lastSig
        || state.lastBarAnim?.displaySig !== displaySig;
      if (shouldUploadLast) {
        writePackedBar(state.instanceData, base, index, count, displayLastBar, state.minPrice, state.span, state.halfWidth);
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          base * 4,
          state.instanceData.subarray(base, base + INSTANCE_STRIDE_FLOATS),
        );
      }
      state.previousLastSig = lastSig;
      if (state.lastBarAnim) {
        state.lastBarAnim.displaySig = displaySig;
      }
    }

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  private getOrCreateViewportState(viewportId: string): ViewportState {
    const existing = this.viewportStates.get(viewportId);
    if (existing) {
      return existing;
    }

    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error("gpu_candle_vao_failed");
    }
    const instanceBuffer = createArrayBuffer(gl, new Float32Array(16), gl.DYNAMIC_DRAW);

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.localBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);

    // x/open/high/low/close/halfWidth/color.rgb
    this.bindInstanceAttrib(1, 1, 0);
    this.bindInstanceAttrib(2, 1, 1);
    this.bindInstanceAttrib(3, 1, 2);
    this.bindInstanceAttrib(4, 1, 3);
    this.bindInstanceAttrib(5, 1, 4);
    this.bindInstanceAttrib(6, 1, 5);
    this.bindInstanceAttrib(7, 3, 6);

    gl.bindVertexArray(null);

    const state: ViewportState = {
      vao,
      instanceBuffer,
      maxInstances: 0,
      instanceData: new Float32Array(0),
      previousCount: -1,
      previousRangeSig: "",
      previousLastSig: "",
      minPrice: 0,
      span: 1,
      halfWidth: 0.02,
      lastBarAnim: null,
    };
    this.viewportStates.set(viewportId, state);
    return state;
  }

  private bindInstanceAttrib(location: number, size: number, offsetFloats: number): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, INSTANCE_STRIDE_FLOATS * 4, offsetFloats * 4);
    gl.vertexAttribDivisor(location, 1);
  }

  private ensureInstanceCapacity(state: ViewportState, count: number): void {
    if (count <= state.maxInstances) {
      return;
    }

    const gl = this.gl;
    state.maxInstances = Math.max(count, state.maxInstances * 2, 512);
    state.instanceData = new Float32Array(state.maxInstances * INSTANCE_STRIDE_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, state.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }
}

function resolveDisplayLastBar(state: ViewportState, target: OhlcBar, frameTimeMs: number, smoothingMs: number): OhlcBar {
  if (!state.lastBarAnim) {
    const seeded = sanitizeBar(target);
    state.lastBarAnim = {
      target: { ...seeded },
      display: { ...seeded },
      lastFrameMs: frameTimeMs,
      displaySig: buildLastBarSignature(seeded),
    };
    return state.lastBarAnim.display;
  }

  const anim = state.lastBarAnim;
  const sanitizedTarget = sanitizeBar(target);
  if (smoothingMs <= 0) {
    anim.target = { ...sanitizedTarget };
    anim.display = { ...sanitizedTarget };
    anim.lastFrameMs = frameTimeMs;
    anim.displaySig = buildLastBarSignature(sanitizedTarget);
    return anim.display;
  }
  const targetSig = buildLastBarSignature(sanitizedTarget);
  if (targetSig !== buildLastBarSignature(anim.target)) {
    anim.target = { ...sanitizedTarget };
    if (anim.display.time !== sanitizedTarget.time) {
      anim.display = { ...sanitizedTarget };
    }
  }

  const dt = Math.max(0, frameTimeMs - anim.lastFrameMs);
  anim.lastFrameMs = frameTimeMs;
  const alpha = 1 - Math.exp(-dt / Math.max(1, smoothingMs));

  anim.display.open = smoothValue(anim.display.open, anim.target.open, alpha);
  anim.display.high = smoothValue(anim.display.high, anim.target.high, alpha);
  anim.display.low = smoothValue(anim.display.low, anim.target.low, alpha);
  anim.display.close = smoothValue(anim.display.close, anim.target.close, alpha);
  anim.display.volume = smoothValue(Number(anim.display.volume || 0), Number(anim.target.volume || 0), alpha);
  anim.display.time = anim.target.time;

  // Keep OHLC invariants while smoothing.
  const maxBody = Math.max(anim.display.open, anim.display.close);
  const minBody = Math.min(anim.display.open, anim.display.close);
  anim.display.high = Math.max(anim.display.high, maxBody);
  anim.display.low = Math.min(anim.display.low, minBody);

  return anim.display;
}

function smoothValue(current: number, target: number, alpha: number): number {
  const c = Number.isFinite(current) ? current : target;
  const t = Number.isFinite(target) ? target : c;
  if (!Number.isFinite(c) && !Number.isFinite(t)) {
    return 0;
  }
  if (Math.abs(t - c) < 1e-10) {
    return t;
  }
  return c + (t - c) * Math.min(1, Math.max(0, alpha));
}

function sanitizeBar(bar: OhlcBar): OhlcBar {
  const open = Number(bar.open) || 0;
  const close = Number(bar.close) || open;
  const high = Math.max(Number(bar.high) || open, open, close);
  const low = Math.min(Number(bar.low) || close, open, close);
  return {
    time: Number(bar.time) || 0,
    open,
    high,
    low,
    close,
    volume: Number(bar.volume) || 0,
  };
}

function resolvePriceRange(bars: OhlcBar[], count: number): { minPrice: number; maxPrice: number } {
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const bar = bars[index];
    if (!Number.isFinite(bar.low) || !Number.isFinite(bar.high)) {
      continue;
    }
    minPrice = Math.min(minPrice, bar.low, bar.open, bar.close);
    maxPrice = Math.max(maxPrice, bar.high, bar.open, bar.close);
  }

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice === maxPrice) {
    return { minPrice: 0, maxPrice: 1 };
  }

  return { minPrice, maxPrice };
}

function packAllBars(
  bars: OhlcBar[],
  count: number,
  minPrice: number,
  maxPrice: number,
  target: Float32Array,
): Float32Array {
  const span = Math.max(1e-6, maxPrice - minPrice);
  const halfWidth = Math.min(0.028, 0.76 / Math.max(1, count));

  for (let index = 0; index < count; index += 1) {
    const base = index * INSTANCE_STRIDE_FLOATS;
    writePackedBar(target, base, index, count, bars[index], minPrice, span, halfWidth);
  }

  return target;
}

function writePackedBar(
  target: Float32Array,
  base: number,
  index: number,
  count: number,
  bar: OhlcBar,
  minPrice: number,
  span: number,
  halfWidth: number,
): void {
  const x = -1 + ((index + 0.5) / Math.max(1, count)) * 2;
  const openY = normalizePrice(bar.open, minPrice, span);
  const highY = normalizePrice(bar.high, minPrice, span);
  const lowY = normalizePrice(bar.low, minPrice, span);
  const closeY = normalizePrice(bar.close, minPrice, span);
  const isUp = closeY >= openY;

  target[base + 0] = x;
  target[base + 1] = openY;
  target[base + 2] = highY;
  target[base + 3] = lowY;
  target[base + 4] = closeY;
  target[base + 5] = halfWidth;
  target[base + 6] = isUp ? 0.0 : 1.0;
  target[base + 7] = isUp ? 1.0 : 0.23;
  target[base + 8] = isUp ? 0.64 : 0.23;
  target[base + 9] = isUp ? 0.23 : 0.23;
}

function buildLastBarSignature(bar: OhlcBar): string {
  return [bar.time, bar.open, bar.high, bar.low, bar.close].join("|");
}

function normalizePrice(price: number, minPrice: number, span: number): number {
  const t = (Number(price) - minPrice) / span;
  return t * 2 - 1;
}
