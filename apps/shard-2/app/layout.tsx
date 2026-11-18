export const metadata = {
  title: 'FlashDeals Crawler',
  description: 'Crawler-only worker shard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
