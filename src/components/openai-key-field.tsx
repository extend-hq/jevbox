import { Button } from "./coss/button";
import { Input } from "./coss/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "./coss/field";
import { validateLength } from "@/lib/form-validation";

export function OpenAIKeyField({
  name,
  value,
  configured,
  onChange,
}: {
  name: string;
  value?: string;
  configured: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Field name={name} validate={(input) => validateLength(input, 10000)}>
      <FieldLabel>OpenAI API key</FieldLabel>
      <Input
        name={name}
        type="password"
        autoComplete="off"
        maxLength={10000}
        value={value ?? (configured ? "••••••••••••••••" : "")}
        placeholder="Paste your OpenAI API key"
        onFocus={(event) => {
          if (value === undefined && configured) event.target.select();
        }}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
      <FieldError />
      {configured && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="justify-self-start"
          onClick={() => onChange(value === "" ? undefined : "")}
        >
          {value === "" ? "Keep saved key" : "Clear saved key on save"}
        </Button>
      )}
      <FieldDescription>
        {value === ""
          ? "Saving removes the OpenAI key from both chat and decisions."
          : `${configured && value === undefined ? "Your saved OpenAI key is ready to use. " : ""}This key is shared by OpenAI chat and decisions.`}
      </FieldDescription>
    </Field>
  );
}
