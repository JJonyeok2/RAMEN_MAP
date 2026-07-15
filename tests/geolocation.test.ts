import assert from "node:assert/strict";
import test from "node:test";

import {
  LocationRequestError,
  requestCurrentCoordinates,
  type GeolocationLike,
} from "../app/geolocation.ts";

test("returns coordinates and privacy-conscious browser options", async () => {
  let receivedOptions: PositionOptions | undefined;
  const geolocation: GeolocationLike = {
    getCurrentPosition(success, _error, options) {
      receivedOptions = options;
      success({ coords: { latitude: 37.5, longitude: 127.1 } });
    },
  };

  await assert.doesNotReject(async () => {
    const coordinates = await requestCurrentCoordinates(geolocation);
    assert.deepEqual(coordinates, { lat: 37.5, lng: 127.1 });
  });
  assert.deepEqual(receivedOptions, {
    enableHighAccuracy: false,
    timeout: 10_000,
    maximumAge: 300_000,
  });
});

test("reports unsupported geolocation", async () => {
  await assert.rejects(
    requestCurrentCoordinates(undefined),
    (error: unknown) =>
      error instanceof LocationRequestError && error.code === "unsupported",
  );
});

for (const [browserCode, expectedCode] of [
  [1, "permission-denied"],
  [2, "unavailable"],
  [3, "timeout"],
] as const) {
  test(`maps browser geolocation error ${browserCode} to ${expectedCode}`, async () => {
    const geolocation: GeolocationLike = {
      getCurrentPosition(_success, error) {
        error({ code: browserCode });
      },
    };

    await assert.rejects(
      requestCurrentCoordinates(geolocation),
      (error: unknown) =>
        error instanceof LocationRequestError && error.code === expectedCode,
    );
  });
}
