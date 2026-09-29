# Interface design

The application is a document tool. Content is the focus; navigation and controls should remain quiet, compact, and predictable. Keep the existing Extend color palette, Base UI behavior, coss primitives, and specialist document viewers.

## References

- [Linear’s interface refresh](https://linear.app/now/behind-the-latest-design-refresh): subdued navigation, fewer competing separators, smaller icons, and consistent action placement.
- [Linear’s UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): alignment across sidebars, headers, tabs, and panels; deliberate density and hierarchy.
- [Geist typography](https://vercel.com/geist/typography): separate single-line labels from reading text; define size, weight, line height, and tracking together.
- [Rauno’s interface guidelines](https://interfaces.rauno.me/): stable text weights during interaction, tabular numbers, immediate feedback, restrained motion, and readable inputs on touch devices.
- [coss components](https://coss.com/ui/docs): compose existing accessible primitives for forms and overlays.
- [coss scroll areas](https://coss.com/ui/docs/components/scroll-area): use scroll fades and native scrolling within constrained panels.

## Typography

Use the existing sans-serif stack. Do not add external font requests. Type sizes use shared relative tokens in the theme; the values below describe the default browser configuration.

| Role                                | Size | Treatment                                            |
| ----------------------------------- | ---- | ---------------------------------------------------- |
| Metadata                            | 12px | Secondary color; short labels and counts             |
| Controls and navigation             | 13px | Medium weight where needed; consistent baselines     |
| Body                                | 14px | Regular weight; 1.5 line height                      |
| Reading                             | 15px | Foreground color; 1.7 line height, 1.75 in dark mode |
| Section title                       | 16px | Semibold                                             |
| Page and dialog title               | 20px | Semibold; slightly tighter tracking                  |
| Authentication and document heading | 24px | Reserved for the strongest heading                   |

Use sentence case. Keep paragraph measure near 70 characters in reading views. Use balanced wrapping for document headings and pretty wrapping for prose. Keep numbers tabular in counts, metadata, and tables. Use monospace for code and structured data only. Preserve typography embedded in original document formats.

## Surfaces and controls

- The icon rail and breadcrumb bar share the backdrop. The content surface starts at the rounded upper-left corner.
- Keep the main rail fixed and icon-only. Preserve the small glass icons, blue selected background, tooltips, and stationary hover treatment.
- Inner navigation uses neutral selection. Desktop rows are 28px high; touch rows have a 36px minimum. Text remains the same weight when selected.
- Borders use the existing hairline token: 1px normally and 0.5px on high-density displays.
- Badges are pill shaped. Use the semantic 600 tone at 5% opacity for light borders and the matching 300 tone at 5% in dark mode. Neutral badges follow the same convention. Use the shared badge variants in both application and viewer components.
- Use the coss input, button, select, combobox, dialog, and scroll-area primitives. Preserve their focus, keyboard, error, and disabled behavior.
- Dialogs and their backdrops use matching 150ms ease-out transitions. Honor reduced-motion preferences. Avoid decorative movement on frequently used controls.

## Pages and component patterns

| Surface                  | Pattern                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign in and registration | One narrow form, persistent labels, clear submit action, concise inline errors. No promotional panel.                                                  |
| Library                  | Finder fills the available space. Its toolbar owns search and view switching. Display image content directly in thumbnails.                            |
| Search                   | Compact page heading and query control. Distinguish the result title, source path, and readable excerpt.                                               |
| Chat                     | Compact resizable conversation list, quiet toolbar, readable messages, attached document chips, and model selection beside the composer.               |
| Sources                  | Titles use foreground contrast, metadata stays secondary, and source cards remain clickable.                                                           |
| Document                 | Compact title and metadata header with sharing/download actions. Tabs identify original content, index, parsed output, and links.                      |
| Index                    | Dense outline beside a readable section. Separate the section title, summary, metrics, source content, and child sections.                             |
| Parsed output            | Reading-width Markdown and a separate structured-data disclosure. Keep tables and code horizontally scrollable.                                        |
| Original file viewers    | Use the existing format-specific components and their controls. Apply app typography to their chrome, while preserving document layout and formatting. |
| Members                  | Align avatars, identity text, and role controls. Keep names readable and wrap unusually long values.                                                   |
| Connections              | Restrained section headings, actual provider logos, aligned status badges, and labeled credentials. Advanced options remain behind a disclosure.       |
| Sharing                  | Member search, avatars, individual roles, and general access form distinct groups. Keep permission explanations visible.                               |
| Attachments and models   | Compact popups with clear selection, search, loading, and empty states. Long names must not widen the popup.                                           |
| Account and profile      | A small account menu and a readable label/value layout. Long email addresses wrap.                                                                     |

## Review

Check light and dark themes, desktop and touch layouts, long titles, and keyboard focus. Confirm that denser rows retain legibility. Use screenshots from the current build when evaluating changes; earlier audit screenshots describe the build at the time they were captured.

The September 29 typography pass was checked by source inspection and the production build. New browser screenshots could not be captured because browser automation was rejected by its URL security policy.
