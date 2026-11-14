// The planet's air, in two layers:
//   glow: soft rim around the planet when seen from orbit (fresnel effect), brighter on the sunny side
//   sky:  the sky you see from INSIDE the atmosphere: the sky colour overhead, fading to the fog colour at the horizon
// Colour = Role 2's absorption-spectrum colour (AudioFeatures.atmosphere), blended a little with the palette.

import * as THREE from 'three';

export function createAtmosphere(radius, glowColour, hazeColour, skyColour) {
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
        varying float vCameraDistance;
        void main() {
          vCameraDistance = length(cameraPosition - modelMatrix[3].xyz); // camera to the planet's centre
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
        varying float vCameraDistance;
        #include <common>
        #include <dithering_pars_fragment>
        void main() {
          float rim = 1.0 - max(dot(normalize(vNormal), vView), 0.0);
          // Haze thickens towards the planet's edge, then fades softly into space (no hard outline)
          float inner = pow(clamp(rim / ${limb.toFixed(4)}, 0.0, 1.0), 2.6);
          float outer = pow(1.0 - clamp((rim - ${limb.toFixed(4)}) / ${(1 - limb).toFixed(4)}, 0.0, 1.0), 2.2);
          float lit = 0.3 + 0.7 * smoothstep(-0.35, 0.6, dot(normalize(vLocalNormal), sunDirection));
          // This shell is an orbit effect. Fade it out as the camera comes down to it: just outside the shell its
          // bright rim would wrap the whole horizon as a ring and then vanish in one frame when the camera goes through.
          float fromOrbit = smoothstep(${(shell * 1.02).toFixed(1)}, ${(shell * 1.3).toFixed(1)}, vCameraDistance);
          float a = inner * outer * lit * intensity * fromOrbit;
          gl_FragColor = vec4(glowColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <dithering_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      dithering: true, // a wide, soft gradient: without noise it shows as bands
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
        skyColor: { value: new THREE.Color(skyColour) },   // ... and this equal to colours.sky
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
        uniform vec3 skyColor;
        uniform float strength;
        varying vec3 vWorld;
        varying vec3 vCentre;
        #include <common>
        #include <dithering_pars_fragment>
        void main() {
          vec3 fromCentre = cameraPosition - vCentre;
          float altitude = length(fromCentre);
          float inside = 1.0 - smoothstep(${(radius * 1.1).toFixed(1)}, ${(radius * 1.38).toFixed(1)}, altitude); // 0 from orbit
          float elevation = dot(normalize(vWorld - cameraPosition), fromCentre / altitude);                    // 0 = horizon, 1 = straight up
          float haze = 1.0 - smoothstep(-0.08, 0.5, elevation);
          // The WHOLE sky is drawn here, not just the haze over scene.background. three.js does not tone-map a
          // background colour but does tone-map this shader and the fogged ground, so a haze laid over the plain
          // background was duller than the sky above it: a grey band over the horizon. Now sky, haze and the fog on
          // the ground all go through the same tone mapping and meet without a seam.
          gl_FragColor = vec4(mix(skyColor, hazeColor, haze * strength), inside);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <dithering_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      dithering: true, // the sky is one big gradient: without noise it shows as bands, worst on dark night skies
      side: THREE.BackSide,
    })
  );
  sky.renderOrder = -1; // behind everything else that is transparent
  group.add(sky);

  return { group, glow, sky };
}
