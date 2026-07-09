interface Props {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = "", onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`panel ${onClick ? "cursor-pointer hover-lift" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
