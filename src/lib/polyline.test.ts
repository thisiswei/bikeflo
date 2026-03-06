import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";

describe("decodePolyline", () => {
  it("decodes a standard encoded polyline into longitude-latitude points", () => {
    const coordinates = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);

    expect(coordinates).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252]
    ]);
  });
});
