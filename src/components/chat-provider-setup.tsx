import { useRef, type ReactNode } from "react";
import { providerCatalog } from "../../shared/providers";
import {
  validateLength,
  validateModelList,
  validateProviderConfig,
  validateRequiredText,
} from "@/lib/form-validation";
import { ProviderLogo } from "./provider-logo";
import { Choice } from "./common";
import { Button } from "./coss/button";
import { Input } from "./coss/input";
import { Textarea } from "./coss/textarea";
import { Field, FieldLabel, FieldDescription, FieldError } from "./coss/field";
import { Switch } from "./ui/switch";
import { ShapeTriangle, Trash2 } from "./icons";

export type ProviderDraft = {
  id: string;
  provider: string;
  enabled: boolean;
  model: string;
  models: string;
  key?: string;
  config: string;
  saved: boolean;
};

export function ChatProviderSetup({
  draft,
  usedProviders,
  configured,
  hasConfig,
  busy,
  onChange,
  onRemove,
  apiKeyField,
}: {
  draft: ProviderDraft;
  usedProviders: string[];
  configured: boolean;
  hasConfig: boolean;
  busy: boolean;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onRemove: () => void;
  apiKeyField?: ReactNode;
}) {
  const advanced = useRef<HTMLDetailsElement>(null);
  const provider = providerCatalog.find((item) => item.id === draft.provider)!;
  const name = (field: string) => `${draft.id}-${field}`;
  return (
    <section
      className="chat-provider-setup"
      aria-label={`${provider.label} provider setup`}
    >
      <div className="chat-provider-setup-heading">
        <ProviderLogo provider={draft.provider} size={22} />
        <h3>{provider.label}</h3>
        <label className="chat-provider-enabled">
          <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
          <Switch
            aria-label={`Enable ${provider.label} in chat`}
            checked={draft.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${provider.label} setup`}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      {!draft.saved && (
        <Field name={name("provider")}>
          <FieldLabel>Provider</FieldLabel>
          <Choice
            value={draft.provider}
            label="Chat provider"
            options={providerCatalog
              .filter(
                (item) =>
                  item.id === draft.provider ||
                  !usedProviders.includes(item.id),
              )
              .map((item) => ({
                value: item.id,
                label: (
                  <span className="provider-option connections-provider-option">
                    <ProviderLogo provider={item.id} size={15} />
                    {item.label}
                  </span>
                ),
              }))}
            onChange={(provider) =>
              onChange({
                provider,
                model:
                  providerCatalog.find((item) => item.id === provider)?.model ??
                  "",
                models: "",
                key: undefined,
                config: "",
              })
            }
          />
        </Field>
      )}
      <Field
        name={name("model")}
        validate={(value) => validateRequiredText(value, "a model ID", 150)}
      >
        <FieldLabel>Model ID</FieldLabel>
        <Input
          name={name("model")}
          required
          maxLength={150}
          value={draft.model}
          onChange={(event) => onChange({ model: event.target.value })}
          placeholder="Provider model ID"
        />
        <FieldError />
      </Field>
      <Field name={name("models")} validate={validateModelList}>
        <FieldLabel>Additional models</FieldLabel>
        <Textarea
          name={name("models")}
          value={draft.models}
          onChange={(event) => onChange({ models: event.target.value })}
          placeholder="One model ID per line"
          rows={2}
        />
        <FieldError />
      </Field>
      {apiKeyField ?? (
        <Field
          name={name("key")}
          validate={(value) => validateLength(value, 10000)}
        >
          <FieldLabel>API key</FieldLabel>
          <Input
            name={name("key")}
            type="password"
            autoComplete="off"
            maxLength={10000}
            value={draft.key ?? ""}
            placeholder={
              configured
                ? "Configured · leave blank to keep"
                : "Paste your API key"
            }
            onChange={(event) =>
              onChange({ key: event.target.value || undefined })
            }
          />
          <FieldError />
          {configured && (
            <Button
              variant="ghost"
              size="xs"
              className="justify-self-start"
              onClick={() =>
                onChange({ key: draft.key === "" ? undefined : "" })
              }
            >
              {draft.key === "" ? "Keep saved key" : "Clear saved key on save"}
            </Button>
          )}
          {draft.key === "" && (
            <FieldDescription>
              The saved key will be removed when you save.
            </FieldDescription>
          )}
        </Field>
      )}
      <details
        ref={advanced}
        className="advanced-config"
        open={
          Boolean(provider.fields) ||
          Boolean(validateProviderConfig(draft.config))
        }
      >
        <summary className="triangle-summary">
          <ShapeTriangle size={10} className="disclosure-triangle" /> Advanced
          configuration
        </summary>
        <Field
          name={name("config")}
          validate={(value) => {
            const error = validateProviderConfig(value);
            if (error && advanced.current) advanced.current.open = true;
            return error;
          }}
        >
          <FieldLabel className="sr-only">
            Advanced configuration for {provider.label}
          </FieldLabel>
          <FieldDescription>
            Encrypted JSON settings
            {provider.fields
              ? `: ${provider.fields.join(", ")}`
              : ", such as region or baseURL"}
            . Leave blank to keep saved values; enter {"{}"} to clear them.
          </FieldDescription>
          <Textarea
            name={name("config")}
            rows={4}
            value={draft.config}
            onChange={(event) => onChange({ config: event.target.value })}
            placeholder={'{\n  "baseURL": "https://your-provider.com/v1"\n}'}
          />
          <FieldError />
          {hasConfig && (
            <FieldDescription>
              Advanced configuration is saved.
            </FieldDescription>
          )}
        </Field>
      </details>
    </section>
  );
}
