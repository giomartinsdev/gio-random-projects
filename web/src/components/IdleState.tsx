export function IdleState() {
  return (
    <div className="view">
      <div className="idle-body">
        <div className="idle-empty-hint">
          <svg className="icon" style={{ width: 22, height: 22 }}>
            <use href="#icon-crosshair" />
          </svg>
          <div className="t1">Digite pra onde você quer ir</div>
          <div className="t2">
            bora. encontra as linhas que passam perto de você agora e o tempo real até cada ônibus
            chegar no ponto.
          </div>
        </div>
      </div>
    </div>
  );
}
