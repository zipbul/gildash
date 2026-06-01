import { describe, expect, it } from "bun:test";
import { hashString } from "./hasher";

describe("hashString", () => {
  it("should return 16-char lowercase hex when input is empty string", () => {
    const result = hashString("");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return same hash when input is same", () => {
    const first = hashString("abc");
    const second = hashString("abc");

    expect(first).toBe(second);
  });

  it("should return different hash when input is different", () => {
    const first = hashString("abc");
    const second = hashString("abd");

    expect(first).not.toBe(second);
  });

  it("should return 16-char lowercase hex when input is long string", () => {
    const result = hashString("a".repeat(10_000));

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return 16-char lowercase hex when input contains unicode characters", () => {
    const result = hashString("안녕하세요 🎉");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return 16-char lowercase hex when input contains special characters", () => {
    const result = hashString("!@#$%^&*()_+-=[]{}|;':\",./<>?");

    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return same hash when called repeatedly with same input", () => {
    const results = Array.from({ length: 5 }, () => hashString("idempotent"));

    expect(new Set(results).size).toBe(1);
  });
});
