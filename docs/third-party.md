# UI source provenance

The repository includes Extend UI registry source for Finder, document viewers, and their dependencies. It also includes official coss registry primitives built on Base UI. They are checked in; no sibling repository is needed at build or runtime.

- Extend UI: https://github.com/extend/ui — license in `licenses/extend-ui.txt`.
- coss UI: https://github.com/cosscom/coss/tree/main/apps/ui — MIT; notice in `licenses/coss-ui.txt`.
- Base UI: https://base-ui.com — MIT.

The sharing flow supports private, organization, inherited, and link access through this application's authorization API.

Local adaptations resolve registry icon placeholders through the local Nucleo adapter, remove source comments, add a Finder directory-change callback, bridge toggle-group spacing, and bundle PDFium WebAssembly locally. Library license notices are retained separately. Package versions are fixed by `pnpm-lock.yaml`.

Additional renderers: react-markdown and remark-gfm; Pierre Diffs; @uiw/react-json-view; Papa Parse; react-zoom-pan-pinch; DOMPurify; fflate; and Media Chrome. Their licenses are distributed in the corresponding packages.

Interface controls use a checked-in subset of the licensed Nucleo Micro Bold collection including filled variants for status, navigation, and actions. The build does not require a private icon registry or the desktop app. Nucleo assets retain their own licensing terms; see `licenses/nucleo.txt`.

The theme uses local light and dark color tokens, dark app surfaces, and Retina hairlines.

Avatars and searchable member selection follow the official coss Avatar and Combobox components (https://coss.com/ui/docs/components/avatar and https://coss.com/ui/docs/components/combobox). Provider marks are bundled from `@lobehub/icons-static-svg` 1.95.1 (https://github.com/lobehub/lobe-icons); its MIT notice is in `licenses/lobe-icons.txt`. Extend's provider mark is bundled locally. Typesafe AI's mark comes from its official website, https://typesafe.ai. Brand marks remain the property of their respective owners. All interface assets are served locally.

Chat message, bubble, attachment, marker, and scrolling components are adapted from the official shadcn Base Nova registry (https://ui.shadcn.com/docs/changelog/2026-06-chat-components). Their MIT notice is retained in `licenses/shadcn-ui.txt`. The drag indicator uses the `border-beam` package with its ocean palette.

The chat composer uses Tiptap with its open-source Starter Kit, Bubble Menu, Table Kit, Placeholder, and Markdown extensions. Markdown serialization follows https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage. Package license notices are distributed with the dependencies.

Authentication uses Better Auth (MIT), and SMTP delivery uses Nodemailer (MIT). Their license notices are distributed with the installed packages. Mailpit (MIT) is used only as the local development inbox.
