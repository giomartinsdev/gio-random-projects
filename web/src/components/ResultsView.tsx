import type { TripOption } from "../api";
import { formatDuration } from "../format";

interface ResultsViewProps {
  destinationName: string;
  options: TripOption[];
  liveEtaSeconds: Map<string, number | null>;
  onSelect: (option: TripOption) => void;
}

export function ResultsView({ destinationName, options, liveEtaSeconds, onSelect }: ResultsViewProps) {
  const best = options[0];
  const bestEta = best ? liveEtaSeconds.get(best.line_id) : null;

  return (
    <div className="view">
      <div className="destination-banner">
        <svg className="icon">
          <use href="#icon-pin" />
        </svg>
        Indo para <b>{destinationName}</b>
      </div>

      <div className="list">
        {options.map((option) => {
          const eta = liveEtaSeconds.get(option.line_id) ?? option.eta_seconds;
          const tight = eta !== null && eta / 60 < option.walk_seconds / 60;
          return (
            <button key={option.line_id} className="row" type="button" onClick={() => onSelect(option)}>
              <div className="glyph">
                <svg className="icon" style={{ width: 20, height: 20 }}>
                  <use href="#icon-bus" />
                </svg>
              </div>
              <div className="info">
                <div className="line-name">
                  {option.line_code} · {option.line_name}
                  {option.transfer_line_code && ` → ${option.transfer_line_code}`}
                </div>
                <div className={`line-sub${tight ? " warn" : ""}`}>
                  {tight ? (
                    "ônibus chega antes de você"
                  ) : (
                    <>
                      <svg className="icon">
                        <use href="#icon-walk" />
                      </svg>
                      {formatDuration(option.walk_seconds)} até {option.origin_stop_name}
                    </>
                  )}
                </div>
              </div>
              <div className="right">
                {eta !== null ? (
                  <div className="eta">
                    <span className="live-dot" />
                    <span>{formatDuration(eta)}</span>
                  </div>
                ) : (
                  <div className="eta none">sem previsão</div>
                )}
                <div className="arrival">viagem {formatDuration(option.trip_seconds)}</div>
              </div>
              <svg className="icon chevron">
                <use href="#icon-arrow" />
              </svg>
            </button>
          );
        })}
      </div>

      {best && (
        <div className="cta-bar">
          <div className="cta-summary">
            <span>
              Você chega ao ponto em <b>{formatDuration(best.walk_seconds)}</b>
            </span>
            <span>
              Total:{" "}
              <b>
                {formatDuration(
                  Math.max(bestEta ?? best.eta_seconds ?? 0, best.walk_seconds) + best.trip_seconds,
                )}
              </b>
            </span>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => onSelect(best)}>
            <span>
              Ver detalhes — linha {best.line_code}
            </span>
            <svg className="icon">
              <use href="#icon-arrow" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
