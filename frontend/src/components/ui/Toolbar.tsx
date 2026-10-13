interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export default function Toolbar({ children, className = '' }: ToolbarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}