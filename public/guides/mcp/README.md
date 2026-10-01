# MCP connection guide images

The Claude and Cursor screenshots were captured from their desktop applications on September 30, 2026. They show unsaved setup screens; no connector was created. Screenshots are cropped to exclude account details and unrelated workspace content. The Claude URL uses the reserved `.example` domain; users must enter their own publicly reachable Jevbox HTTPS URL.

The VS Code server-trust screenshot is from Microsoft's [MCP server documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers), using the [published image](https://code.visualstudio.com/assets/docs/agent-customization/mcp-servers/mcp-server-trust-dialog.png), resized and encoded as WebP.

The two Codex screenshots were supplied on October 1, 2026. They show Customize → Plugins → Add → Create plugin and the New Plugin form with Server URL and OAuth authentication. They are encoded as lossless WebP without changing their content. The Codex app instructions follow these screenshots; its terminal commands follow the [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp). The general-client visual remains an explicitly labeled setup illustration, using the current Jevbox origin.

Cursor's cube mark comes from its [official brand asset package](https://cursor.com/brand). The blue VS Code icon comes from Microsoft's [official icon package](https://code.visualstudio.com/brand). Both SVGs retain their original vector shapes; export comments are omitted.

Instructions were checked on October 1, 2026 against the linked official guides: [Claude connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Claude Code](https://code.claude.com/docs/en/mcp), [Cursor](https://cursor.com/help/customization/mcp), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), and the [MCP specification](https://modelcontextprotocol.io/docs/learn/architecture). VS Code recommends workspace `.mcp.json` or Copilot Global for new connections, with a top-level `mcpServers` object. Cursor uses `.cursor/mcp.json` or `~/.cursor/mcp.json`, with URL-based server entries.

HTTP and OAuth configuration support does not establish compatibility with Jevbox's required MCP 2026-07-28 revision; individual client interoperability has not been verified.
