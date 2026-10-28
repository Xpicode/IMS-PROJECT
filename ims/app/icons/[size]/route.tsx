import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => [{ size: "192" }, { size: "512" }, { size: "maskable" }];

/** App icons drawn at build time (no binary files in the repo). */
export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = size === "192" ? 192 : 512;
  const maskable = size === "maskable";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1d4ed8",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: maskable ? "62%" : "80%",
          height: maskable ? "62%" : "80%",
          borderRadius: px * 0.12,
          border: `${px * 0.035}px solid #ffffff`,
          color: "#ffffff",
          fontSize: px * (maskable ? 0.2 : 0.26),
          fontWeight: 700,
          letterSpacing: px * 0.01,
        }}
      >
        IMS
      </div>
    </div>,
    { width: px, height: px },
  );
}
