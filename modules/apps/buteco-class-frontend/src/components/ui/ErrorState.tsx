import { TriangleAlert } from "lucide-react";
import Button from "./Button.js";
import EmptyState from "./EmptyState.js";

type Props = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

// The one error look for failed pages/lists -- red-tinted icon, the
// human title, the raw error below it, retry when it makes sense.
export function ErrorState({ title = "Algo deu errado", message, onRetry }: Props) {
  return (
    <EmptyState
      className="text-red-300/90 [&>div:first-child]:text-red-400/80 [&>div:first-child]:border-red-400/20 [&>div:first-child]:bg-red-500/10"
      icon={<TriangleAlert size={22} />}
      title={title}
      description={message}
      action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button> : undefined}
    />
  );
}

export default ErrorState;