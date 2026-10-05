/** Animated sheen sweep for bars (RankRow).
 * @label Sweep color
 * @color
 */
uniform vec3 u_sheen;

/** @label Speed
 * @default 0.6
 * @range 0, 3
 */
uniform float u_speed;

/** @time */
uniform float u_time;

/** @resolution */
uniform vec2 u_resolution;

void main() {
  float pos = fract(u_time * u_speed) * (u_resolution.x * 1.6) - u_resolution.x * 0.3;
  float d = abs(gl_FragCoord.x - pos);
  float band = 1.0 - clamp(d / 26.0, 0.0, 1.0);
  float sheen = band * band;
  vec3 col = mix(gl_FragColor.rgb, u_sheen, 0.0);
  gl_FragColor = vec4(mix(vec3(0.62, 0.62, 0.60), u_sheen, sheen * 0.55), 0.28 + sheen * 0.35);
}
