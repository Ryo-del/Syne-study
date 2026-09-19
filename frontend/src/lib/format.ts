export function formatTime(value: number) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function formatDate(value: number) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
  })
    .format(value)
    .toUpperCase();
}

export function getInitial(name: string): string {
  if (!name) {
    return "?";
  }

  const cleaned = name
    .replace(/^@/, "")
    .trim();

  return cleaned.charAt(0).toUpperCase();
}

export function splitAddress(addr?: string) {
  if (!addr) {
    return {
      ip: "",
      port: "",
    };
  }

  if (addr.startsWith("/")) {
    const parts = addr.split("/");

    if (
      parts.length >= 5 &&
      (parts[1] === "ip4" || parts[1] === "ip6")
    ) {
      return {
        ip: parts[2],
        port: parts[4],
      };
    }
  }

  const index = addr.lastIndexOf(":");

  if (index === -1) {
    return {
      ip: addr.replace(/^\[|\]$/g, ""),
      port: "",
    };
  }

  return {
    ip: addr
      .slice(0, index)
      .replace(/^\[|\]$/g, ""),
    port: addr.slice(index + 1),
  };
}

export function joinAddress(
  ip?: string,
  port?: string,
) {
  const cleanIP = (ip ?? "").trim();
  const cleanPort = (port ?? "").trim();

  if (!cleanIP) {
    return "";
  }

  if (!cleanPort) {
    return cleanIP;
  }

  if (
    cleanIP.includes(":") &&
    !cleanIP.startsWith("[") &&
    !cleanIP.endsWith("]")
  ) {
    return `[${cleanIP}]:${cleanPort}`;
  }

  return `${cleanIP}:${cleanPort}`;
}

export function describeError(
  err: unknown,
  fallback: string,
) {
  if (err instanceof Error) {
    const message = err.message.trim();

    if (
      !message ||
      message ===
        "The string did not match the expected pattern."
    ) {
      return fallback;
    }

    return message;
  }

  return fallback;
}