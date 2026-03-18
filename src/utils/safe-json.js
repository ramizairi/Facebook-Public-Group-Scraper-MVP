export function stripFacebookPrefix(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/^\s*for\s*\(\s*;;\s*\);\s*/, "").trim();
}

export function safeJsonParse(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function safeJsonParseMany(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const directlyParsed = safeJsonParse(value);
  if (directlyParsed != null) {
    return [directlyParsed];
  }

  const parsedDocuments = [];
  let index = 0;

  while (index < value.length) {
    while (index < value.length && /\s/.test(value[index])) {
      index += 1;
    }

    if (index >= value.length) {
      break;
    }

    const opener = value[index];
    if (opener !== "{" && opener !== "[") {
      return [];
    }

    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; index < value.length; index += 1) {
      const character = value[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }

        continue;
      }

      if (character === "\"") {
        inString = true;
        continue;
      }

      if (character === "{" || character === "[") {
        depth += 1;
        continue;
      }

      if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) {
          const parsed = safeJsonParse(value.slice(start, index + 1));
          if (parsed == null) {
            return [];
          }

          parsedDocuments.push(parsed);
          index += 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      return [];
    }
  }

  return parsedDocuments;
}

export function safeJsonStringify(value, spacing = 2) {
  return JSON.stringify(
    value,
    (_, nestedValue) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }

      return nestedValue;
    },
    spacing,
  );
}
