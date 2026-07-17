import type { Coordinates } from "../../domain/recommendation";
import {
  LocationRequestError,
  requestCurrentCoordinates,
  type GeolocationLike,
} from "../../app/geolocation";

export const radiusOptions = [3, 10, 30] as const;

export function requestRadiusSearchOrigin(
  geolocation: GeolocationLike | undefined,
): Promise<Coordinates> {
  return requestCurrentCoordinates(geolocation);
}

export function locationFallbackMessage(error: unknown) {
  if (!(error instanceof LocationRequestError)) {
    return "현재 위치를 확인하지 못했어요. 지역을 골라 계속해 주세요.";
  }
  if (error.code === "permission-denied") {
    return "위치 권한이 꺼져 있어요. 가까운 지역을 골라 계속해 주세요.";
  }
  if (error.code === "unsupported") {
    return "이 브라우저에서는 현재 위치를 사용할 수 없어요. 지역을 골라 주세요.";
  }
  if (error.code === "timeout") {
    return "위치 확인 시간이 초과됐어요. 지역을 골라 계속해 주세요.";
  }
  return "현재 위치를 확인할 수 없어요. 지역을 골라 계속해 주세요.";
}
