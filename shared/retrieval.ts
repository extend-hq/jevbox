export type RetrievalStep = {
  stage: string;
  label: string;
  resourceId?: string;
  parentId?: string | null;
  nodeId?: string;
  parentNodeId?: string;
  page?: number;
  probability?: number;
  routeScore?: number;
};
