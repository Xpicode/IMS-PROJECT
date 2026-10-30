import { IBM_Plex_Mono } from "next/font/google";

// Label-printer face for codes and references (sign-in scene, dashboard). The app itself stays on Inter.
export const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "600"] });
