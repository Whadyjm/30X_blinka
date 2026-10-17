/** Keep the full layout and accessible message while the visible letters appear. */
export function OliTypedText({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="oli-typed-text">
        {Array.from(text).map((letter, index) => (
          <span key={index} className="oli-typed-letter" style={{ animationDelay: `${delay + index * 18}ms` }}>{letter}</span>
        ))}
      </span>
    </>
  );
}
