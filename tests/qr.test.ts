import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TICKET_TOKEN_PATTERN, newTicketToken } from "../app/lib/ids";
import { qrMatrix, qrPng } from "../app/lib/qr";
import { decodeQrPng } from "./helpers";

describe("ticket token", () => {
  it("is 26 Crockford base32 characters with no personal data", () => {
    const tokens = new Set(Array.from({ length: 2000 }, newTicketToken));
    expect(tokens.size).toBe(2000);
    for (const t of tokens) expect(t).toMatch(TICKET_TOKEN_PATTERN);
  });

  it("fits a small QR (alphanumeric mode, version 2 at ECC M = 25 modules)", () => {
    expect(qrMatrix(newTicketToken()).size).toBe(25);
  });
});

describe("QR PNG generation", () => {
  it("round-trips: the PNG decodes back to the exact token", async () => {
    for (let i = 0; i < 20; i++) {
      const token = newTicketToken();
      const png = await qrPng(token);
      expect(decodeQrPng(png)).toBe(token);
    }
  });

  it("produces a compact, valid PNG of the expected size", async () => {
    const png = await qrPng(newTicketToken());
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    expect(width).toBe((25 + 8) * 8); // 264 px
    expect(png.length).toBeLessThan(2000);
  });

  it("handles 8 participants quickly (CPU budget check for Workers)", async () => {
    const start = performance.now();
    for (let i = 0; i < 8; i++) await qrPng(newTicketToken());
    const ms = performance.now() - start;
    console.log(`8 QR PNGs generated in ${ms.toFixed(1)} ms (Node; Workers is comparable)`);
    expect(ms).toBeLessThan(500);
  });

  it("writes a sample image to test-output/ for visual inspection", async () => {
    mkdirSync("test-output", { recursive: true });
    const token = newTicketToken();
    writeFileSync("test-output/qr-sample.png", await qrPng(token));
    writeFileSync("test-output/qr-sample.txt", token + "\n");
  });
});
