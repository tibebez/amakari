export type ActionMode = "online" | "offline";

export interface GuideStep {
  id: string;
  title: string;
  description: string;
  requiredDocuments: string[];
  cost: string;
  expectedDuration: string;
  actionMode: ActionMode;
  officeUrl: string;
  sourceReferenceUrl: string;
}

export interface ContactLink {
  label: string;
  url: string;
}

export interface ProcessGuide {
  id: string;
  title: string;
  category: string;
  institution: string;
  region: string;
  language: string;
  summary: string;
  prerequisites: string[];
  requiredDocuments: string[];
  fees: string;
  deadlines: string;
  estimatedTime: string;
  contactLinks: ContactLink[];
  sourceType: "community-contributed";
  createdBy?: string;
  version: number;
  updatedAt: string;
  alternativeOf?: string;
  steps: GuideStep[];
}
