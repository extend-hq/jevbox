import { z } from "zod";

const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const searchFiltersSchema = z
  .object({
    createdAfter: date
      .optional()
      .describe("Inclusive upload date or ISO timestamp"),
    createdBefore: date
      .optional()
      .describe("Inclusive upload date or ISO timestamp"),
    fileTypes: z
      .array(
        z.enum([
          "pdf",
          "document",
          "spreadsheet",
          "presentation",
          "text",
          "image",
          "audio",
          "video",
          "archive",
        ]),
      )
      .max(9)
      .optional(),
    access: z
      .array(z.enum(["private", "organization", "folder", "link"]))
      .max(4)
      .optional()
      .describe("The document's sharing setting; does not grant access"),
    folderId: z
      .uuid()
      .optional()
      .describe(
        "Limit to descendants of an accessible folder, including nested folders",
      ),
  })
  .strict()
  .refine(
    (filters) =>
      !filters.createdAfter ||
      !filters.createdBefore ||
      Date.parse(filters.createdAfter) <= endDate(filters.createdBefore),
    {
      message: "createdAfter must not be later than createdBefore",
      path: ["createdBefore"],
    },
  );
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

function endDate(value: string) {
  return Date.parse(value) + (value.length === 10 ? 86_400_000 - 1 : 0);
}
export function matchesSearchFilters(
  resource: { created: string; mime: string; access: string },
  filters: SearchFilters,
) {
  const created = Date.parse(resource.created);
  if (filters.createdAfter && !(created >= Date.parse(filters.createdAfter)))
    return false;
  if (filters.createdBefore && !(created <= endDate(filters.createdBefore)))
    return false;
  const access =
    resource.access === "restricted"
      ? "private"
      : resource.access === "inherit"
        ? "folder"
        : resource.access;
  if (
    filters.access?.length &&
    !filters.access.includes(
      access as NonNullable<SearchFilters["access"]>[number],
    )
  )
    return false;
  if (!filters.fileTypes?.length) return true;
  const mime = resource.mime;
  return filters.fileTypes.some((type) => {
    switch (type) {
      case "pdf":
        return mime === "application/pdf";
      case "document":
        return (
          mime === "application/pdf" || /word|rtf|opendocument.text/.test(mime)
        );
      case "spreadsheet":
        return /spreadsheet|excel|csv/.test(mime);
      case "presentation":
        return /presentation|powerpoint/.test(mime);
      case "text":
        return (
          mime.startsWith("text/") || /json|javascript|xml|yaml/.test(mime)
        );
      case "image":
        return mime.startsWith("image/");
      case "audio":
        return mime.startsWith("audio/");
      case "video":
        return mime.startsWith("video/");
      case "archive":
        return /zip|tar|compressed|archive/.test(mime);
    }
  });
}
