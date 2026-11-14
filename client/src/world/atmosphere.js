// The planet's air, in two layers:
//   glow: soft rim around the planet when seen from orbit (fresnel effect), brighter on the sunny side
//   sky:  a horizon haze you only see from INSIDE the atmosphere, so the surface sky is a gradient, not a flat colour
// Colour = Role 2's absorption-spectrum colour (AudioFeatures.atmosphere), blended a little with the palette.

import * as THREE from 'three';

export function createAtmosphere(radius, glowColour, hazeColour) {
  const group = new THREE.Group();

  // ---------- Orbit glow ----------
  const shell = radius * 1.2;
  const limb = 1 - Math.sqrt(1 - (radius / shell) ** 2); // rim value exactly at the planet's edge
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(shell, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(glowColour) },
        intensity: { value: 1.0 },                       // bumped on beats for a pulse
        sunDirection: { value: new THREE.Vector3(1, 0, 0) }, // planet space
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocalNormal;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vLocalNormal = normal;
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 glowColor;
        uniform float intensity;
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocalNormal;
        void main() {
          float rim = 1.0 - max(dot(normalize(vNormal), vView), 0.0);
          // Haze thickens towards the planet's edge, then fades softly into space (no hard outline)
          float inner = pow(clamp(rim / ${limb.toFixed(4)}, 0.0, 1.0), 2.6);
          float outer = pow(1.0 - clamp((rim - ${limb.toFixed(4)}) / ${(1 - limb).toFixed(4)}, 0.0, 1.0), 2.2);
          float lit = 0.3 + 0.7 * smoothstep(-0.35, 0.6, dot(normalize(vLocalNormal), sunDirection));
          float a = inner * outer * lit * intensity;
          gl_FragColor = vec4(glowColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.renderOrder = 2;
  group.add(glow);

  // ---------- Surface sky (inside only) ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.5, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        hazeColor: { value: new THREE.Color(hazeColour) }, // planet.js keeps this equal to colours.fog
        strength: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vCentre;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vCentre = modelMatrix[3].xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 hazeColor;
        uniform float strength;
        varying vec3 vWorld;
        varying vec3 vCentre;
        void main() {
          vec3 fromCentre = cameraPosition - vCentre;
          float altitude = length(fromCentre);
          float inside = 1.0 - smoothstep(${(radius * 1.1).toFixed(1)}, ${(radius * 1.38).toFixed(1)}, altitude); // 0 from orbit
          float elevation = dot(normalize(vWorld - cameraPosition), fromCentre / altitude);                    // 0 = horizon, 1 = straight up
          float haze = 1.0 - smoothstep(-0.08, 0.5, elevation);
          float a = haze * inside * strength;
          gl_FragColor = vec4(hazeColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  sky.renderOrder = -1; // behind everything else that is transparent
  group.add(sky);

  return { group, glow, sky };
}
