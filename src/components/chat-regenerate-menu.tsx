import type { ChatModel } from "../../shared/chat";
import type { Me } from "@/lib/api";
import { Check, RefreshCw } from "./icons";
import { ProviderLogo } from "./provider-logo";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

export function ChatRegenerateMenu({
  models,
  currentModel,
  disabled,
  onRegenerate,
}: {
  models: Me["chatModels"];
  currentModel?: ChatModel;
  disabled: boolean;
  onRegenerate: (model: ChatModel) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Regenerate answer"
            disabled={disabled || !models.length}
          />
        }
      >
        <RefreshCw size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="chat-regenerate-menu"
        aria-label="Regenerate with a model"
      >
        {[...new Set(models.map((model) => model.provider))].map((provider) => (
          <DropdownMenuGroup key={provider}>
            <DropdownMenuLabel>
              {
                models.find((model) => model.provider === provider)
                  ?.providerLabel
              }
            </DropdownMenuLabel>
            {models
              .filter((model) => model.provider === provider)
              .map((model) => (
                <DropdownMenuItem
                  key={model.model}
                  disabled={disabled}
                  onClick={() =>
                    onRegenerate({
                      provider: model.provider,
                      model: model.model,
                    })
                  }
                >
                  <ProviderLogo provider={provider} size={16} />
                  <span>{model.model}</span>
                  {currentModel?.provider === provider &&
                    currentModel.model === model.model && (
                      <Check size={12} className="ml-auto" />
                    )}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
