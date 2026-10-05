import {
  registerCustomLanguage,
  registerCustomTheme,
  type ThemeRegistration,
} from "@pierre/diffs";

export const JSON_LANGUAGE = "jevbox-json";
export const JSON_THEMES = {
  light: "jevbox-json-light",
  dark: "jevbox-json-dark",
};

registerCustomLanguage(JSON_LANGUAGE, async () => {
  const { default: grammars } = await import("@shikijs/langs/json");
  return {
    default: grammars.map((grammar) => ({
      ...grammar,
      name: JSON_LANGUAGE,
      scopeName: "source.jevbox-json",
      repository: {
        ...grammar.repository,
        constant: {
          patterns: [
            {
              match: "\\b(?:true|false)\\b",
              name: "constant.language.boolean.json",
            },
            { match: "\\bnull\\b", name: "constant.language.null.json" },
          ],
        },
      },
    })),
  };
});

for (const type of ["light", "dark"] as const) {
  const theme: ThemeRegistration = {
    name: JSON_THEMES[type],
    type,
    colors: {
      "editor.background": "var(--background)",
      "editor.foreground": "var(--foreground)",
      "editorLineNumber.foreground": "var(--muted-foreground)",
    },
    tokenColors: [
      {
        scope: [
          "support.type.property-name.json",
          "punctuation.support.type.property-name.json",
        ],
        settings: { foreground: "var(--json-key)" },
      },
      {
        scope: [
          "string.quoted.double.json",
          "punctuation.definition.string.json",
        ],
        settings: { foreground: "var(--json-string)" },
      },
      {
        scope: "constant.numeric.json",
        settings: { foreground: "var(--json-number)" },
      },
      {
        scope: "constant.language.boolean.json",
        settings: { foreground: "var(--json-boolean)" },
      },
      {
        scope: "constant.language.null.json",
        settings: { foreground: "var(--json-null)" },
      },
      {
        scope: "constant.character.escape.json",
        settings: { foreground: "var(--json-escape)" },
      },
      {
        scope: ["punctuation.separator.json", "punctuation.definition.json"],
        settings: { foreground: "var(--muted-foreground)" },
      },
    ],
  };
  registerCustomTheme(JSON_THEMES[type], async () => theme);
}
