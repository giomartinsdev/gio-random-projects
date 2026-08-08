import { formatDuration } from "../format";
import type { TrainTrip } from "../api";

interface TrainDetailViewProps {
  trainTrip: TrainTrip | null;
  onClose: () => void;
}

export function TrainDetailView({ trainTrip, onClose }: TrainDetailViewProps) {
  if (!trainTrip || trainTrip.options.length === 0) {
    return <div className="detail" aria-hidden="true" />;
  }

  const option = trainTrip.options[0];
  const walkMinutes = Math.ceil(trainTrip.origin_walk_seconds / 60);
  const destinationWalkMinutes = Math.ceil(trainTrip.destination_walk_seconds / 60);
  const lineNames = option.legs.map((leg) => leg.line_short_name).join(" → ");

  return (
    <div className="detail open">
      <div className="detail-top">
        <button className="detail-back" type="button" onClick={onClose} aria-label="Voltar">
          <svg className="icon" style={{ transform: "scaleX(-1)" }}>
            <use href="#icon-arrow" />
          </svg>
        </button>
        <div>
          <div className="d-title">{lineNames}</div>
          <div className="d-sub">
            {option.departure_time} → {option.arrival_time}
          </div>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-hero">
          <div className="d-live none">próximo trem</div>
          <div className="d-big">{formatDuration(option.total_duration_min * 60)}</div>
          <div className="d-caption">de viagem, incluindo caminhada</div>
          {option.is_last_trip_of_day && (
            <div className="line-sub warn" style={{ marginTop: 8 }}>
              última viagem do dia
            </div>
          )}
          {option.warnings.map((warning) => (
            <div className="line-sub warn" key={warning} style={{ marginTop: 8 }}>
              {warning}
            </div>
          ))}
        </div>

        <div className="timeline">
          <Stage icon="icon-crosshair" name="Você" meta="agora" time="" isLast={false} />
          <Stage
            icon="icon-walk"
            name={trainTrip.origin_station_name}
            meta={`${walkMinutes} min a pé`}
            time={option.legs[0].departure_time}
            isLast={false}
          />
          {option.legs.map((leg, index) => {
            const isLastLeg = index === option.legs.length - 1;
            return (
              <Stage
                key={`${leg.line_short_name}-${leg.departure_time}`}
                icon="icon-train"
                name={`${leg.line_short_name} · ${leg.from_station_name} → ${leg.to_station_name}`}
                meta={
                  isLastLeg
                    ? `${leg.stops_count} paradas · desça em ${leg.to_station_name}`
                    : `${leg.stops_count} paradas · baldeie em ${leg.to_station_name}`
                }
                time={leg.arrival_time}
                isLast={false}
              />
            );
          })}
          <Stage
            icon="icon-flag"
            name={trainTrip.destination_station_name}
            meta={`${destinationWalkMinutes} min a pé até o destino`}
            time={option.arrival_time}
            isLast
          />
        </div>
      </div>

      <div className="detail-footer">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Voltar às opções
        </button>
      </div>
    </div>
  );
}

interface StageProps {
  icon: string;
  name: string;
  meta: string;
  time: string;
  isLast: boolean;
}

function Stage({ icon, name, meta, time, isLast }: StageProps) {
  return (
    <div className="t-stage">
      <div className="t-rail">
        <div className="t-dot">
          <svg className="icon" style={{ width: 15, height: 15 }}>
            <use href={`#${icon}`} />
          </svg>
        </div>
        {!isLast && <div className="t-line" />}
      </div>
      <div className="t-stage-row">
        <div className="t-content">
          <div className="t-name">{name}</div>
          <div className="t-meta">{meta}</div>
        </div>
        <div className="t-time">{time}</div>
      </div>
    </div>
  );
}
