import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rf-hero rf-rise">
      <p className="rf-eyebrow">404</p>
      <h1 className="rf-display">This page doesn&apos;t exist</h1>
      <p className="rf-lede">
        The page you were looking for is not part of RetailFlow. Use the navigation to find your way back.
      </p>
      <div className="rf-hero-row">
        <Link href="/" className="rf-btn">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
