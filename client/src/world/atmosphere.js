// Glowing rim around the planet when seen from orbit (fresnel effect).
// Colour = Role 2's absorption-spectrum colour (AudioFeatures.atmosphere).

import * as THREE from 'three';

export function createAtmosphere(radius, colour) {
  const geo = new THREE.SphereGeometry(radius * 1.18, 64, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(colour) },
      intensity: { value: 1.0 }, // bump this on beats for a pulse
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = 1.0 - max(dot(vNormal, vView), 0.0);
        float a = pow(rim, 2.5) * intensity;
        gl_FragColor = vec4(glowColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geo, mat);
}