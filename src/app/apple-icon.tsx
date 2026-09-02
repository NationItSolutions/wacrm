import { ImageResponse } from "next/og";

// Home-screen icon for iOS. Same reduced mark as src/app/icon.tsx.
//
// borderRadius is 0 on purpose: iOS applies its own squircle mask, and
// a pre-rounded source gets rounded twice, leaving pale corners.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        <svg width="108" height="108" viewBox="0 0 100 100" fill="#FFFFFF">
          <path d="M37.5 0h25v37.5H100v25H62.5V100h-25V62.5H0v-25h37.5z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
