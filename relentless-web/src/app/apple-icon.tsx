import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// iOS/Android home-screen icon (the one shown when you "Add to Home Screen").
// Premium dark-red brand background with an elegant Playfair Display serif "R".
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const fontPath = join(process.cwd(), "src", "app", "PlayfairDisplay-Black.ttf");

export default async function AppleIcon() {
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
          // Rich, premium oxblood-to-near-black gradient
          background: "linear-gradient(155deg, #8b1a1a 0%, #5b0e0e 40%, #2d0404 100%)",
          borderRadius: 40,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle inner glow for depth */}
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
        {/* Bottom-right gold accent */}
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
            fontSize: 120,
            fontWeight: 900,
            color: "#ffffff",
            fontFamily: "Playfair Display",
            letterSpacing: -1,
            textShadow: "0 2px 8px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)",
            marginTop: -4,
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
