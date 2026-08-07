interface EmptyStateProps {
  destinationName: string;
  onRetry: () => void;
}

export function EmptyState({ destinationName, onRetry }: EmptyStateProps) {
  return (
    <div className="view">
      <div className="empty-body">
        <div className="empty-icon">
          <svg className="icon" style={{ width: 26, height: 26 }}>
            <use href="#icon-bus" />
          </svg>
        </div>
        <div className="empty-title">Nenhuma linha direta encontrada</div>
        <div className="empty-text">
          Não achamos ônibus saindo direto perto de você até <b>{destinationName}</b>. Essa região
          pode exigir baldeação — ainda não conseguimos calcular isso.
        </div>
        <div className="empty-actions">
          <button className="btn btn-ghost" type="button" onClick={onRetry}>
            Tentar outro destino
          </button>
        </div>
      </div>
    </div>
  );
}
