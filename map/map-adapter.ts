import type { BranchSummary } from "../domain/ramen.ts";

export interface MapAdapter {
  mount(element: HTMLElement, branches: BranchSummary[], onSelect: (branchId: string) => void): void;
  update(branches: BranchSummary[]): void;
  destroy(): void;
}
