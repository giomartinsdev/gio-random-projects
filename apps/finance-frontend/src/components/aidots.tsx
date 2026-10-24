import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// AiDots — o mesmo shader do ui.pen (pen/ai-dots.glsl): uma grid de
// pontos que forma a figura "sparkle"; os pontos de dentro são maiores e
// coloridos com shimmer pulsante, os de fora ficam como ghosts discretos.
// É o gesto visual de "mecanismo de IA" do design system V3.

const FRAG = `#version 100
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_fig;
uniform vec3 u_dot;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float grid = max(10.0, u_resolution.y / 24.0);
  vec2 cell = floor(gl_FragCoord.xy / grid);
  vec2 f = fract(gl_FragCoord.xy / grid) - 0.5;

  vec2 p = (gl_FragCoord.xy - u_resolution * 0.5) / (u_resolution.y * 0.5);
  p.y = -p.y;
  float a = atan(p.x, p.y);
  float m = 0.9 * pow(max(0.0, abs(cos(a))), 0.7);
  float sd = length(p) - m;

  float inside = 1.0 - smoothstep(-0.10, 0.12, sd);
  float d = length(f);
  float h = hash(cell);
  float shimmer = smoothstep(0.86, 1.0, sin(u_time * 1.4 + h * 6.283) * 0.5 + 0.5);
  float r = mix(0.11 + h * 0.05, 0.34, inside) + shimmer * 0.14;
  float mask = 1.0 - smoothstep(r, r + 0.07, d);
  float alpha = mask * mix(0.30, 1.0, inside) + mask * shimmer * 0.35;
  vec3 col = mix(u_dot, u_fig, clamp(inside + shimmer * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export type AiDotsTone = "brand" | "ok" | "warn" | "bad";

// [fig, ghost] por tema
const DARK: Record<AiDotsTone, [string, string]> = {
  brand: ["#818CF8", "#3F3F46"],
  ok: ["#34D399", "#3F3F46"],
  warn: ["#FBBF24", "#3F3F46"],
  bad: ["#F87171", "#3F3F46"],
};
const LIGHT: Record<AiDotsTone, [string, string]> = {
  brand: ["#6366F1", "#D4D4D8"],
  ok: ["#059669", "#D4D4D8"],
  warn: ["#D97706", "#D4D4D8"],
  bad: ["#DC2626", "#D4D4D8"],
};

const VERT = `attribute vec2 pos; void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

export function AiDots({
  width,
  height,
  tone = "brand",
  className,
  animate = true,
}: {
  width: number | string;
  height: number | string;
  tone?: AiDotsTone;
  className?: string;
  animate?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // sem WebGL: o frame fica neutro (o CSS cobre o fundo)

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uni = {
      resolution: gl.getUniformLocation(prog, "u_resolution"),
      time: gl.getUniformLocation(prog, "u_time"),
      fig: gl.getUniformLocation(prog, "u_fig"),
      dot: gl.getUniformLocation(prog, "u_dot"),
    };

    const dark = document.documentElement.classList.contains("dark");
    const [fig, dot] = (dark ? DARK : LIGHT)[tone];
    const figRgb = hexToRgb(fig);
    const dotRgb = hexToRgb(dot);
    gl.uniform3f(uni.fig, figRgb[0], figRgb[1], figRgb[2]);
    gl.uniform3f(uni.dot, dotRgb[0], dotRgb[1], dotRgb[2]);

    let raf = 0;
    const start = performance.now();
    const render = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uni.resolution, w, h);
      const t = animate ? (now - start) / 1000 : 0;
      gl.uniform1f(uni.time, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (animate) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [tone, animate]);

  const w = typeof width === "number" ? width : Number(width) || 24;
  const h = typeof height === "number" ? height : Number(height) || 22;

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      className={cn("shrink-0 rounded-[8px] bg-transparent", className)}
      style={{ width: width, height: height, background: "transparent" }}
      aria-hidden
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}