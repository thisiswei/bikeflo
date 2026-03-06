import { describe, expect, it } from "vitest";
import {
  buildDistanceTimestamps,
  densifyPath,
  distanceInMeters,
  MAX_ANIMATION_SEGMENT_METERS,
  type Coordinate
} from "./route-geometry";

function maxSegment(path: Coordinate[]) {
  let maxDistance = 0;

  for (let index = 1; index < path.length; index += 1) {
    maxDistance = Math.max(
      maxDistance,
      distanceInMeters(path[index - 1]!, path[index]!)
    );
  }

  return maxDistance;
}

describe("route geometry helpers", () => {
  it("densifies long path segments for smoother animation", () => {
    const path: Coordinate[] = [
      [-73.99, 40.75],
      [-73.99, 40.7527]
    ];

    const densified = densifyPath(path, 45);

    expect(densified.length).toBeGreaterThan(path.length);
    expect(maxSegment(densified)).toBeLessThanOrEqual(45.5);
  });

  it("keeps short paths unchanged", () => {
    const path: Coordinate[] = [
      [-73.99, 40.75],
      [-73.9899, 40.7501]
    ];

    expect(densifyPath(path, MAX_ANIMATION_SEGMENT_METERS)).toEqual(path);
  });

  it("builds timestamps proportional to traveled distance", () => {
    const path: Coordinate[] = [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001]
    ];

    const timestamps = buildDistanceTimestamps(path, 100, 160);

    expect(timestamps[0]).toBe(100);
    expect(timestamps.at(-1)).toBe(160);
    expect(timestamps[1]).toBeCloseTo(130, 0);
  });
});
