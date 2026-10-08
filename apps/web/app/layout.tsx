import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Saha — A little closer to every customer",
  description: "Your multilingual sales and support workspace.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
