export const fromHex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
