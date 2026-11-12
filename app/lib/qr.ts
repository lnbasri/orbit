import qrcode from "qrcode-generator";
import { encodeBitmapPng } from "./png";

export interface QrOptions {
  /** Pixels per QR module. 8 gives ~264–300 px images for ticket tokens. */
  scale?: number;
  /** Quiet zone in modules. The QR spec asks for 4. */
  margin?: number;
  errorCorrection?: "L" | "M" | "Q" | "H";
}

const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

export function qrMatrix(text: string, errorCorrection: QrOptions["errorCorrection"] = "M") {
  const qr = qrcode(0, errorCorrection);
  qr.addData(text, ALPHANUMERIC.test(text) ? "Alphanumeric" : "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return { size, isDark: (row: number, col: number) => qr.isDark(row, col) };
}

/** Render `text` as a black-on-white QR PNG. Runs entirely in-process (no external service). */
export async function qrPng(text: string, opts: QrOptions = {}): Promise<Uint8Array> {
  const scale = opts.scale ?? 8;
  const margin = opts.margin ?? 4;
  const m = qrMatrix(text, opts.errorCorrection ?? "M");
  const px = (m.size + margin * 2) * scale;
  return encodeBitmapPng(px, px, (x, y) => {
    const col = Math.floor(x / scale) - margin;
    const row = Math.floor(y / scale) - margin;
    return row >= 0 && col >= 0 && row < m.size && col < m.size && m.isDark(row, col);
  });
}
