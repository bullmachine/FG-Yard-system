import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-8 px-4">
      <div className="inline-flex items-center justify-center w-10 h-10 bg-slate-100 rounded-full mb-3">
        {icon || <Inbox className="w-5 h-5 text-slate-400" />}
      </div>
      <h3 className="text-sm font-medium text-slate-900 mb-0.5">{title}</h3>
      {description && <p className="text-xs text-slate-500 mb-3 max-w-sm mx-auto">{description}</p>}
      {action}
    </div>
  );
}