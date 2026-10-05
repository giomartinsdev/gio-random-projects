/** Animated pulse ring for the LiveDot.
 * @label Intensity
 * @default 1
 */
uniform float u_intensity;

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** @label Ring color
 * @color
 */
uniform vec3 u_color;

/** @label Base color
 * @color
 */
uniform vec3 u_base;

void main() {
  vec2 c = u_resolution * 0.5;
  float d = distance(gl_FragCoord.xy, c);
  float r = u_resolution.y * 0.22;
  float phase = fract(u_time * 0.9);
  float wave = (d - r) / (u_resolution.y * 0.34);
  float ring = 1.0 - clamp(abs(wave - phase), 0.0, 1.0);
  float fade = (1.0 - phase) * (1.0 - clamp(wave, 0.0, 1.0));
  float alpha = clamp(ring * fade * u_intensity, 0.0, 1.0);
  vec3 col = mix(u_base, u_color, clamp(ring * fade, 0.0, 1.0));
  gl_FragColor = vec4(col, mix(1.0, 1.0, 1.0));
  if (d <= r) { gl_FragColor = vec4(u_base, 1.0); } else { gl_FragColor = vec4(col, alpha); }
}
