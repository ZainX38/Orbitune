import * as THREE from "three";

export function createLandmarkSound({ camera, marker, url }) {
    const listener = new THREE.AudioListener();
    camera.add(listener);

    const sound = new THREE.PositionalAudio(listener);
    marker.add(sound);
    sound.setRefDistance(2);
    sound.setVolume(0.8);

    let isNearby = false;

    function playIfReady() {
        if (
            isNearby &&
            sound.buffer &&
            listener.context.state === "running" &&
            !sound.isPlaying
        ) {
            sound.play();
        }
    }

    new THREE.AudioLoader().load(
        url,
        (buffer) => {
            sound.setBuffer(buffer);
            playIfReady();
        },
        undefined,
        (error) => console.error("Could not load landmark audio", error),
    );

    return {
        async unlock() {
            await listener.context.resume();
            playIfReady();
        },

        enter() {
            isNearby = true;
            playIfReady();
        },

        exit() {
            isNearby = false;
            if (sound.isPlaying) {
                sound.stop();
            }
        },
    };
}