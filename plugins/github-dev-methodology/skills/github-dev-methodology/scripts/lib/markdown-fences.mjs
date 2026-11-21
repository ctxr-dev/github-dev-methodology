const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export function classifyLines(text) {
  const result = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE_OPEN.exec(line)?.[1];
    if (fence) {
      result.push({ line, inFence: true });
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
      result.push({ line, inFence: true });
    } else {
      result.push({ line, inFence: false });
    }
  }
  return result;
}
