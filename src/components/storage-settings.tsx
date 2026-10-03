import { useEffect, useState } from "react";
import { Meter } from "@base-ui/react/meter";
import { api } from "@/lib/api";
import { Button } from "./coss/button";
import { Loading } from "./common";
import { Database } from "./icons";

type StorageUsage = {
  usedBytes: number;
  limitBytes: number;
  originalBytes: number;
  indexBytes: number;
  documents: number;
};

function size(bytes: number) {
  if (bytes === 0) return "0 GB";
  if (bytes < 1000 ** 2) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1000 ** 3)
    return `${(bytes / 1000 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1000 ** 3).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`;
}

export function StorageSettings() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<StorageUsage>("/settings/storage", { signal: controller.signal })
      .then(setUsage)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Storage usage could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [revision]);
  const remaining = usage ? Math.max(0, usage.limitBytes - usage.usedBytes) : 0;
  const percentage = usage
    ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
    : 0;
  return (
    <div className="settings-page">
      <header className="settings-heading">
        <h1>Storage</h1>
        <p>Shared space for everyone in your organization.</p>
      </header>
      {error ? (
        <div role="alert" className="error">
          {error}{" "}
          <Button
            variant="ghost"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      ) : !usage ? (
        <Loading />
      ) : (
        <section
          className="settings-section storage-card"
          aria-label="Organization storage"
        >
          <div className="storage-card-heading">
            <span className="storage-icon">
              <Database size={24} />
            </span>
            <div>
              <h2>Organization storage</h2>
              <p className="muted">
                {size(usage.limitBytes)} shared across all members
              </p>
            </div>
          </div>
          <Meter.Root
            className="storage-meter"
            value={Math.min(usage.usedBytes, usage.limitBytes)}
            min={0}
            max={usage.limitBytes}
            aria-label="Storage used"
            getAriaValueText={() =>
              `${size(usage.usedBytes)} of ${size(usage.limitBytes)} used`
            }
          >
            <div className="storage-usage-label">
              <strong>
                {size(usage.usedBytes)}{" "}
                <span>of {size(usage.limitBytes)} used</span>
              </strong>
              <span>
                {percentage.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
                %
              </span>
            </div>
            <Meter.Track className="storage-meter-track">
              <Meter.Indicator className="storage-meter-fill" />
            </Meter.Track>
          </Meter.Root>
          <p className="muted">
            {remaining
              ? `${size(remaining)} available`
              : "Storage is full. Delete documents to make room for new uploads."}
          </p>
          <dl className="storage-breakdown">
            <div>
              <dt>Original files</dt>
              <dd>{size(usage.originalBytes)}</dd>
            </div>
            <div>
              <dt>Search indexes</dt>
              <dd>{size(usage.indexBytes)}</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>{usage.documents.toLocaleString()}</dd>
            </div>
          </dl>
          <p className="field-note">
            Upload files up to 250 MB each, or drag in a folder with up to 100
            files. Files and their search indexes count toward your
            organization’s storage.
          </p>
        </section>
      )}
    </div>
  );
}
