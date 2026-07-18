import type { PublicBranchSummary } from "../domain/ramen.ts";

export interface MapAdapter {
  mount(element: HTMLElement, branches: PublicBranchSummary[], onSelect: (branchId: string) => void): void;
  update(branches: PublicBranchSummary[]): void;
  destroy(): void;
}
