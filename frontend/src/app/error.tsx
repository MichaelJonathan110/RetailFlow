'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rf-hero rf-rise">
      <p className="rf-eyebrow">Something went wrong</p>
      <h1 className="rf-display">We hit an unexpected error</h1>
      <p className="rf-lede">
        {error?.message || 'The page could not be rendered. You can try again.'}
      </p>
      <div className="rf-hero-row">
        <button className="rf-btn" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
