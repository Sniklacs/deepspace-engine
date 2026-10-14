// Tests for the player's own avatar (game/avatar.ts, owner 2026-10-14):
// the upload gate (only real raster images, capped) and the resolution of
// choice + stored upload → what renders, race-emblem default included.
import { describe, expect, test } from "bun:test";
import {
  resolvePlayerAvatar,
  validateAvatarDataUrl,
} from "./avatar";

// ---- tiny image fixtures, built byte by byte ------------------------------

function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10], 0); // signature
  b.set([0, 0, 0, 13], 8); // IHDR length
  b.set([73, 72, 68, 82], 12); // "IHDR"
  b.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  b.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  return b;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(39);
  b.set([0xff, 0xd8], 0); // SOI
  b.set([0xff, 0xe0, 0, 16], 2); // APP0, length 16
  b.set([0xff, 0xc0, 0, 17, 8], 20); // SOF0, length 17, precision 8
  b.set([(height >> 8) & 255, height & 255], 25);
  b.set([(width >> 8) & 255, width & 255], 27);
  return b;
}

function webpLossyBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  const riff = "RIFF....WEBPVP8 ";
  for (let i = 0; i < riff.length; i++) b[i] = riff.charCodeAt(i);
  b.set([0x9d, 0x01, 0x2a], 23); // start code
  b.set([width & 255, (width >> 8) & 63], 26);
  b.set([height & 255, (height >> 8) & 63], 28);
  return b;
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("validateAvatarDataUrl", () => {
  test("accepts a small PNG and reads its dimensions", () => {
    const v = validateAvatarDataUrl(dataUrl("image/png", pngBytes(256, 256)));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.mime).toBe("image/png");
      expect(v.width).toBe(256);
      expect(v.height).toBe(256);
    }
  });

  test("accepts JPEG and WebP", () => {
    const j = validateAvatarDataUrl(dataUrl("image/jpeg", jpegBytes(320, 240)));
    expect(j.ok).toBe(true);
    if (j.ok) {
      expect(j.width).toBe(320);
      expect(j.height).toBe(240);
    }
    const w = validateAvatarDataUrl(dataUrl("image/webp", webpLossyBytes(128, 96)));
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.width).toBe(128);
      expect(w.height).toBe(96);
    }
  });

  test("rejects SVG — a script vector, never an avatar", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const v = validateAvatarDataUrl(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
    expect(v.ok).toBe(false);
  });

  test("rejects GIF, executables and plain text wearing an image label", () => {
    expect(validateAvatarDataUrl(dataUrl("image/gif", pngBytes(10, 10))).ok).toBe(false);
    // PNG header claimed, garbage inside: the header parse refuses it.
    const fake = new Uint8Array(64).fill(7);
    expect(validateAvatarDataUrl(dataUrl("image/png", fake)).ok).toBe(false);
    expect(validateAvatarDataUrl("data:text/html;base64,PHNjcmlwdD4=").ok).toBe(false);
    expect(validateAvatarDataUrl("not a data url").ok).toBe(false);
    expect(validateAvatarDataUrl("").ok).toBe(false);
    expect(validateAvatarDataUrl(undefined).ok).toBe(false);
  });

  test("rejects images past the dimension cap", () => {
    const v = validateAvatarDataUrl(dataUrl("image/png", pngBytes(2000, 10)));
    expect(v.ok).toBe(false);
  });

  test("rejects payloads past the size caps", () => {
    const big = new Uint8Array(300_001);
    big.set(pngBytes(10, 10), 0);
    const v = validateAvatarDataUrl(dataUrl("image/png", big));
    expect(v.ok).toBe(false);
  });

  test("rejects malformed base64", () => {
    expect(validateAvatarDataUrl("data:image/png;base64,%%%=").ok).toBe(false);
    expect(validateAvatarDataUrl("data:image/png;base64,ABC").ok).toBe(false);
  });
});

describe("resolvePlayerAvatar", () => {
  const PHOTO = dataUrl("image/png", pngBytes(64, 64));

  test("no choice → the race-emblem default", () => {
    expect(resolvePlayerAvatar({}).kind).toBe("default");
    expect(resolvePlayerAvatar({ choice: null, upload: null }).kind).toBe("default");
  });

  test("upload choice with a stored photo → the photo", () => {
    const r = resolvePlayerAvatar({ choice: { kind: "upload", id: "g1" }, upload: PHOTO });
    expect(r.kind).toBe("upload");
    if (r.kind === "upload") expect(r.dataUrl).toBe(PHOTO);
  });

  test("upload choice whose photo is missing → default, never a broken image", () => {
    expect(resolvePlayerAvatar({ choice: { kind: "upload", id: "g1" }, upload: null }).kind).toBe(
      "default",
    );
    expect(resolvePlayerAvatar({ choice: { kind: "upload", id: "g1" }, upload: "" }).kind).toBe(
      "default",
    );
  });

  test("preset choice → its sigil glyph", () => {
    const r = resolvePlayerAvatar({ choice: { kind: "preset", key: "dragon" } });
    expect(r.kind).toBe("preset");
    if (r.kind === "preset") {
      expect(r.key).toBe("dragon");
      expect(r.glyph).toBe("🐉");
    }
  });

  test("an unknown preset key falls back to the default", () => {
    expect(resolvePlayerAvatar({ choice: { kind: "preset", key: "no-such-sigil" } }).kind).toBe(
      "default",
    );
  });

  test("a stored photo alone does not hijack an un-chosen face", () => {
    // Uploads write choice at the same time; a legacy save with only the
    // alliance-era upload and no personal choice keeps the default until
    // the player picks their face in Settings.
    expect(resolvePlayerAvatar({ upload: PHOTO }).kind).toBe("default");
  });

  test("the war band record is the fallback until a personal choice exists", () => {
    // Legacy path: face set through the alliance-only profile (member
    // record), no Settings choice yet — the face survives on the personal
    // surfaces.
    const r = resolvePlayerAvatar({
      upload: PHOTO,
      memberChoice: { kind: "upload", id: "g1" },
    });
    expect(r.kind).toBe("upload");
    const p = resolvePlayerAvatar({ memberChoice: { kind: "preset", key: "wolf" } });
    expect(p.kind).toBe("preset");
    // …but a personal choice always outranks the band record.
    const mine = resolvePlayerAvatar({
      choice: { kind: "preset", key: "star" },
      memberChoice: { kind: "preset", key: "wolf" },
    });
    expect(mine.kind).toBe("preset");
    if (mine.kind === "preset") expect(mine.key).toBe("star");
  });
});
