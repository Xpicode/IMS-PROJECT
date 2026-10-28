/** Bare layout for print pages: no app shell, so only the sheet prints. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
