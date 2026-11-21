const KEY_VALUE = /^([A-Za-z0-9_.-]+):\s*(.*)$/;
const FENCE = "---";

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

function splitInline(inner) {
  return inner.trim() === "" ? [] : inner.split(",").map((part) => part.trim());
}

function parseInlineValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map(parseScalar);
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const entries = splitInline(value.slice(1, -1)).map((part) => {
      const match = KEY_VALUE.exec(part);
      if (!match) throw new Error(`invalid inline map entry: ${part}`);
      return [match[1], parseInlineValue(match[2])];
    });
    return Object.fromEntries(entries);
  }
  return parseScalar(value);
}

function toSignificantLines(frontmatterText) {
  return frontmatterText
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
}

function parseList(lines, start, indent) {
  const items = [];
  let index = start;
  while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith("- ")) {
    items.push(parseInlineValue(lines[index].text.slice(2)));
    index += 1;
  }
  return { value: items, next: index };
}

function parseMap(lines, start, indent) {
  const map = {};
  let index = start;
  while (index < lines.length && lines[index].indent >= indent) {
    const line = lines[index];
    if (line.indent !== indent) throw new Error(`unexpected indentation: ${line.text}`);
    const match = KEY_VALUE.exec(line.text);
    if (!match) throw new Error(`invalid frontmatter line: ${line.text}`);
    const [, key, rest] = match;
    index += 1;
    if (rest !== "") {
      map[key] = parseInlineValue(rest);
    } else if (index < lines.length && lines[index].indent > indent) {
      const child = parseBlock(lines, index, lines[index].indent);
      map[key] = child.value;
      index = child.next;
    } else {
      map[key] = null;
    }
  }
  return { value: map, next: index };
}

function parseBlock(lines, start, indent) {
  return lines[start].text.startsWith("- ") ? parseList(lines, start, indent) : parseMap(lines, start, indent);
}

export function parseFrontmatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== FENCE) return { data: {}, body: markdown };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (end === -1) throw new Error("frontmatter is not closed with ---");
  const significant = toSignificantLines(lines.slice(1, end).join("\n"));
  const data = significant.length === 0 ? {} : parseMap(significant, 0, significant[0].indent).value;
  return { data, body: lines.slice(end + 1).join("\n") };
}
