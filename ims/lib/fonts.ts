import { Archivo, IBM_Plex_Mono } from "next/font/google";

// Label-printer face for codes and references (sign-in scene, dashboard). The app itself stays on Inter.
export const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "600"] });

// Display face for page titles and big numbers only: a slightly wide grotesque, like warehouse signage.
export const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "swap" });
