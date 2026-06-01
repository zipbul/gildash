export function hashString(input: string): string {
  const raw = Bun.hash.xxHash64(input);
  const unsigned = BigInt.asUintN(64, BigInt(raw));
  return unsigned.toString(16).padStart(16, "0");
}
