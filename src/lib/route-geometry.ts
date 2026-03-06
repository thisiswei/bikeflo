export type Coordinate = [number, number];

export const MAX_ANIMATION_SEGMENT_METERS = 45;

export function distanceInMeters(
  [startLng, startLat]: Coordinate,
  [endLng, endLat]: Coordinate
) {
  const averageLatitude = ((startLat + endLat) / 2) * (Math.PI / 180);
  const metersPerLongitudeDegree = 111_320 * Math.cos(averageLatitude);
  const deltaLongitude = (endLng - startLng) * metersPerLongitudeDegree;
  const deltaLatitude = (endLat - startLat) * 111_320;

  return Math.hypot(deltaLongitude, deltaLatitude);
}

export function densifyPath(
  path: Coordinate[],
  maxSegmentMeters = MAX_ANIMATION_SEGMENT_METERS
) {
  if (path.length < 2) {
    return path;
  }

  const densified = [path[0]!];

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]!;
    const end = path[index]!;
    const segmentDistance = distanceInMeters(start, end);
    const steps = Math.max(1, Math.ceil(segmentDistance / maxSegmentMeters));

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      densified.push([
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress
      ]);
    }
  }

  return densified;
}

export function buildDistanceTimestamps(
  path: Coordinate[],
  startTime: number,
  endTime: number
) {
  if (path.length === 0) {
    return [];
  }

  if (path.length === 1) {
    return [startTime];
  }

  const distances = [0];

  for (let index = 1; index < path.length; index += 1) {
    distances.push(
      distances[index - 1]! + distanceInMeters(path[index - 1]!, path[index]!)
    );
  }

  const totalDistance = distances[distances.length - 1] ?? 0;

  if (totalDistance === 0) {
    return Array.from(
      { length: path.length },
      (_, index) =>
        startTime + ((endTime - startTime) * index) / (path.length - 1)
    );
  }

  return distances.map(
    (distance) => startTime + ((endTime - startTime) * distance) / totalDistance
  );
}
