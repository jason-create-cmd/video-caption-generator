import { describe, expect, it } from "vitest";
import { createSessionCookie, verifySessionCookie } from "../src/worker/session";

describe("session cookies", () => {
  it("creates and verifies signed HttpOnly session cookies", async () => {
    const cookie = await createSessionCookie("secret", new Date("2026-05-01T00:00:00.000Z"));

    expect(cookie).toContain("session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(await verifySessionCookie(cookie, "secret", new Date("2026-05-01T01:00:00.000Z"))).toBe(true);
  });

  it("rejects expired or tampered cookies", async () => {
    const cookie = await createSessionCookie("secret", new Date("2026-05-01T00:00:00.000Z"));
    const tampered = cookie.replace("session=", "session=x");

    expect(await verifySessionCookie(cookie, "secret", new Date("2026-05-09T00:00:00.000Z"))).toBe(false);
    expect(await verifySessionCookie(tampered, "secret", new Date("2026-05-01T01:00:00.000Z"))).toBe(false);
  });
});
