// Renders text that will be shown uppercase (text-headline, or `uppercase`)
// while keeping a decade plural's "s" lowercase: "Over 50s" would otherwise
// read as "OVER 50S", which in condensed faces looks like "505".
const DECADE = /^(\d+)[sS]$/;

export function HeadlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+[sS])\b/).map((part, i) => {
        const match = DECADE.exec(part);
        if (!match) return part;
        return (
          <span key={i}>
            {match[1]}
            <span className="normal-case">s</span>
          </span>
        );
      })}
    </>
  );
}
