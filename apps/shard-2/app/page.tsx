export default function Home() {
  return (
    <main className="coming-soon">
      <div className="coming-soon__orb coming-soon__orb--a" aria-hidden="true" />
      <div className="coming-soon__orb coming-soon__orb--b" aria-hidden="true" />

      <div className="coming-soon__content">
        <p className="coming-soon__brand">FlashDeals</p>
        <span className="coming-soon__rule" aria-hidden="true" />
        <h1 className="coming-soon__headline">Coming soon</h1>
        <p className="coming-soon__copy">
          We&apos;re lining up the best timed Amazon deals. The full experience is almost ready.
        </p>
        <a className="coming-soon__cta" href="https://www.flashdeals.app">
          Visit flashdeals.app
        </a>
      </div>
    </main>
  );
}
