import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "RAMEN MAP | 검증된 한 그릇 찾기";
const description =
  "검증 상태와 출처를 확인하며 지역과 취향으로 오늘의 라멘을 찾아보세요.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "RAMEN MAP",
    keywords: ["라멘", "라멘 탐방", "쇼유", "시오", "츠케멘", "마제소바"],
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ko_KR",
      siteName: "RAMEN MAP",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
