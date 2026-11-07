import { ImageResponse } from "next/og";

// Opaque, full-bleed square icon based on src/app/icon.svg (no rounded corners,
// no transparency: iOS and maskable masks apply their own shape).
// `inset` shrinks the artwork towards the centre (0.1 = 10% margin per side).
function boardSvg(inset: number): string {
  const s = 64 * (1 - inset * 2);
  const o = 64 * inset;
  const k = s / 64;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">` +
    `<rect width="64" height="64" fill="#7c2d12"/>` +
    `<g transform="translate(${o} ${o}) scale(${k})">` +
    `<rect x="3" y="3" width="58" height="58" rx="5" fill="#fde68a"/>` +
    `<path d="M8 6 L15 31 L22 6 Z M42 58 L49 33 L56 58 Z" fill="#b91c1c"/>` +
    `<path d="M25 6 L32 31 L39 6 Z" fill="#334155"/>` +
    `<circle cx="45" cy="19" r="8" fill="#fafaf9" stroke="#78716c" stroke-width="2"/>` +
    `<circle cx="19" cy="45" r="8" fill="#1c1917" stroke="#78716c" stroke-width="2"/>` +
    `</g></svg>`
  );
}

export function renderIcon(px: number, inset = 0): ImageResponse {
  const src = `data:image/svg+xml;base64,${Buffer.from(boardSvg(inset)).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#7c2d12" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={px} height={px} alt="" />
      </div>
    ),
    { width: px, height: px },
  );
}
