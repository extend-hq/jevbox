export type RetrievalStep = {
  stage: string;
  label: string;
  resourceId?: string;
  parentId?: string | null;
  nodeId?: string;
  parentNodeId?: string;
  blockType?: string;
  page?: number;
  probability?: number;
  routeScore?: number;
};
