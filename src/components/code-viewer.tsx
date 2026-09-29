import { ScrollArea } from "./coss/scroll-area";
import { File } from "@pierre/diffs/react";
import { getFiletypeFromFileName, preloadHighlighter } from "@pierre/diffs";
import { Loading } from "./common";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "./theme";
export function CodeViewer({ name, text }: { name: string; text: string }) {
  const { dark } = useTheme();
  const language = getFiletypeFromFileName(name);
  const [readyLanguage, setReadyLanguage] = useState<string | null>(null);
  const [failedLanguage, setFailedLanguage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void preloadHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [language],
    })
      .then(() => {
        if (active) setReadyLanguage(language);
      })
      .catch(() => {
        if (active) setFailedLanguage(language);
      });
    return () => {
      active = false;
    };
  }, [language]);
  const file = useMemo(
    () => ({ name, contents: text.slice(0, 200000) }),
    [name, text],
  );
  return (
    <ScrollArea className="code-scroll-area" scrollFade>
      <div className="code-viewer">
        {text.length > 200000 && (
          <div className="notice">
            Preview limited to the first 200,000 characters. Download for the
            full file.
          </div>
        )}
        {readyLanguage === language ? (
          <File
            file={file}
            options={{
              theme: { light: "github-light", dark: "github-dark" },
              themeType: dark ? "dark" : "light",
              disableFileHeader: true,
              overflow: "wrap",
            }}
          />
        ) : failedLanguage === language ? (
          <pre>{file.contents}</pre>
        ) : (
          <Loading label="Loading code preview" />
        )}
      </div>
    </ScrollArea>
  );
}
