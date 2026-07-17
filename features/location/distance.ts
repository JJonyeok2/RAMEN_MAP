import type { Coordinates } from "../../domain/recommendation.ts";

export function distanceKm(from: Coordinates, to: Coordinates): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDifference = radians(to.lat - from.lat);
  const longitudeDifference = radians(to.lng - from.lng);
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
