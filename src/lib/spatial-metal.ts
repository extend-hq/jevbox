export const OUTLINE_METAL_SHADER = /* glsl */ `
  uniform float outlineTime;

  float outlineMetalBand(float coordinate, float blur) {
    float stripe = fract(coordinate);
    float face = smoothstep(0.23 - blur, 0.29 + blur, stripe)
      * (1.0 - smoothstep(0.29, 0.98, stripe));
    float catchlight = smoothstep(0.065 - blur, 0.08 + blur, stripe)
      * (1.0 - smoothstep(0.095 - blur, 0.12 + blur, stripe));
    float bevel = smoothstep(0.17 - blur, 0.185 + blur, stripe)
      * (1.0 - smoothstep(0.195 - blur, 0.22 + blur, stripe));
    return clamp(0.12 + face * 0.78 + catchlight * 0.88 + bevel * 0.52, 0.0, 1.0);
  }

  vec3 outlineMetalColor(float distance, float across, vec3 tint) {
    float phase = (distance - outlineTime * 2.8) * 0.2;
    float ripple = sin(phase * 2.1 + across * 1.4) * 0.065
      + sin(phase * 5.7 - across * 2.7) * 0.022;
    float coordinate = phase + ripple + (across - 0.5) * 0.12;
    float blur = clamp(fwidth(coordinate) * 1.15, 0.012, 0.07);
    float dispersion = 0.012 * (0.5 + abs(across - 0.5) * 0.6);
    vec3 metal = vec3(
      outlineMetalBand(coordinate + dispersion, blur),
      outlineMetalBand(coordinate, blur),
      outlineMetalBand(coordinate - dispersion * 1.12, blur)
    );
    vec3 burn = 1.0 - min(vec3(1.0), (1.0 - metal) / max(tint, vec3(0.001)));
    vec3 tinted = mix(metal, burn, 0.12);
    float silver = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(silver), tinted, 0.38);
  }
`;
