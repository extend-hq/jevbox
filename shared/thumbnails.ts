export type Thumbnail = {
  url: string;
  width: number;
  height: number;
  pageCount: number;
};

export function thumbnailUrl(contentUrl: string) {
  return contentUrl.replace(/\/content(?:\?.*)?$/, "/thumbnail");
}

export const THUMBNAIL_SIZE = 256;
