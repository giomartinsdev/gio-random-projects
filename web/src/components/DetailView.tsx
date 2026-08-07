import { useEffect, useState } from "react";
import { fetchLineVehicles, type LineVehicle, type TripOption } from "../api";
import { REFRESH_INTERVAL_MS } from "../App";
import { formatDuration } from "../format";
import { MapView } from "./MapView";

interface DetailViewProps {
  option: TripOption | null;
  liveEtaSeconds: number | null;
  onClose: () => void;
}

export function DetailView({ option, liveEtaSeconds, onClose }: DetailViewProps) {
  const [vehicles, setVehicles] = useState<LineVehicle[]>([]);

  // Keyed on line_code, not on `option` as a whole — a rider re-selecting
  // the same line (closing and reopening the detail view) shouldn't reset
  // the poll, but switching to a different line must, since stale
  // vehicles from the old line would otherwise flash on the new map
  // until the first fetch for the new line lands.
  useEffect(() => {
    const lineCode = option?.line_code;
    if (!lineCode) {
      setVehicles([]);
      return;
    }
    const controller = new AbortController();
    function load(code: string) {
      fetchLineVehicles(code, controller.signal)
        .then(setVehicles)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
        });
    }
    load(lineCode);
    const interval = setInterval(() => load(lineCode), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [option?.line_code]);

  if (!option) {
    return <div className="detail" aria-hidden="true" />;
  }

  const hasEta = liveEtaSeconds !== null;
  const walkMinutes = Math.ceil(option.walk_seconds / 60);
  const etaMinutes = hasEta ? Math.ceil(liveEtaSeconds / 60) : null;
  const tight = etaMinutes !== null && etaMinutes < walkMinutes;
  const boardMinute = Math.max(etaMinutes ?? 0, walkMinutes);
  const arriveMinute = boardMinute + Math.round(option.trip_seconds / 60);

  return (
    <div className="detail open">
      <div className="detail-top">
        <button className="detail-back" type="button" onClick={onClose} aria-label="Voltar">
          <svg className="icon" style={{ transform: "scaleX(-1)" }}>
            <use href="#icon-arrow" />
          </svg>
        </button>
        <div>
          <div className="d-title">Linha {option.line_code}</div>
          <div className="d-sub">{option.line_name}</div>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-hero">
          <div className={`d-live${hasEta ? "" : " none"}`}>
            {hasEta ? (
              <>
                <span className="live-dot" /> ao vivo
              </>
            ) : (
              "sem previsão ao vivo"
            )}
          </div>
          <div className={`d-big${hasEta ? "" : " none"}`}>
            {hasEta ? formatDuration(liveEtaSeconds) : "Nenhum ônibus reportando agora"}
          </div>
          {hasEta && <div className="d-caption">até o ônibus chegar no ponto</div>}
        </div>

        <MapView
          originLatitude={option.origin_latitude}
          originLongitude={option.origin_longitude}
          destinationLatitude={option.destination_latitude}
          destinationLongitude={option.destination_longitude}
          vehicles={vehicles}
        />

        <div className="timeline">
          <Stage icon="icon-crosshair" name="Você" meta="agora" time="" isLast={false} />
          <Stage
            icon="icon-walk"
            name={option.origin_stop_name}
            meta={`${walkMinutes} min a pé`}
            time={`+${walkMinutes} min`}
            isLast={false}
          />
          <Stage
            icon="icon-bus"
            name={`Linha ${option.line_code} no ponto`}
            meta={
              hasEta
                ? tight
                  ? "chega antes de você — corra"
                  : "chega com folga"
                : "sem previsão ao vivo agora"
            }
            time={etaMinutes !== null ? `+${etaMinutes} min` : "—"}
            warn={tight}
            isLast={false}
          />
          <Stage
            icon="icon-flag"
            name={option.destination_stop_name}
            meta="chegada estimada"
            time={`+${arriveMinute} min`}
            isLast
          />
        </div>
      </div>

      <div className="detail-footer">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Escolher outra linha
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
  warn?: boolean;
  isLast: boolean;
}

function Stage({ icon, name, meta, time, warn, isLast }: StageProps) {
  return (
    <div className={`t-stage${warn ? " warn" : ""}`}>
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
          <div className={`t-meta${warn ? " warn" : ""}`}>{meta}</div>
        </div>
        <div className="t-time">{time}</div>
      </div>
    </div>
  );
}
