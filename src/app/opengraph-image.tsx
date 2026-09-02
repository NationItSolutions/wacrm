import { ImageResponse } from "next/og";

// Link-unfurl card. Not an SEO asset — every route is noindex — but
// invitations are shared as wa.me links to /join/<token>, so these URLs
// get pasted into WhatsApp and Slack routinely and currently unfurl
// with nothing at all.
//
// The mark alone, no wordmark: Satori can only use fonts handed to it as
// a buffer, and next/font's build output isn't reachable from here.
// Rendering "ConstruSuite" in Satori's fallback face would be a typeface
// substitution, which the brand manual forbids outright — the cross is
// the compliant reduction. Add the wordmark later by shipping
// Oswald-Bold to public/fonts/ and moving this to the Node runtime.

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        }}
      >
        {/* Oversized, faint mark bled off the corner — the manual's
            watermark treatment (§07). */}
        <svg
          width="620"
          height="620"
          viewBox="0 0 100 100"
          fill="#FFFFFF"
          style={{ position: "absolute", right: -170, bottom: -170, opacity: 0.04 }}
        >
          <path d="M37.5 0h25v37.5H100v25H62.5V100h-25V62.5H0v-25h37.5z" />
        </svg>
        <svg width="220" height="220" viewBox="0 0 100 100" fill="#FFFFFF">
          <path d="M37.5 0h25v37.5H100v25H62.5V100h-25V62.5H0v-25h37.5z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
