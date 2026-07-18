import type { Coordinates } from "../domain/recommendation";

export type LocationFailureCode =
  | "unsupported"
  | "permission-denied"
  | "unavailable"
  | "timeout";

type PositionLike = {
  coords: {
    latitude: number;
    longitude: number;
  };
};

type PositionErrorLike = {
  code: number;
};

export type GeolocationLike = {
  getCurrentPosition: (
    success: (position: PositionLike) => void,
    error: (error: PositionErrorLike) => void,
    options: PositionOptions,
  ) => void;
};

export class LocationRequestError extends Error {
  code: LocationFailureCode;

  constructor(code: LocationFailureCode) {
    super(code);
    this.name = "LocationRequestError";
    this.code = code;
  }
}

function failureCode(errorCode: number): LocationFailureCode {
  if (errorCode === 1) return "permission-denied";
  if (errorCode === 3) return "timeout";
  return "unavailable";
}

export function requestCurrentCoordinates(
  geolocation: GeolocationLike | undefined,
): Promise<Coordinates> {
  if (!geolocation) {
    return Promise.reject(new LocationRequestError("unsupported"));
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => reject(new LocationRequestError(failureCode(error.code))),
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 300_000,
      },
    );
  });
}
