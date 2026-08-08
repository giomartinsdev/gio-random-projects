import { useEffect, useMemo, useRef, useState } from "react";
import { IconSprite } from "./components/IconSprite";
import { Header } from "./components/Header";
import { IdleState } from "./components/IdleState";
import { LoadingState } from "./components/LoadingState";
import { ResultsView } from "./components/ResultsView";
import { EmptyState } from "./components/EmptyState";
import { DetailView } from "./components/DetailView";
import { useGeolocation } from "./hooks/useGeolocation";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { fetchTripOptions, searchDestination, type GeocodeResult, type TripOption } from "./api";

// Live vehicle positions are only as fresh as the last GPS poll (every
// minute on the flows side, see flows/bus_gps_poller) — this interval
// isn't trying to beat that, just to notice a new poll landed and correct
// the client-side countdown's drift before it gets too far off. Exported
// since DetailView's own vehicle-position polling (for the live map)
// wants the same cadence for the same reason.
export const REFRESH_INTERVAL_MS = 20_000;

function App() {
  const { status: originStatus, coordinates: origin, locate } = useGeolocation();

  useEffect(() => {
    locate();
  }, [locate]);

  const [destinationQuery, setDestinationQuery] = useState("");
  const debouncedQuery = useDebouncedValue(destinationQuery, 350);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);

  const [tripOptions, setTripOptions] = useState<TripOption[]>([]);
  const [tripOptionsLoading, setTripOptionsLoading] = useState(false);
  const [tripOptionsError, setTripOptionsError] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [liveEtaSeconds, setLiveEtaSeconds] = useState<Map<string, number | null>>(new Map());
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    if (destination || debouncedQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    searchDestination(debouncedQuery, controller.signal)
      .then(setSuggestions)
      .catch((error: unknown) => {
        // A superseded request (query changed again before this one
        // resolved) gets aborted by the cleanup below — that rejection
        // must NOT clear suggestions a newer, still-in-flight request is
        // about to fill in. Confirmed live: typing with a brief pause
        // mid-word could abort an earlier request whose rejection then
        // resolved AFTER the real answer's .then(), wiping out a
        // perfectly good result with an empty list.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSuggestions([]);
      });
    return () => controller.abort();
  }, [debouncedQuery, destination]);

  useEffect(() => {
    if (!origin || !destination) return;

    let cancelled = false;
    const controller = new AbortController();

    function load() {
      if (!hasLoadedOnce.current) setTripOptionsLoading(true);
      if (!origin || !destination) return;
      fetchTripOptions(
        origin.latitude,
        origin.longitude,
        destination.latitude,
        destination.longitude,
        controller.signal,
      )
        .then((options) => {
          if (cancelled) return;
          setTripOptions(options);
          setTripOptionsError(false);
          setTripOptionsLoading(false);
          hasLoadedOnce.current = true;
          setLiveEtaSeconds(new Map(options.map((option) => [option.line_id, option.eta_seconds])));
        })
        .catch((error: unknown) => {
          if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
          setTripOptionsError(true);
          setTripOptionsLoading(false);
        });
    }

    hasLoadedOnce.current = false;
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [origin, destination]);

  useEffect(() => {
    if (!destination) return;
    const tick = setInterval(() => {
      setLiveEtaSeconds((previous) => {
        const next = new Map(previous);
        for (const [lineId, seconds] of previous) {
          if (seconds !== null) next.set(lineId, Math.max(0, seconds - 1));
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [destination]);

  function handleSelectDestination(result: GeocodeResult) {
    setDestination(result);
    setDestinationQuery(result.name);
    setSuggestions([]);
  }

  function handleClearDestination() {
    setDestination(null);
    setDestinationQuery("");
    setSuggestions([]);
    setTripOptions([]);
    setSelectedLineId(null);
    setTripOptionsError(false);
  }

  const selectedOption = useMemo(
    () => tripOptions.find((option) => option.line_id === selectedLineId) ?? null,
    [tripOptions, selectedLineId],
  );

  const waitingForOrigin =
    destination !== null &&
    origin === null &&
    originStatus !== "denied" &&
    originStatus !== "unavailable";
  const originBlocked =
    destination !== null &&
    origin === null &&
    (originStatus === "denied" || originStatus === "unavailable");

  return (
    <>
      <IconSprite />
      <Header
        originStatus={originStatus}
        onLocate={locate}
        destinationQuery={destinationQuery}
        onDestinationQueryChange={(value) => {
          setDestinationQuery(value);
          if (destination && value !== destination.name) {
            setDestination(null);
          }
        }}
        suggestions={suggestions}
        onSelectDestination={handleSelectDestination}
        onClearDestination={handleClearDestination}
        hasDestination={destination !== null || destinationQuery.length > 0}
      />

      {!destination && <IdleState />}

      {waitingForOrigin && <LoadingState />}

      {originBlocked && (
        <div className="view">
          <div className="empty-body">
            <div className="empty-title">Precisamos da sua localização</div>
            <div className="empty-text">
              Sem acesso ao GPS, não dá pra calcular a que distância você está de cada ponto.
              Permita o acesso e tente de novo.
            </div>
            <div className="empty-actions">
              <button className="btn btn-ghost" type="button" onClick={locate}>
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      )}

      {destination && origin && tripOptionsLoading && <LoadingState />}

      {destination && origin && !tripOptionsLoading && tripOptionsError && (
        <div className="view">
          <div className="empty-body">
            <div className="empty-title">Não conseguimos buscar agora</div>
            <div className="empty-text">Verifique sua conexão e tente de novo.</div>
            <div className="empty-actions">
              <button className="btn btn-ghost" type="button" onClick={handleClearDestination}>
                Tentar outro destino
              </button>
            </div>
          </div>
        </div>
      )}

      {destination &&
        origin &&
        !tripOptionsLoading &&
        !tripOptionsError &&
        tripOptions.length > 0 && (
          <ResultsView
            destinationName={destination.name}
            options={tripOptions}
            liveEtaSeconds={liveEtaSeconds}
            onSelect={(option) => setSelectedLineId(option.line_id)}
          />
        )}

      {destination &&
        origin &&
        !tripOptionsLoading &&
        !tripOptionsError &&
        tripOptions.length === 0 && (
          <EmptyState destinationName={destination.name} onRetry={handleClearDestination} />
        )}

      <DetailView
        option={selectedOption}
        liveEtaSeconds={selectedOption ? (liveEtaSeconds.get(selectedOption.line_id) ?? null) : null}
        onClose={() => setSelectedLineId(null)}
      />
    </>
  );
}

export default App;
