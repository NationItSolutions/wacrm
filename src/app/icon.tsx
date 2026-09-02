import { ImageResponse } from "next/og";

// ConstruSuite favicon — the reduced mark, negativo.
//
// Cross only, and that is the specified behaviour rather than a
// compromise: the brand manual sets a 120px minimum for any lockup
// carrying the wordmark and says to use the cross alone below it. A
// 32px canvas is well below that. It also keeps this on the edge
// runtime — `ImageResponse` cannot reach next/font's output, so a
// wordmark would need an Oswald buffer read from disk.
//
// Clear space: the manual's X-margin rule governs the mark placed *in*
// a layout. An app icon is a bounded container where the mark is the
// artwork, so it follows the icon-grid convention instead — a full X on
// each side would leave a 10px cross that disappears at 16px.
//
// This route takes precedence over src/app/favicon.ico.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0A",
          borderRadius: 6,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 100 100" fill="#FFFFFF">
          <path d="M37.5 0h25v37.5H100v25H62.5V100h-25V62.5H0v-25h37.5z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
