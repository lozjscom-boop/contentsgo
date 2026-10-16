import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "컨텐츠고",
  description: "광고 콘텐츠 설계·제작 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
