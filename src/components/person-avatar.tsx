import { Avatar, AvatarFallback } from "./coss/avatar";
export function PersonAvatar({
  name,
  identity = name,
  className = "",
}: {
  name: string;
  identity?: string;
  className?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  const tone =
    Array.from(identity).reduce(
      (value, char) => value + char.charCodeAt(0),
      0,
    ) % 5;
  return (
    <Avatar
      className={`person-avatar ${className}`}
      aria-label={name}
      data-tone={tone}
    >
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
