import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Favicon / PWA icon. Premium dark-red brand mark with elegant serif "R".
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Load font once at module level for reuse
const fontPath = join(process.cwd(), "src", "app", "PlayfairDisplay-Black.ttf");

export default async function Icon() {
  const fontData = await readFile(fontPath);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(155deg, #8b1a1a 0%, #5b0e0e 40%, #2d0404 100%)",
          borderRadius: 112,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle inner glow */}
        <div
          style={{
            position: "absolute",
            top: "15%",
            left: "15%",
            width: "70%",
            height: "70%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(200,80,80,0.15) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        {/* Bottom-right gold accent glow */}
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            right: "-10%",
            width: "60%",
            height: "60%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(201,149,10,0.12) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        {/* The "R" lettermark */}
        <div
          style={{
            fontSize: 340,
            fontWeight: 900,
            color: "#ffffff",
            fontFamily: "Playfair Display",
            letterSpacing: -4,
            textShadow: "0 6px 24px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3)",
            marginTop: -12,
            display: "flex",
          }}
        >
          R
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Playfair Display",
          data: fontData,
          style: "normal",
          weight: 900,
        },
      ],
    },
  );
}
