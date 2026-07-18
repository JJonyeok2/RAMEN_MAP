import Link from "next/link";

interface ModeCardProps {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
}

export function ModeCard({ href, eyebrow, title, description }: ModeCardProps) {
  return (
    <Link className="mode-card" href={href}>
      <span className="mode-card-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <span className="mode-card-description">{description}</span>
      <span className="mode-card-action" aria-hidden="true">시작하기 →</span>
    </Link>
  );
}
