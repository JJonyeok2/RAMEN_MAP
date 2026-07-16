import type { BrothBase, BrothStyle, RamenType, Region } from "./ramen-data";
import type { CandidateStatus } from "../db/schema";

export type VerificationCandidate = {
  id: string;
  name: string;
  area: string;
  region: Region;
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  representativeMenu: string;
  price: number;
  ramenTypes: RamenType[];
  brothStyle: BrothStyle | "unknown";
  body: number;
  spiciness: number;
  bases: BrothBase[];
  tags: string[];
  hours: string;
  closed: string;
  sourceName: string;
  sourceUrl: string;
  secondarySourceUrl: string;
  evidenceNote: string;
  status: CandidateStatus;
  reviewerNote: string;
  verifiedBy: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CandidateUpdate = Omit<
  VerificationCandidate,
  "createdAt" | "updatedAt" | "verifiedAt" | "verifiedBy"
> & {
  verifiedBy?: string;
};
