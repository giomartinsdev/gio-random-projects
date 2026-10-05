/** AI dots — a grid of small dots that forms a sparkle figure (AI mechanism look).
 *  Dots inside the figure are bigger and accent-colored, with a shimmer pulse.
 * @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** @label Figure color
 * @color
 * @default #4A9FD8
 */
uniform vec3 u_fig;

/** @label Ghost dot color
 * @color
 * @default #8E8E96
 */
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
}
