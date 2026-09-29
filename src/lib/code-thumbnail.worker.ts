import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import json from "@shikijs/langs/json";
import yaml from "@shikijs/langs/yaml";
import theme from "@shikijs/themes/github-light";
import {
  prepareCodePreview,
  type CodePreviewLanguage,
} from "./code-thumbnail-content";

const highlighter = createHighlighterCore({
  themes: [theme],
  langs: [json, yaml],
  engine: createJavaScriptRegexEngine(),
});
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: number;
  source: string;
  language: CodePreviewLanguage;
}>) => {
  try {
    if (data.language === "text") {
      self.postMessage({
        id: data.id,
        foreground: "#374151",
        tokens: prepareCodePreview(data.source, "text")
          .split("\n")
          .map((content) => [{ content }]),
      });
      return;
    }
    const tokens = (await highlighter).codeToTokens(
      prepareCodePreview(data.source, data.language),
      {
        lang: data.language,
        theme: "github-light",
      },
    );
    self.postMessage({
      id: data.id,
      tokens: tokens.tokens,
      foreground: tokens.fg,
    });
  } catch {
    self.postMessage({ id: data.id, error: true });
  }
};
