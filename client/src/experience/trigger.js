export function createLandmarkTrigger({ position, range, onEnter, onExit }) {
    let isNearby = false;

    function update(playerPosition) {
        const nearby = playerPosition.distanceTo(position) <= range;

        if (nearby === isNearby) return;

        isNearby = nearby;

        if (isNearby) {
            onEnter();
        } else {
            onExit();
        }
    }

    function reset() {
        isNearby = false;
        onExit();
    }

    return { update, reset };
}